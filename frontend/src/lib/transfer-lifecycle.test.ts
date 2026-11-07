import { afterEach, describe, expect, it, vi } from "vitest";
import { maintainTransferWakeLock, waitForTransferRecovery, transferDelay } from "./transfer-lifecycle";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("transfer lifecycle", () => {
  it("requests a screen wake lock while active and releases it at the end", async () => {
    const lock = { released: false, release: vi.fn(async () => {}) };
    const request = vi.fn(async () => lock);
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    const stop = maintainTransferWakeLock(true);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    stop(); expect(lock.release).toHaveBeenCalledOnce();
  });
  it("releases a late wake lock after transfers have finished", async () => {
    let resolve!: (lock: WakeLockSentinel) => void;
    const request = vi.fn(() => new Promise<WakeLockSentinel>((r) => { resolve = r; }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    const release = vi.fn(async () => {});
    const stop = maintainTransferWakeLock(true); stop();
    resolve({ released: false, release } as unknown as WakeLockSentinel);
    await Promise.resolve(); expect(release).toHaveBeenCalledOnce();
  });
  it("waits for visibility and network after an interruption, and allows cancel while waiting", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const controller = new AbortController();
    const pending = waitForTransferRecovery(controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await expect(waitForTransferRecovery()).resolves.toBeUndefined();
  });
  it("does not wait through backoff after cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(transferDelay(1000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
