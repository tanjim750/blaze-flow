import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __r2test, r2Transport } from "./r2-upload-transport";
import type { TransportJob } from "./upload-store";

type Put = { url: string; size: number; xhr: FakeXhr };
let puts: Put[] = [];
let failPart: number | null = null;
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
    queueMicrotask(() => {
      const part = Number(new URL(this.url).searchParams.get("part"));
      if (failPart !== null && part === failPart) { failPart = null; this.onerror?.(); return; }
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
  if (path.endsWith("/parts/")) return json(200, { parts: (body as { part_numbers: number[] }).part_numbers.map((n) => ({ part_number: n, url: `https://r2.example/key?part=${n}` })) });
  if (path.endsWith("/complete/")) return completeFails ? json(completeFails, {}) : json(201, { id: "pf-1" });
  if (/\/uploads\/[^/]+\/$/.test(path) && (init.method ?? "GET") === "GET") return json(200, statusQueue.shift() ?? { state: "FINALIZING", project_file: null });
  if (init.method === "DELETE") return json(204, null);
  return json(404, {});
}

const job = (file: File, resume: unknown = undefined): TransportJob & { saved: unknown[] } => {
  const saved: unknown[] = [];
  return { url: "/api/workspaces/ws/asset-files/", file, fields: { project_id: "p1" }, source: "files", direct: { workspaceId: "ws" }, resume, saveResume: (s) => saved.push(s), reportParts: () => {}, saved };
};
const MB = 1024 * 1024;

beforeEach(() => {
  puts = []; calls.length = 0; configEnabled = true; failPart = null; completeFails = 0; statusQueue = []; __r2test.reset();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubGlobal("fetch", vi.fn(fetchMock));
});
afterEach(() => vi.unstubAllGlobals());

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
    failPart = 2;
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
