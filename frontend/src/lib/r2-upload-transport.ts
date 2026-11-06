import { waitForTransferRecovery, transferDelay } from "./transfer-lifecycle";
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
const STORAGE_KEY = "bf.direct-uploads.v2";
const RESUME_TTL_MS = 7 * 24 * 3600_000;

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = csrfToken();
  const response = await fetch(`/api${path}`, {
    ...init, credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}), ...(init.headers ?? {}) },
  }).catch((error) => {
    if (init.signal?.aborted) throw error;
    throw new HttpError(0, "Connection paused. Your completed upload parts are saved.");
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
// Include every destination relation: identical files in different folders are independent.
const fingerprint = (workspaceId: string, file: File, fields: Record<string, string>) =>
  JSON.stringify([workspaceId, ...["client_team_id", "project_id", "folder_id", "task_stage_id"].map((k) => fields[k] || null), file.name, file.size, file.lastModified]);
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
    let lastActivity = Date.now(), stalled = false;
    const resumeStalled = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity > 30_000) {
        stalled = true; xhr.abort();
      }
    };
    const abort = () => xhr.abort();
    const clean = () => {
      signal.removeEventListener("abort", abort);
      document.removeEventListener("visibilitychange", resumeStalled);
      window.removeEventListener("online", resumeStalled);
    };
    xhr.timeout = 120_000;
    xhr.ontimeout = () => { clean(); reject(new HttpError(0, "Connection paused. Resuming saved parts…")); };
    xhr.upload.onprogress = (event) => { lastActivity = Date.now(); onLoaded(event.loaded); };
    xhr.onload = () => { clean(); return (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader("ETag") ?? "") : reject(new HttpError(xhr.status, `Storage refused the upload (${xhr.status}).`))); };
    xhr.onerror = () => { clean(); reject(new HttpError(0, "The connection to storage dropped. Retry to continue where it stopped.")); };
    xhr.onabort = () => { clean(); reject(stalled ? new HttpError(0, "Connection paused. Resuming saved parts…") : new DOMException("Cancelled.", "AbortError")); };
    if (signal.aborted) { reject(new DOMException("Cancelled.", "AbortError")); return; }
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", resumeStalled);
    window.addEventListener("online", resumeStalled);
    xhr.send(body);
  });
}

const sleep = transferDelay;

/** How long to trust a part URL: the server's lifetime minus a safety margin for slow parts. */
export function partUrlLifetimeMs(expiresIn: number | undefined) {
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 900;
  return Math.max(30, seconds - Math.min(300, seconds / 3)) * 1000;
}

export const PART_RETRY_DELAYS_MS = [1000, 4000, 10000];
let retryDelays = PART_RETRY_DELAYS_MS;
/** A dropped connection, an expired/refused URL (403) or a storage 5xx on one part should not
 * fail a multi-GB upload: retry that part a few times with a freshly issued URL. */
export async function withPartRetries<T>(run: (attempt: number) => Promise<T>, signal: AbortSignal, delays = retryDelays): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof TypeError ? 0 : -1;
      const transient = status === 0 || status === 403 || status === 408 || status === 429 || status >= 500;
      if (signal.aborted || attempt >= delays.length || !transient) throw error;
      await waitForTransferRecovery(signal);
      await sleep(delays[attempt], signal);
    }
  }
}

