/** Wake locks prevent automatic screen sleep only. They cannot override manual locks,
 * OS suspension, battery saver, or browser decisions to freeze a hidden tab. */
export function maintainTransferWakeLock(active: boolean) {
  let stopped = false;
  let pending = false;
  let lock: WakeLockSentinel | null = null;
  const acquire = async () => {
    if (!active || stopped || pending || (lock && !lock.released) || document.visibilityState !== "visible" || !navigator.wakeLock) return;
    pending = true;
    try {
      const next = await navigator.wakeLock.request("screen");
      if (stopped) await next.release(); else lock = next;
    } catch { /* Unsupported, battery saver or denied: resume still works. */ }
    finally { pending = false; }
  };
  void acquire();
  document.addEventListener("visibilitychange", acquire);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", acquire);
    if (lock && !lock.released) void lock.release().catch(() => {});
  };
}

/** On an interrupted request, wait for a usable page/network instead of exhausting every
 * retry while a phone is locked. Healthy background requests are never paused here. */
export function waitForTransferRecovery(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  if (typeof document === "undefined" || (document.visibilityState === "visible" && navigator.onLine !== false)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); signal?.removeEventListener("abort", abort); };
    const check = () => { if (document.visibilityState === "visible" && navigator.onLine !== false) { clean(); resolve(); } };
    const abort = () => { clean(); reject(new DOMException("Cancelled", "AbortError")); };
    document.addEventListener("visibilitychange", check); window.addEventListener("online", check); signal?.addEventListener("abort", abort, { once: true });
    check();
  });
}

export function transferDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Recover a stream whose network stack never delivered an error after suspension. */
export function readDownloadChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); signal?.removeEventListener("abort", abort); };
    const fail = (error: Error) => { clean(); reject(error); void reader.cancel().catch(() => {}); };
    const visible = () => { if (document.visibilityState === "visible" && Date.now() - started > 30_000) fail(new Error("Download connection paused")); };
    const abort = () => fail(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => fail(new Error("Download connection timed out")), 120_000);
    document.addEventListener("visibilitychange", visible); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    reader.read().then((chunk) => { clean(); resolve(chunk); }, (error) => { clean(); reject(error); });
  });
}
