/** Only page-managed folder downloads are tracked. Native browser downloads are intentionally
 * outside JavaScript's control: the browser owns their progress, resume and cancel buttons. */
type Download = { id: number; name: string; controller: AbortController };
let counter = 0;
let downloads: Download[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const getDownloads = () => downloads;
export function subscribeDownloads(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function trackDownload(name: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const id = ++counter;
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  downloads = [...downloads, { id, name, controller }]; emit();
  return {
    signal: controller.signal,
    finish() { signal?.removeEventListener("abort", abort); downloads = downloads.filter((item) => item.id !== id); emit(); },
  };
}
export function cancelAllDownloads() { for (const item of downloads) item.controller.abort(); }