export const COMPLETE_POLL_MS = 5000;
export const COMPLETE_POLL_GIVE_UP_MS = 5 * 60_000;
type SessionStatus = { state: string; error?: string; project_file: unknown | null };
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
  const key = fingerprint(workspaceId, file, job.fields);
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
      init = await api<Init>(`${base}/`, { method: "POST", body: JSON.stringify({ name: file.name, size: file.size, content_type: file.type, last_modified: file.lastModified, ...job.fields }), signal });
    } catch (error) {
      if (error instanceof HttpError && error.code === "direct_uploads_disabled") { disabled.add(workspaceId); return xhrTransport(job, onProgress, signal); }
      throw error;
    }
    remember({ workspaceId, id: init.id, mode: init.mode, partSize: init.part_size ?? file.size, completed: [] });
  }
  const current = resume!;
  const cancel = async () => {
    await api(`${base}/${current.id}/`, { method: "DELETE" });
    save(key, null);
  };

  try {
    if (current.mode === "multipart") {
      // Reconcile with R2, not localStorage: a part can land even when its reply is lost.
      // Also handles a retry whose completion response was lost while the tab slept.
      if (resume !== undefined && !init) {
        const status = await api<SessionStatus>(`${base}/${current.id}/`, { signal });
        if (status.state === "COMPLETED" && status.project_file) {
          save(key, null); job.saveResume(undefined);
          return { ok: true, data: status.project_file };
        }
        if (status.state === "FINALIZING") {
          const data = await awaitCompletion(`${base}/${current.id}/`, signal, new HttpError(503, "Still saving the file. Retry shortly."));
          save(key, null); job.saveResume(undefined);
          return { ok: true, data };
        }
      }
      const listed = await api<{ parts: CompletedPart[] }>(`${base}/${current.id}/parts/`, { signal });
      current.completed = listed.parts;
      remember(current);
    }
    if (current.mode === "single") {
      await putBlob(init!.url!, file, init!.headers ?? {}, (loaded) => onProgress(loaded, file.size), signal);
    } else {
      // Presigned part URLs expire (DIRECT_UPLOAD_URL_EXPIRE_SECONDS, 15 min by default). A big
      // file on a slow link takes far longer, so remember when each URL was issued, refresh it
      // before it expires, and share one in-flight batch request instead of racing duplicates.
      const urls = new Map<number, { url: string; expiresAt: number }>();
      let batch: Promise<void> | null = null;
      const total = Math.ceil(file.size / current.partSize);
      job.reportParts({ done: current.completed.length, total });
      const fresh = (n: number) => { const hit = urls.get(n); return hit && hit.expiresAt > Date.now() ? hit.url : null; };
      const fetchBatch = async (partNumber: number) => {
        const wanted: number[] = [];
        for (let n = partNumber; n <= total && wanted.length < 20; n += 1) if (!fresh(n) && !current.completed.some((p) => p.partNumber === n)) wanted.push(n);
        if (!wanted.includes(partNumber)) wanted.unshift(partNumber);
        const issued = Date.now();
        const { parts, expires_in } = await api<{ parts: { part_number: number; url: string }[]; expires_in?: number }>(`${base}/${current.id}/parts/`, { method: "POST", body: JSON.stringify({ part_numbers: wanted }), signal });
        const expiresAt = issued + partUrlLifetimeMs(expires_in);
        parts.forEach((part) => urls.set(part.part_number, { url: part.url, expiresAt }));
      };
      const urlFor = async (partNumber: number, forceNew = false): Promise<string> => {
        if (forceNew) urls.delete(partNumber);
        for (let i = 0; i < 3; i += 1) {
          const hit = fresh(partNumber);
          if (hit) return hit;
          if (!batch) batch = fetchBatch(partNumber).finally(() => { batch = null; });
          await batch;
        }
        const hit = fresh(partNumber);
        if (!hit) throw new HttpError(0, "Could not get an upload address from the server.");
        return hit;
      };
      const completed = await sendParts({
        size: file.size, partSize: current.partSize, concurrency: DEFAULT_PART_CONCURRENCY, completed: current.completed, signal,
        sendPart: (part, onLoaded, partSignal) => withPartRetries(
          (attempt) => urlFor(part.partNumber, attempt > 0).then((url) => putBlob(url, file.slice(part.start, part.end), {}, onLoaded, partSignal)),
          partSignal,
        ),
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
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      try { await cancel(); job.saveResume(undefined); }
      catch { return { ok: false, status: 409, error: "Cancellation not confirmed. Retry Cancel all to clean up saved parts.", retryable: false }; }
      return { ok: false, status: 0, error: "Cancelled." };
    }
    // A refused finalize, or an upload the server no longer has open, cannot be resumed.
    if (error instanceof HttpError && [400, 404, 410].includes(error.status)) {
      save(key, null); job.saveResume(undefined);
      // Resumed from a previous page whose upload has since closed: start over once.
      if (saved && current.id === saved.id) return directSend({ ...job, resume: null }, onProgress, signal);
    }
    const retryable = !(error instanceof HttpError && error.code === "not_retryable");
    return { ok: false, status: error instanceof HttpError ? error.status : 0, error: error instanceof Error ? error.message : uploadError(0, null), retryable };
  }
}

export const r2Transport: UploadTransport = {
  id: "r2",
  supports: (request) => Boolean(request.direct) && !disabled.has(request.direct!.workspaceId),
  send: directSend,
  cancel: async (resume, direct) => {
    const value = resume as Resume | undefined;
    if (!direct || !value?.id) return;
    await api(`/workspaces/${direct.workspaceId}/uploads/${value.id}/`, { method: "DELETE" });
    for (const [key, saved] of Object.entries(readSaved())) if (saved.id === value.id) save(key, null);
  },
};

/** Test seam. */
export const __r2test = { setRetryDelays(delays: number[]) { retryDelays = delays; }, reset() { retryDelays = PART_RETRY_DELAYS_MS; disabled.clear(); configs.clear(); try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ } } };
