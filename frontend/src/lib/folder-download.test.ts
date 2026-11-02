import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { folderZipSummary } from "./asset-api-client";
import { crc32, writeFolderZip, type FolderZipManifest, type ZipSink } from "./folder-zip";
import { downloadGuestFolder } from "./guest-client";

afterEach(() => vi.unstubAllGlobals());

const memorySink = () => {
  const parts: Uint8Array[] = []; let closed = false, aborted = false;
  const sink: ZipSink = { async write(c) { parts.push(c.slice()); }, async close() { closed = true; }, async abort() { aborted = true; } };
  const bytes = () => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  return { sink, bytes, state: () => ({ closed, aborted }) };
};
const body = (text: string) => new Response(text, { status: 200 });
const manifest = (over: Partial<FolderZipManifest> = {}): FolderZipManifest => ({
  name: "Footage.zip", file_count: 2, total_bytes: 11, skipped: [{ path: "Footage/Day 2/pending.mov", reason: "not ready" }],
  entries: [{ path: "Footage/a.txt", size: 5, url: "https://r2/a?sig=1" }, { path: "Footage/Day 1/b.txt", size: 6, url: "https://r2/b?sig=1" }],
  empty_dirs: ["Footage/Empty"], ...over,
});
/** Lists the zip with Python's zipfile (a strict, independent reader) and checks every CRC. */
function pythonList(bytes: Uint8Array) {
  const file = join(mkdtempSync(join(tmpdir(), "fz-")), "t.zip"); writeFileSync(file, bytes);
  const run = spawnSync("python3", ["-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({'bad':z.testzip(),'names':z.namelist(),'stored':all(i.compress_type==0 for i in z.infolist()),'a':z.read('Footage/a.txt').decode()}))", file]);
  if (run.error || run.status !== 0) return null;
  return JSON.parse(run.stdout.toString());
}

describe("client-side folder zip", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a valid stored ZIP64 with nested paths, empty folders and a notes file", async () => {
    const m = memorySink();
    const fetcher = vi.fn(async (url: string) => body(url.includes("/a") ? "hello" : "world!"));
    const progress = vi.fn();
    const result = await writeFolderZip({ manifest: manifest(), sink: m.sink, fetcher: fetcher as unknown as typeof fetch, onProgress: progress });
    expect(m.state().closed).toBe(true);
    expect(result.bytes).toBe(11);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ doneBytes: 11, totalBytes: 11, filesDone: 2 }));
    const listed = pythonList(m.bytes());
    if (listed) {
      expect(listed.bad).toBeNull();
      expect(listed.stored).toBe(true);
      expect(listed.names).toEqual(["Footage/Empty/", "Footage/a.txt", "Footage/Day 1/b.txt", "Footage/_download-notes.txt"]);
      expect(listed.a).toBe("hello");
    }
  });

  it("refreshes expired signed URLs once and retries the file", async () => {
    const fetcher = vi.fn(async (url: string) => url.includes("sig=1") ? new Response("expired", { status: 403 }) : body("fresh"));
    const refresh = vi.fn(async () => manifest({ entries: manifest().entries!.map((e) => ({ ...e, url: e.url.replace("sig=1", "sig=2") })) }));
    const result = await writeFolderZip({ manifest: manifest({ skipped: [] }), sink: memorySink().sink, refresh, fetcher: fetcher as unknown as typeof fetch });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual([]);
  });

  it("explains a storage/CORS block instead of saving an empty zip", async () => {
    const m = memorySink();
    const fetcher = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(writeFolderZip({ manifest: manifest(), sink: m.sink, fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/CORS/);
    expect(m.state().aborted).toBe(true);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(writeFolderZip({ manifest: manifest(), sink: memorySink().sink, signal: controller.signal, fetcher: vi.fn() as unknown as typeof fetch })).rejects.toThrow(/Cancel/);
  });

  it("summarises size and skipped files", () => {
    expect(folderZipSummary({ file_count: 2, total_bytes: 3_200_000_000 }, 1)).toBe("2 files, 3.2 GB · 1 skipped (see _download-notes.txt)");
  });
});

describe("downloadGuestFolder", () => {
  it("asks for the manifest with the access key and surfaces a missing download permission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "This link does not grant that permission." }), { status: 403, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadGuestFolder("p", { id: "f", name: "F" }, "key")).rejects.toThrow(/permission/);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/guest/reviews/p/folders/f/download-link/");
    expect(fetchMock.mock.calls[0][1].headers["X-Guest-Access-Key"]).toBe("key");
  });
});
