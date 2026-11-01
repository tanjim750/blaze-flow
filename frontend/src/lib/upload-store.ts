/**
 * One upload queue for the whole app: every upload entry point (Files, project Upload asset,
 * portal Send files, public upload links, chat attachments) goes through `startUpload`, and
 * the floating tray reads it. It lives at module level, so it survives client-side
 * navigation (the fast-routes setup never reloads the page) and keeps sending while you move
 * between pages. Framework-free (the React hook is in use-uploads.ts), so the store is unit-tested
 * with a fake transport.
 */

export type UploadStatus = "queued" | "uploading" | "processing" | "ready" | "failed" | "cancelled";
export type UploadSource = "files" | "project" | "portal" | "public" | "chat" | "review";
export type Processing = { stage: string; label: string; ready: boolean };
export type UploadResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  source: UploadSource;
  /** Where it is going, e.g. "Spring Launch · Files". */
  destination: string | null;
  status: UploadStatus;
  loaded: number;
  /** Bytes per second (smoothed) while sending. */
  speed: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** Scan / preview / proxy, once the bytes have landed. */
  processing: Processing | null;
  /** Link to the result once it is ready (set from the server's answer). */
  href: string | null;
  attempts: number;
  /** Which transport moved (or is moving) the bytes. */
  transport: string | null;
  /** Part progress for multipart transports. */
  parts: { done: number; total: number } | null;
};

export type UploadRequest = {
  url: string;
  file: File;
  fields?: Record<string, string>;
  source: UploadSource;
  destination?: string | null;
  /** From the server's answer: where to open it, and how to follow its processing. */
  describe?: (data: unknown) => { href?: string | null; fileId?: string | null; workspaceId?: string | null };
  /** Called once per successful send, including a later retry from the tray. */
  onSuccess?: (data: unknown) => void;
  /** Fraction 0..1 for callers that also draw their own bar. */
  onProgress?: (fraction: number) => void;
  /** Prefer a specific transport id (falls back to the first that supports the request). */
  transport?: string;
  /** Lets the direct-to-storage transport take this upload (Files library uploads only). */
  direct?: { workspaceId: string };
};

/** What a transport is handed for one attempt. */
export type TransportJob = {
  direct?: { workspaceId: string };
  url: string;
  file: File;
  fields: Record<string, string>;
  source: UploadSource;
  /** Whatever this transport saved on an earlier attempt of the same item (e.g. finished parts). */
  resume: unknown;
  /** Persist resume state so a retry can continue instead of starting over. */
  saveResume: (state: unknown) => void;
  /** Multipart transports report part counts so the tray can show "part 3 of 12". */
  reportParts: (parts: { done: number; total: number }) => void;
};

/**
 * A pluggable way of moving bytes. The XHR multipart/form-data POST is the default; a direct
 * object-storage transport (presigned PUT / multipart parts straight to R2) registers itself
 * and claims the requests it can handle. `send` reports *aggregate* bytes for the file.
 */
