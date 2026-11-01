/**
 * Direct-to-R2 (any S3-compatible bucket) transport for the upload tray.
 *
 * Django initializes the upload (permissions, quota reservation, generated key) and hands out
 * short-lived presigned URLs; the bytes go browser -> bucket, never through Next or Django.
 * Small files: one presigned PUT. Large files: multipart, parts sent in parallel (limited),
 * progress aggregated across parts, finished parts remembered so a retry (or the same file
 * picked again after a refresh) resumes. Then Django verifies and finalizes the upload.
 *
 * If the server says direct uploads are off (STORAGE_DRIVER is not s3, or the flag is off)
 * it falls back to the normal XHR form upload for that workspace.
 */
import { csrfToken, uploadError, xhrTransport, type TransportJob, type UploadResult, type UploadTransport } from "./upload-store";
import { DEFAULT_PART_CONCURRENCY, sendParts, type CompletedPart } from "./upload-parts";

type Init = { id: string; mode: "single" | "multipart"; url?: string; headers?: Record<string, string>; part_size?: number; part_count?: number };
type Resume = { workspaceId: string; id: string; mode: Init["mode"]; partSize: number; completed: CompletedPart[] };

const disabled = new Set<string>();
// Per-session cache of GET uploads/config/ so the tray never POSTs an initialize the server
// will refuse with 409 (which the browser logs as a console error on every upload).
const configs = new Map<string, Promise<boolean>>();
const STORAGE_KEY = "bf.direct-uploads.v1";
const RESUME_TTL_MS = 20 * 3600_000; // server keeps an upload open 24h

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = csrfToken();
  const response = await fetch(`/api${path}`, {
    ...init, credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}), ...(init.headers ?? {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status, uploadError(response.status, data), (data as { code?: string } | null)?.code);
  return data as T;
}

/** Whether direct uploads are on for this workspace; asked once per session. A failed check
 * is not cached and falls through to the initialize call (whose 409 fallback stays). */
function directEnabled(workspaceId: string): Promise<boolean> {
  let pending = configs.get(workspaceId);
  if (!pending) {
    pending = api<{ enabled?: boolean }>(`/workspaces/${workspaceId}/uploads/config/`)
      .then((config) => config?.enabled !== false)
      .catch(() => { configs.delete(workspaceId); return true; });
    configs.set(workspaceId, pending);
  }
  return pending;
}

