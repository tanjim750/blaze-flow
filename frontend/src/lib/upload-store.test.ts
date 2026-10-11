import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __test, CONCURRENCY, cancelUpload, clearFinished, dismissUpload, etaSeconds, formatEta, formatRate, getUploads, hasActiveUploads,
  formatBytes, percent, registerTransport, retryUpload, startUpload, trayCounts, trayTotals, type Transport, type UploadResult,
} from "./upload-store";

type Call = { file: File; progress: (loaded: number, total: number) => void; resolve: (result: UploadResult) => void; signal: AbortSignal };
let calls: Call[] = [];
let clock = 0;
const transport: Transport = (request, progress, signal) => new Promise((resolve) => {
  calls.push({ file: request.file, progress, resolve, signal });
  signal.addEventListener("abort", () => resolve({ ok: false, status: 0, error: "Cancelled." }));
});
const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __test.reset(); calls = []; clock = 1000;
  __test.setTransport(transport);
  __test.setClock(() => clock);
  __test.setProcessing(async () => ({ stage: "ready", label: "Ready", ready: true }));
});
afterEach(() => vi.useRealTimers());

describe("upload store", () => {
  it("queues, reports progress, speed and ETA, then finishes", async () => {
    startUpload({ url: "/u", file: file("a.mp4", 10_000), source: "files" });
    expect(getUploads()[0].status).toBe("uploading");
    clock += 1000; calls[0].progress(4000, 10_000);
    const item = getUploads()[0];
    expect(percent(item)).toBe(40);
    expect(item.speed).toBe(4000);
    expect(etaSeconds(item)).toBe(2);
    expect(hasActiveUploads()).toBe(true);
    calls[0].resolve({ ok: true, data: {} });
    await flush();
    expect(getUploads()[0].status).toBe("ready");
    expect(hasActiveUploads()).toBe(false);
  });

  it(`runs at most ${CONCURRENCY} at once and starts the next when one lands`, async () => {
    for (let index = 0; index < CONCURRENCY + 2; index += 1) startUpload({ url: "/u", file: file(`f${index}`), source: "files" });
    expect(calls).toHaveLength(CONCURRENCY);
    expect(getUploads().filter((item) => item.status === "queued")).toHaveLength(2);
    calls[0].resolve({ ok: true, data: {} });
    await flush();
    expect(calls).toHaveLength(CONCURRENCY + 1);
  });

  it("cancels an upload in flight and one still queued", async () => {
    const running = startUpload({ url: "/u", file: file("a"), source: "files" });
    for (let index = 0; index < CONCURRENCY; index += 1) startUpload({ url: "/u", file: file(`q${index}`), source: "files" });
    const queuedId = getUploads()[CONCURRENCY].id;
    cancelUpload(queuedId);
    cancelUpload(running.id);
    expect(calls[0].signal.aborted).toBe(true);
    expect(await running.done).toEqual({ ok: false, status: 0, error: "Cancelled." });
    expect(getUploads().find((item) => item.id === running.id)!.status).toBe("cancelled");
    expect(getUploads().find((item) => item.id === queuedId)!.status).toBe("cancelled");
  });

  it("keeps a failure with its message, and a retry that lands calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const upload = startUpload({ url: "/u", file: file("a"), source: "portal", onSuccess });
    calls[0].resolve({ ok: false, status: 500, error: "The upload failed (500)." });
    expect(await upload.done).toMatchObject({ ok: false });
    expect(getUploads()[0]).toMatchObject({ status: "failed", error: "The upload failed (500)." });
    expect(trayCounts(getUploads()).failed).toBe(1);
    retryUpload(upload.id);
    expect(getUploads()[0]).toMatchObject({ status: "uploading", attempts: 2, error: null });
    calls[1].resolve({ ok: true, data: { id: "x" } });
    await flush();
    expect(onSuccess).toHaveBeenCalledWith({ id: "x" });
    expect(getUploads()[0].status).toBe("ready");
  });

  it("follows scan and proxy after the bytes land, and links to the result", async () => {
    vi.useFakeTimers();
    const stages = [{ stage: "scanning", label: "Scanning", ready: false }, { stage: "proxy", label: "Making proxy", ready: false }, { stage: "ready", label: "Ready", ready: true }];
    __test.setProcessing(async () => stages.shift()!);
    startUpload({ url: "/u", file: file("cut.mp4"), source: "project", describe: () => ({ workspaceId: "w", fileId: "f", href: "/review?media=f" }) });
    calls[0].resolve({ ok: true, data: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(getUploads()[0]).toMatchObject({ status: "processing", href: "/review?media=f" });
    expect(getUploads()[0].processing?.label).toBe("Scanning");
    expect(percent(getUploads()[0])).toBe(100);
    await vi.advanceTimersByTimeAsync(2600);
    expect(getUploads()[0].processing?.label).toBe("Making proxy");
    await vi.advanceTimersByTimeAsync(2600);
    expect(getUploads()[0].status).toBe("ready");
  });

  it("a failed scan fails the upload", async () => {
    __test.setProcessing(async () => ({ stage: "failed", label: "Failed the security scan", ready: false }));
    startUpload({ url: "/u", file: file("x.zip"), source: "files", describe: () => ({ workspaceId: "w", fileId: "f" }) });
    calls[0].resolve({ ok: true, data: {} });
    await flush(); await flush();
    expect(getUploads()[0]).toMatchObject({ status: "failed", error: "Failed the security scan" });
  });

  it("clear finished keeps active uploads; dismiss removes one finished row", async () => {
    const a = startUpload({ url: "/u", file: file("a"), source: "files" });
    startUpload({ url: "/u", file: file("b"), source: "files" });
    calls[0].resolve({ ok: true, data: {} });
    await flush();
    dismissUpload(getUploads()[1].id); // active: ignored
    expect(getUploads()).toHaveLength(2);
    clearFinished();
    expect(getUploads().map((item) => item.name)).toEqual(["b"]);
    expect(getUploads().some((item) => item.id === a.id)).toBe(false);
  });

  it("formats rates and ETAs", () => {
    expect(formatRate(2.5 * 1024 * 1024)).toBe("2.5 MB/s");
    expect(formatRate(2048)).toBe("2 KB/s");
    expect(formatEta(42)).toBe("42s left");
    expect(formatEta(125)).toBe("2m 5s left");
  });
});

describe("pluggable transports", () => {
  it("uses a registered transport that supports the request, else the fallback", async () => {
    const seen: string[] = [];
    __test.setTransport({ id: "fallback", supports: () => true, send: async () => { seen.push("fallback"); return { ok: true, data: {} }; } });
    registerTransport({ id: "r2", supports: (request) => request.file.size > 100, send: async (job, progress) => { seen.push("r2"); progress(job.file.size, job.file.size); return { ok: true, data: {} }; } });
    startUpload({ url: "/u", file: file("big", 1000), source: "files" });
    startUpload({ url: "/u", file: file("small", 10), source: "files" });
    await flush();
    expect(seen).toEqual(["r2", "fallback"]);
    expect(getUploads().map((item) => item.transport)).toEqual(["r2", "fallback"]);
  });

  it("keeps resume state and part counts across a retry", async () => {
    const resumes: unknown[] = [];
    let attempt = 0;
    registerTransport({ id: "parts", supports: () => true, send: async (job, progress) => {
      resumes.push(job.resume); attempt += 1;
      job.reportParts({ done: 1, total: 2 });
      progress(500, 1000);
      if (attempt === 1) { job.saveResume({ completed: [1] }); return { ok: false, status: 0, error: "Network" }; }
      job.reportParts({ done: 2, total: 2 });
      return { ok: true, data: {} };
    } });
    const { id } = startUpload({ url: "/u", file: file("v.mov", 1000), source: "files" });
    await flush();
    expect(getUploads()[0].status).toBe("failed");
    expect(getUploads()[0].parts).toEqual({ done: 1, total: 2 });
    retryUpload(id);
    await flush();
    expect(resumes).toEqual([undefined, { completed: [1] }]);
    expect(getUploads()[0].status).toBe("ready");
  });

  it("treats a throwing transport as a failed upload", async () => {
    registerTransport({ id: "boom", supports: () => true, send: async () => { throw new Error("Init refused"); } });
    startUpload({ url: "/u", file: file("x"), source: "files" });
    await flush();
    expect(getUploads()[0]).toMatchObject({ status: "failed", error: "Init refused" });
  });

  it("totals bytes moved, remaining, combined speed and ETA", () => {
    startUpload({ url: "/u", file: file("a", 10_000), source: "files" });
    startUpload({ url: "/u", file: file("b", 10_000), source: "files" });
    clock += 1000; calls[0].progress(4000, 10_000); calls[1].progress(1000, 10_000);
    const totals = trayTotals(getUploads());
    expect(totals).toMatchObject({ size: 20_000, loaded: 5000, remaining: 15_000, speed: 5000, eta: 3, percent: 25 });
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