export interface UploadTransport {
  id: string;
  supports: (request: UploadRequest) => boolean;
  send: (job: TransportJob, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<UploadResult>;
}

/** Legacy function form (still accepted by the test seam). */
export type Transport = (request: { url: string; file: File; fields: Record<string, string> }, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<UploadResult>;
export type ProcessingFetcher = (workspaceId: string, fileId: string) => Promise<Processing | null>;

type Entry = { item: UploadItem; request: UploadRequest; controller: AbortController | null; waiters: ((result: UploadResult) => void)[]; lastTick: { at: number; loaded: number } | null; resume: unknown };

export const CONCURRENCY = 3;
export const PROCESSING_POLL_MS = 2500;
export const PROCESSING_GIVE_UP_MS = 10 * 60_000;

const entries = new Map<string, Entry>();
let order: string[] = [];
let snapshot: UploadItem[] = [];
const listeners = new Set<() => void>();
export type LandedEvent = { id: string; source: UploadSource; stage: "landed" | "ready" };
const landedListeners = new Set<(event: LandedEvent) => void>();
/** Fires when an upload's file exists on the server ("landed") and again when processing ends
 * ("ready"), so pages listing files can refresh without a reload. */
export function onUploadLanded(listener: (event: LandedEvent) => void) {
  landedListeners.add(listener);
  return () => { landedListeners.delete(listener); };
}
function announce(id: string, stage: LandedEvent["stage"]) {
  const entry = entries.get(id);
  if (!entry) return;
  landedListeners.forEach((listener) => { try { listener({ id, source: entry.request.source, stage }); } catch { /* a listener must not break the queue */ } });
}
const xhr: UploadTransport = { id: "xhr", supports: () => true, send: (job, progress, signal) => xhrTransport(job, progress, signal) };
let transports: UploadTransport[] = [];
let fallback: UploadTransport = xhr;

/** Add a transport; later registrations are tried first. XHR always remains the fallback. */
export function registerTransport(next: UploadTransport) {
  transports = [next, ...transports.filter((item) => item.id !== next.id)];
  return () => { transports = transports.filter((item) => item !== next); };
}

export function pickTransport(request: UploadRequest): UploadTransport {
  if (request.transport) {
    const named = transports.find((item) => item.id === request.transport);
    if (named && named.supports(request)) return named;
  }
  return transports.find((item) => item.supports(request)) ?? fallback;
}
let fetchProcessing: ProcessingFetcher = defaultFetchProcessing;
let now = () => Date.now();
let counter = 0;

function emit() {
  snapshot = order.map((id) => entries.get(id)!.item);
  listeners.forEach((listener) => listener());
}

function patch(id: string, change: Partial<UploadItem>) {
  const entry = entries.get(id);
  if (!entry) return;
  entry.item = { ...entry.item, ...change };
  emit();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getUploads = () => snapshot;

export const isActive = (item: UploadItem) => item.status === "queued" || item.status === "uploading";
export const hasActiveUploads = () => snapshot.some(isActive);

/** Queue a file. The promise settles with the first attempt's result (entry points that wait). */
export function startUpload(request: UploadRequest): { id: string; done: Promise<UploadResult> } {
  counter += 1;
  const id = `up-${now().toString(36)}-${counter}`;
  const item: UploadItem = {
    id, name: request.file.name, size: request.file.size, source: request.source, destination: request.destination ?? null,
    status: "queued", loaded: 0, speed: 0, startedAt: null, finishedAt: null, error: null, processing: null, href: null, attempts: 0,
    transport: null, parts: null,
  };
  const done = new Promise<UploadResult>((resolve) => {
    entries.set(id, { item, request, controller: null, waiters: [resolve], lastTick: null, resume: undefined });
  });
  order = [...order, id];
  emit();
  pump();
  return { id, done };
}

function pump() {
  const running = order.filter((id) => entries.get(id)?.item.status === "uploading").length;
  const waiting = order.filter((id) => entries.get(id)?.item.status === "queued");
  for (const id of waiting.slice(0, Math.max(0, CONCURRENCY - running))) void send(id);
}

async function send(id: string) {
  const entry = entries.get(id);
  if (!entry) return;
  const controller = new AbortController();
  entry.controller = controller;
  // A resumed attempt starts part-way; its first progress report becomes the speed baseline.
  entry.lastTick = entry.resume === undefined ? { at: now(), loaded: 0 } : null;
  const transport = pickTransport(entry.request);
  patch(id, { status: "uploading", loaded: 0, speed: 0, error: null, startedAt: now(), attempts: entry.item.attempts + 1, transport: transport.id });
  let result: UploadResult;
  try {
    result = await transport.send(
      {
        url: entry.request.url, file: entry.request.file, fields: entry.request.fields ?? {}, source: entry.request.source, direct: entry.request.direct,
        resume: entry.resume,
        saveResume: (state) => { const current = entries.get(id); if (current) current.resume = state; },
        reportParts: (parts) => patch(id, { parts }),
      },
      (loaded) => onProgress(id, loaded),
      controller.signal,
    );
  } catch (error) {
    result = { ok: false, status: 0, error: error instanceof Error && error.message ? error.message : uploadError(0, null) };
  }
  const current = entries.get(id);
  if (!current) return;
  current.controller = null;
  if (current.item.status === "cancelled") { settle(current, { ok: false, status: 0, error: "Cancelled." }); pump(); return; }
  if (!result.ok) {
    patch(id, { status: "failed", error: result.error, finishedAt: now() });
    settle(current, result);
    pump();
    return;
  }
  const info = current.request.describe?.(result.data) ?? {};
  current.resume = undefined;
  patch(id, { loaded: current.item.size, href: info.href ?? null, finishedAt: now() });
  current.request.onSuccess?.(result.data);
  settle(current, result);
  announce(id, "landed");
  if (info.fileId && info.workspaceId) void follow(id, info.workspaceId, info.fileId);
  else patch(id, { status: "ready", processing: { stage: "ready", label: "Sent", ready: true } });
  pump();
}

function settle(entry: Entry, result: UploadResult) {
  const waiters = entry.waiters;
  entry.waiters = [];
  waiters.forEach((resolve) => resolve(result));
}

function onProgress(id: string, loaded: number) {
  const entry = entries.get(id);
  if (!entry || entry.item.status !== "uploading") return;
  if (!entry.lastTick) { entry.lastTick = { at: now(), loaded }; patch(id, { loaded: Math.min(loaded, entry.item.size) }); return; }
  const tick = entry.lastTick;
  const elapsed = (now() - tick.at) / 1000;
  let speed = entry.item.speed;
  if (elapsed >= 0.25) {
    const instant = (loaded - tick.loaded) / elapsed;
    speed = speed ? speed * 0.7 + instant * 0.3 : instant; // smoothed so the ETA does not jump about
    entry.lastTick = { at: now(), loaded };
  }
  patch(id, { loaded: Math.min(loaded, entry.item.size), speed });
  entry.request.onProgress?.(entry.item.size ? Math.min(1, loaded / entry.item.size) : 0);
}

/** After the bytes land: poll scan → preview/proxy until ready (or give up quietly). */
async function follow(id: string, workspaceId: string, fileId: string) {
  const started = now();
  patch(id, { status: "processing", processing: { stage: "scanning", label: "Processing", ready: false } });
  for (;;) {
    const entry = entries.get(id);
    if (!entry || entry.item.status !== "processing") return;
    const state = await fetchProcessing(workspaceId, fileId).catch(() => null);
    if (!entries.has(id)) return;
    if (state?.stage === "failed") { patch(id, { status: "failed", error: state.label, processing: state }); announce(id, "ready"); return; }
    if (!state || state.ready || now() - started > PROCESSING_GIVE_UP_MS) {
      patch(id, { status: "ready", processing: state ?? { stage: "ready", label: "Uploaded", ready: true } });
      announce(id, "ready");
      return;
    }
    patch(id, { processing: state });
    await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_MS));
  }
}

export function cancelUpload(id: string) {
  const entry = entries.get(id);
  if (!entry || !isActive(entry.item)) return;
  const wasQueued = entry.item.status === "queued";
  patch(id, { status: "cancelled", error: null, finishedAt: now() });
  entry.controller?.abort();
  if (wasQueued) { settle(entry, { ok: false, status: 0, error: "Cancelled." }); pump(); }
}

/** Send a failed (or cancelled) upload again. Its `onSuccess` runs if it lands this time. */
export function retryUpload(id: string) {
  const entry = entries.get(id);
  if (!entry || (entry.item.status !== "failed" && entry.item.status !== "cancelled")) return;
  patch(id, { status: "queued", error: null, processing: null, finishedAt: null });
  pump();
}

export function dismissUpload(id: string) {
  const entry = entries.get(id);
  if (!entry || isActive(entry.item)) return;
  entries.delete(id);
  order = order.filter((item) => item !== id);
  emit();
}

/** Clear everything that is done: ready, cancelled and failed (active ones stay). */
export function clearFinished() {
  for (const id of order) {
    const item = entries.get(id)!.item;
    if (item.status === "ready" || item.status === "cancelled" || item.status === "failed") entries.delete(id);
  }
  order = order.filter((id) => entries.has(id));
  emit();
}

// -- display helpers --------------------------------------------------------------------

export function percent(item: UploadItem) {
  if (item.status === "processing" || item.status === "ready") return 100;
  return item.size ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
}

export function etaSeconds(item: UploadItem): number | null {
  if (item.status !== "uploading" || item.speed <= 0) return null;
  return Math.max(0, Math.round((item.size - item.loaded) / item.speed));
}

export function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

export function formatEta(seconds: number) {
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s left` : `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

/** Whole-tray numbers: bytes moved and left, combined speed, overall ETA (only sending items). */
export function trayTotals(items: UploadItem[]) {
  const sending = items.filter((item) => item.status === "queued" || item.status === "uploading");
  const size = sending.reduce((sum, item) => sum + item.size, 0);
  const loaded = sending.reduce((sum, item) => sum + Math.min(item.loaded, item.size), 0);
  const speed = sending.filter((item) => item.status === "uploading").reduce((sum, item) => sum + item.speed, 0);
  const remaining = Math.max(0, size - loaded);
  return { size, loaded, remaining, speed, eta: speed > 0 ? Math.round(remaining / speed) : null, percent: size ? Math.min(100, Math.round((loaded / size) * 100)) : 0 };
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function trayCounts(items: UploadItem[]) {
  return {
    active: items.filter(isActive).length,
    processing: items.filter((item) => item.status === "processing").length,
    failed: items.filter((item) => item.status === "failed").length,
    finished: items.filter((item) => item.status === "ready" || item.status === "cancelled" || item.status === "failed").length,
  };
}

// -- transports ---------------------------------------------------------------------------

export function csrfToken() {
  if (typeof document === "undefined") return "";
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

export function uploadError(status: number, data: unknown): string {
  const body = data as Record<string, unknown> | null;
  if (body && typeof body.detail === "string") return body.detail;
  for (const [key, value] of Object.entries(body ?? {})) {
    if (Array.isArray(value) && typeof value[0] === "string") return `${key === "file" ? "File" : key}: ${value[0]}`;
  }
  if (status === 413) return "This file is larger than the server accepts.";
  if (status === 429) return "Too many uploads in a short time. Wait a few minutes and try again.";
  return status ? `The upload failed (${status}).` : "The upload was interrupted. Check your connection and try again.";
}

/** XHR, because fetch cannot report upload progress. */
export function xhrTransport(request: { url: string; file: File; fields: Record<string, string> }, onProgress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    Object.entries(request.fields).forEach(([key, value]) => body.append(key, value));
    body.append("file", request.file);
    xhr.open("POST", request.url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : request.file.size);
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* proxy error page */ }
      resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true, data } : { ok: false, status: xhr.status, error: uploadError(xhr.status, data) });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: uploadError(0, null) });
    xhr.onabort = () => resolve({ ok: false, status: 0, error: "Cancelled." });
    if (signal.aborted) { xhr.abort(); return; }
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

async function defaultFetchProcessing(workspaceId: string, fileId: string): Promise<Processing | null> {
  const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}/processing/`, { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  return response.json() as Promise<Processing>;
}

/** Test seams. */
export const __test = {
  /** Replace the fallback transport (function form or a full transport). */
  setTransport(next: Transport | UploadTransport) {
    fallback = typeof next === "function" ? { id: "test", supports: () => true, send: (job, progress, signal) => next(job, progress, signal) } : next;
  },
  setProcessing(next: ProcessingFetcher) { fetchProcessing = next; },
  setClock(next: () => number) { now = next; },
  reset() { entries.clear(); landedListeners.clear(); order = []; snapshot = []; counter = 0; fallback = xhr; transports = []; fetchProcessing = defaultFetchProcessing; now = () => Date.now(); },
};