// -- resume across a page refresh (same file picked again) ------------------------------------
const fingerprint = (workspaceId: string, file: File) => `${workspaceId}:${file.name}:${file.size}:${file.lastModified}`;
function readSaved(): Record<string, Resume & { at: number }> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}
function save(key: string, value: Resume | null) {
  try {
    const all = readSaved();
    const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (now - v.at > RESUME_TTL_MS) delete all[k];
    if (value) all[key] = { ...value, at: now }; else delete all[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* private mode: resume only within this page */ }
}

/** PUT bytes to a presigned URL with progress. Returns the ETag when CORS exposes it. */
export function putBlob(url: string, body: Blob, headers: Record<string, string>, onLoaded: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => onLoaded(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader("ETag") ?? "") : reject(new HttpError(xhr.status, `Storage refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new HttpError(0, "The connection to storage dropped. Retry to continue where it stopped."));
    xhr.onabort = () => reject(new DOMException("Cancelled.", "AbortError"));
    if (signal.aborted) { reject(new DOMException("Cancelled.", "AbortError")); return; }
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

export const COMPLETE_POLL_MS = 5000;
export const COMPLETE_POLL_GIVE_UP_MS = 5 * 60_000;
type SessionStatus = { state: string; error?: string; project_file: unknown | null };
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelled.", "AbortError")); }, { once: true });
});

/** Polls the upload session until the server says it finished (returns the file) or failed. */
async function awaitCompletion(path: string, signal: AbortSignal, original: HttpError): Promise<unknown> {
  const started = Date.now();
  for (;;) {
    await sleep(COMPLETE_POLL_MS, signal);
    const status = await api<SessionStatus>(path, { signal }).catch((error) => {
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) throw error;
      return null; // still unreachable: keep waiting
    });
    if (status?.state === "COMPLETED" && status.project_file) return status.project_file;
    if (status && ["FAILED", "CANCELLED", "EXPIRED", "ABORTED"].includes(status.state)) throw new HttpError(400, status.error || original.message);
    if (Date.now() - started >= COMPLETE_POLL_GIVE_UP_MS) throw original;
  }
}

async function directSend(job: TransportJob, onProgress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<UploadResult> {
  const workspaceId = job.direct!.workspaceId;
  const base = `/workspaces/${workspaceId}/uploads`;
  const file = job.file;
  const key = fingerprint(workspaceId, file);
  const saved = job.resume === undefined ? (readSaved()[key] as Resume | undefined) : undefined;
  let resume = (job.resume as Resume | undefined) ?? saved;
  const remember = (next: Resume) => { resume = next; job.saveResume(next); if (next.mode === "multipart") save(key, next); };

  let init: Init | null = null;
  if (resume && resume.mode === "single") {
    // A single PUT cannot resume: release the old reservation and start again.
    void api(`${base}/${resume.id}/`, { method: "DELETE" }).catch(() => {});
    resume = undefined;
  }
  if (!resume && !(await directEnabled(workspaceId))) { disabled.add(workspaceId); return xhrTransport(job, onProgress, signal); }
  if (!resume) {
    try {
      init = await api<Init>(`${base}/`, { method: "POST", body: JSON.stringify({ name: file.name, size: file.size, content_type: file.type, ...job.fields }), signal });
    } catch (error) {
      if (error instanceof HttpError && error.code === "direct_uploads_disabled") { disabled.add(workspaceId); return xhrTransport(job, onProgress, signal); }
      throw error;
    }
    remember({ workspaceId, id: init.id, mode: init.mode, partSize: init.part_size ?? file.size, completed: [] });
  }
  const current = resume!;
  const cancel = () => { void api(`${base}/${current.id}/`, { method: "DELETE" }).catch(() => {}); save(key, null); };

  try {
    if (current.mode === "single") {
      await putBlob(init!.url!, file, init!.headers ?? {}, (loaded) => onProgress(loaded, file.size), signal);
    } else {
      const urls = new Map<number, string>();
      const total = Math.ceil(file.size / current.partSize);
      job.reportParts({ done: current.completed.length, total });
      const urlFor = async (partNumber: number) => {
        if (!urls.has(partNumber)) {
          const wanted: number[] = [];
          for (let n = partNumber; n <= total && wanted.length < 20; n += 1) if (!urls.has(n) && !current.completed.some((p) => p.partNumber === n)) wanted.push(n);
          const { parts } = await api<{ parts: { part_number: number; url: string }[] }>(`${base}/${current.id}/parts/`, { method: "POST", body: JSON.stringify({ part_numbers: wanted }), signal });
          parts.forEach((part) => urls.set(part.part_number, part.url));
        }
        return urls.get(partNumber)!;
      };
      const completed = await sendParts({
        size: file.size, partSize: current.partSize, concurrency: DEFAULT_PART_CONCURRENCY, completed: current.completed, signal,
        sendPart: async (part, onLoaded, partSignal) => putBlob(await urlFor(part.partNumber), file.slice(part.start, part.end), {}, onLoaded, partSignal),
        onProgress: (loaded) => onProgress(loaded, file.size),
        onPartDone: (part, done) => { remember({ ...current, completed: [...(resume?.completed ?? []), part] }); job.reportParts({ done, total }); },
      });
      remember({ ...current, completed });
    }
    let data: unknown;
    try {
      data = await api<unknown>(`${base}/${current.id}/complete/`, { method: "POST", signal });
    } catch (error) {
      // All bytes are in the bucket; a 5xx or dropped connection on /complete usually means
      // the answer was lost (e.g. a proxy timeout while Django scanned a big file), not that
      // the upload failed. Ask the server how it ended before reporting anything.
      if (signal.aborted || !(error instanceof HttpError) || (error.status !== 0 && error.status < 500)) throw error;
      data = await awaitCompletion(`${base}/${current.id}/`, signal, error);
    }
    save(key, null);
    job.saveResume(undefined);
    return { ok: true, data };
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) { cancel(); job.saveResume(undefined); return { ok: false, status: 0, error: "Cancelled." }; }
    // A refused finalize, or an upload the server no longer has open, cannot be resumed.
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      save(key, null); job.saveResume(undefined);
      // Resumed from a previous page whose upload has since closed: start over once.
      if (saved && current.id === saved.id) return directSend({ ...job, resume: null }, onProgress, signal);
    }
    return { ok: false, status: error instanceof HttpError ? error.status : 0, error: error instanceof Error ? error.message : uploadError(0, null) };
  }
}

export const r2Transport: UploadTransport = {
  id: "r2",
  supports: (request) => Boolean(request.direct) && !disabled.has(request.direct!.workspaceId),
  send: directSend,
};

/** Test seam. */
export const __r2test = { reset() { disabled.clear(); configs.clear(); try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ } } };
