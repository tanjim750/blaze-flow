import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __r2test, putBlob, r2Transport } from "./r2-upload-transport";
import type { TransportJob } from "./upload-store";

type Put = { url: string; size: number; xhr: FakeXhr };
let puts: Put[] = [];
let storageParts: { partNumber: number; etag: string }[] = [];
let failPart: number | null = null;
let failTimes = 1;
let putStatus: number | null = null;
let onPut: (() => void) | null = null;
let refuseComplete: { status: number; body: unknown } | null = null;
class FakeXhr {
  status = 0; url = ""; method = ""; headers: Record<string, string> = {};
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  getResponseHeader() { return '"etag"'; }
  abort() { this.onabort?.(); }
  send(body: Blob) {
    puts.push({ url: this.url, size: body.size, xhr: this });
    onPut?.();
    queueMicrotask(() => {
      const part = Number(new URL(this.url).searchParams.get("part"));
      if (failPart !== null && part === failPart) { failTimes -= 1; if (failTimes <= 0) failPart = null; if (putStatus) { this.status = putStatus; this.onload?.(); } else this.onerror?.(); return; }
      if (part) storageParts = [...storageParts.filter((p) => p.partNumber !== part), { partNumber: part, etag: '"etag"' }];
      this.upload.onprogress?.({ loaded: body.size }); this.status = 200; this.onload?.();
    });
  }
}

const calls: { path: string; body: unknown; method: string }[] = [];
let configEnabled = true;
let completeFails = 0;
let statusQueue: unknown[] = [];
let initResponse: { status: number; body: unknown } = { status: 201, body: {} };
function fetchMock(input: string, init: RequestInit) {
  const path = input.replace(/^\/api/, "");
  const body = init.body ? JSON.parse(init.body as string) : null;
  calls.push({ path, body, method: init.method ?? "GET" });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status }));
  if (path.endsWith("/uploads/config/")) return json(200, { enabled: configEnabled });
  if (path.endsWith("/uploads/") && init.method === "POST") return json(initResponse.status, initResponse.body);
  if (path.endsWith("/parts/") && !init.method) return json(200, { parts: storageParts });
  if (path.endsWith("/parts/")) return json(200, { parts: (body as { part_numbers: number[] }).part_numbers.map((n) => ({ part_number: n, url: `https://r2.example/key?part=${n}` })) });
  if (path.endsWith("/complete/") && refuseComplete) return json(refuseComplete.status, refuseComplete.body);
  if (path.endsWith("/complete/")) return completeFails ? json(completeFails, {}) : json(201, { id: "pf-1" });
  if (/\/uploads\/[^/]+\/$/.test(path) && (init.method ?? "GET") === "GET") return json(200, statusQueue.shift() ?? { state: completeFails ? "FINALIZING" : "INITIALIZED", project_file: null });
  if (init.method === "DELETE") return json(204, null);
  return json(404, {});
}

const job = (file: File, resume: unknown = undefined): TransportJob & { saved: unknown[] } => {
  const saved: unknown[] = [];
  return { url: "/api/workspaces/ws/asset-files/", file, fields: { project_id: "p1" }, source: "files", direct: { workspaceId: "ws" }, resume, saveResume: (s) => saved.push(s), reportParts: () => {}, saved };
};
const MB = 1024 * 1024;

beforeEach(() => {
  puts = []; storageParts = []; calls.length = 0; configEnabled = true; failPart = null; failTimes = 1; putStatus = null; onPut = null; refuseComplete = null; completeFails = 0; statusQueue = []; __r2test.reset(); __r2test.setRetryDelays([0, 0, 0]);
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubGlobal("fetch", vi.fn(fetchMock));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("r2 transport", () => {
  it("only claims requests marked direct", () => {
    expect(r2Transport.supports({ url: "/u", file: new File(["a"], "a"), source: "files" })).toBe(false);
    expect(r2Transport.supports({ url: "/u", file: new File(["a"], "a"), source: "files", direct: { workspaceId: "ws" } })).toBe(true);
  });

  it("small file: presigned PUT straight to storage, then complete", async () => {
    initResponse = { status: 201, body: { id: "u1", mode: "single", url: "https://r2.example/key?sig", headers: { "Content-Type": "image/png" } } };
    const progress: number[] = [];
    const result = await r2Transport.send(job(new File([new Uint8Array(10)], "a.png", { type: "image/png" })), (loaded) => progress.push(loaded), new AbortController().signal);
    expect(result).toEqual({ ok: true, data: { id: "pf-1" } });
    expect(puts[0].url).toBe("https://r2.example/key?sig");
    expect(puts[0].xhr.headers["Content-Type"]).toBe("image/png");
    expect(calls[0].path).toBe("/workspaces/ws/uploads/config/");
    expect(calls[1].body).toMatchObject({ name: "a.png", size: 10, content_type: "image/png", project_id: "p1" });
    expect(calls.at(-1)!.path).toBe("/workspaces/ws/uploads/u1/complete/");
    expect(progress.at(-1)).toBe(10);
  });

  it("multipart: parallel parts, aggregate progress, resume after a failed part", async () => {
    initResponse = { status: 201, body: { id: "u2", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
    const file = new File([new Uint8Array(11 * MB)], "cut.mp4", { type: "video/mp4" });
    failPart = 2; failTimes = 4; // more drops than the per-part retries absorb
    const first = job(file);
    const failed = await r2Transport.send(first, () => {}, new AbortController().signal);
    expect(failed.ok).toBe(false);
    const resume = first.saved.at(-1) as { completed: { partNumber: number }[] };
    expect(resume.completed.map((p) => p.partNumber)).not.toContain(2);
    puts = [];
    const progress: number[] = [];
    const retried = await r2Transport.send(job(file, resume), (loaded) => progress.push(loaded), new AbortController().signal);
    expect(retried.ok).toBe(true);
    // Only the parts that had not landed are sent again.
    expect(puts.length).toBe(3 - resume.completed.length);
    expect(progress.at(-1)).toBe(11 * MB);
    expect(calls.filter((c) => c.path.endsWith("/uploads/") && c.method === "POST")).toHaveLength(1);
  });

  it("retries a dropped or expired (403) part with a fresh URL instead of failing the file", async () => {
    initResponse = { status: 201, body: { id: "u3", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
    const file = new File([new Uint8Array(11 * MB)], "big.zip", { type: "application/zip" });
    failPart = 2; failTimes = 2; putStatus = 403;
    const result = await r2Transport.send(job(file), () => {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    // Initial batch plus one forced re-issue per failed attempt for part 2.
    const partCalls = calls.filter((c) => c.path.endsWith("/parts/") && c.method === "POST");
    expect(partCalls.length).toBe(3);
    expect(partCalls.slice(1).every((c) => (c.body as { part_numbers: number[] }).part_numbers[0] === 2)).toBe(true);
  });

  it("concurrent parts share one URL request", async () => {
    initResponse = { status: 201, body: { id: "u4", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
    const file = new File([new Uint8Array(11 * MB)], "c.mp4", { type: "video/mp4" });
    const result = await r2Transport.send(job(file), () => {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.path.endsWith("/parts/") && c.method === "POST")).toHaveLength(1);
  });

  it("re-requests part URLs once they are about to expire", async () => {
    const realNow = Date.now;
    let clock = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    initResponse = { status: 201, body: { id: "u5", mode: "multipart", part_size: 5 * MB, part_count: 5 } };
    const file = new File([new Uint8Array(21 * MB)], "slow.mp4", { type: "video/mp4" });
    onPut = () => { clock += 20 * 60_000; }; // each part takes longer than the URL lifetime
    const result = await r2Transport.send(job(file), () => {}, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.path.endsWith("/parts/") && c.method === "POST").length).toBeGreaterThan(1);
  });

  it("marks a deterministic refusal at /complete as not retryable", async () => {
    initResponse = { status: 201, body: { id: "u6", mode: "single", url: "https://r2.example/key?part=0" } };
    refuseComplete = { status: 400, body: { detail: "The file signature does not match.", code: "not_retryable" } };
    const result = await r2Transport.send(job(new File(["abc"], "x.zip")), () => {}, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it("falls back to the form upload when the server has direct uploads off", async () => {
    initResponse = { status: 409, body: { detail: "Direct uploads are not enabled.", code: "direct_uploads_disabled" } };
    const posts: string[] = [];
    FakeXhr.prototype.open = function (this: FakeXhr, method: string, url: string) { this.method = method; this.url = `http://localhost${url}`; posts.push(`${method} ${url}`); };
    const result = await r2Transport.send(job(new File(["abc"], "a.png", { type: "image/png" })), () => {}, new AbortController().signal);
    expect(posts).toEqual(["POST /api/workspaces/ws/asset-files/"]);
    expect(result.ok).toBe(true);
    expect(r2Transport.supports({ url: "/u", file: new File(["a"], "a"), source: "files", direct: { workspaceId: "ws" } })).toBe(false);
  });
  it("checks uploads/config once and never POSTs initialize when direct uploads are off", async () => {
    configEnabled = false;
    const posts: string[] = [];
    const open = FakeXhr.prototype.open;
    FakeXhr.prototype.open = function (this: FakeXhr, method: string, url: string) { this.method = method; this.url = `http://localhost${url}`; posts.push(`${method} ${url}`); };
    try {
      for (const name of ["a.png", "b.png"]) {
        const result = await r2Transport.send(job(new File(["abc"], name, { type: "image/png" })), () => {}, new AbortController().signal);
        expect(result.ok).toBe(true);
      }
    } finally { FakeXhr.prototype.open = open; }
    expect(posts).toEqual(["POST /api/workspaces/ws/asset-files/", "POST /api/workspaces/ws/asset-files/"]);
    expect(calls.filter((c) => c.path.endsWith("/uploads/") && c.method === "POST")).toHaveLength(0);
    expect(calls.filter((c) => c.path.endsWith("/uploads/config/"))).toHaveLength(1);
    expect(r2Transport.supports({ url: "/u", file: new File(["a"], "a"), source: "files", direct: { workspaceId: "ws" } })).toBe(false);
  });

  it("caches an enabled config per workspace across uploads", async () => {
    initResponse = { status: 201, body: { id: "u1", mode: "single", url: "https://r2.example/key?sig" } };
    for (let i = 0; i < 2; i += 1) await r2Transport.send(job(new File([new Uint8Array(4)], `f${i}.png`)), () => {}, new AbortController().signal);
    expect(calls.filter((c) => c.path.endsWith("/uploads/config/"))).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/uploads/") && c.method === "POST")).toHaveLength(2);
  });

  it("a 500 on /complete is confirmed by polling the session and counts as success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      initResponse = { status: 201, body: { id: "u9", mode: "single", url: "https://r2.example/key?sig", headers: {} } };
      completeFails = 500;
      statusQueue = [{ state: "FINALIZING", project_file: null }, { state: "COMPLETED", project_file: { id: "pf-9" } }];
      const pending = r2Transport.send(job(new File([new Uint8Array(10)], "big.mp4")), () => {}, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(await pending).toEqual({ ok: true, data: { id: "pf-9" } });
      expect(calls.filter((c) => c.path === "/workspaces/ws/uploads/u9/" && c.method === "GET")).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("reports the failure when the session ends FAILED, and gives up after the poll window", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      initResponse = { status: 201, body: { id: "u10", mode: "single", url: "https://r2.example/key?sig", headers: {} } };
      completeFails = 502;
      statusQueue = [{ state: "FAILED", error: "Virus found.", project_file: null }];
      const failed = r2Transport.send(job(new File([new Uint8Array(10)], "x.mp4")), () => {}, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(await failed).toMatchObject({ ok: false, error: "Virus found." });

      initResponse = { status: 201, body: { id: "u11", mode: "single", url: "https://r2.example/key?sig", headers: {} } };
      const timedOut = r2Transport.send(job(new File([new Uint8Array(10)], "y.mp4")), () => {}, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(await timedOut).toMatchObject({ ok: false, status: 502 });
    } finally { vi.useRealTimers(); }
  });
});

it("resumes server-listed parts even if the browser never saved their successful replies", async () => {
  initResponse = { status: 201, body: { id: "recovered", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
  storageParts = [{ partNumber: 1, etag: '"server-etag"' }, { partNumber: 2, etag: '"server-etag"' }];
  const file = new File([new Uint8Array(11 * MB)], "reselected.mov", { lastModified: 123 });
  const result = await r2Transport.send(job(file), () => {}, new AbortController().signal);
  expect(result.ok).toBe(true);
  expect(puts.map((p) => new URL(p.url).searchParams.get("part"))).toEqual(["3"]);
  expect(calls.find((c) => c.path.endsWith("/uploads/") && c.method === "POST")?.body).toMatchObject({ last_modified: 123, project_id: "p1" });
});

it("does not reuse a saved session for the same file in a different destination", async () => {
  initResponse = { status: 201, body: { id: "first", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
  const file = new File([new Uint8Array(11 * MB)], "cut.mov", { lastModified: 77 });
  failPart = 2; failTimes = 4;
  await r2Transport.send(job(file), () => {}, new AbortController().signal);
  initResponse = { status: 201, body: { id: "second", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
  storageParts = [];
  const next = job(file); next.fields = { project_id: "p2" };
  await r2Transport.send(next, () => {}, new AbortController().signal);
  expect(calls.filter((c) => c.path.endsWith("/uploads/") && c.method === "POST")).toHaveLength(2);
  expect(calls.some((c) => c.path === "/workspaces/ws/uploads/first/" && c.method === "GET")).toBe(false);
});

it("aborts the server multipart session when a part is cancelled", async () => {
  initResponse = { status: 201, body: { id: "cancel", mode: "multipart", part_size: 5 * MB, part_count: 3 } };
  const controller = new AbortController();
  onPut = () => controller.abort();
  const result = await r2Transport.send(job(new File([new Uint8Array(11 * MB)], "cancel.mov")), () => {}, controller.signal);
  expect(result).toMatchObject({ ok: false, error: "Cancelled." });
  expect(calls.some((c) => c.path === "/workspaces/ws/uploads/cancel/" && c.method === "DELETE")).toBe(true);
});

it("ignores malformed saved resume metadata instead of blocking a new upload", async () => {
  localStorage.setItem("bf.direct-uploads.v2", "null");
  initResponse = { status: 201, body: { id: "fresh", mode: "single", url: "https://r2.example/key" } };
  const result = await r2Transport.send(job(new File(["hello"], "new.txt")), () => {}, new AbortController().signal);
  expect(result.ok).toBe(true);
});


it("only times out stalled PUTs, not healthy slow parts that keep reporting progress", async () => {
  vi.useFakeTimers();
  let active!: FakeXhr;
  class SlowXhr extends FakeXhr {
    send(body: Blob) { active = this; expect(body.size).toBe(3); }
  }
  vi.stubGlobal("XMLHttpRequest", SlowXhr);
  try {
    const pending = putBlob("https://r2.example/slow", new Blob(["abc"]), {}, () => {}, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow(/Connection paused/);
    await vi.advanceTimersByTimeAsync(110_000);
    active.upload.onprogress?.({ loaded: 1 });
    await vi.advanceTimersByTimeAsync(110_000);
    active.upload.onprogress?.({ loaded: 2 });
    // More than three minutes have passed; the part is still allowed to make progress.
    await vi.advanceTimersByTimeAsync(120_001);
    await rejected;
  } finally { vi.useRealTimers(); }
});
