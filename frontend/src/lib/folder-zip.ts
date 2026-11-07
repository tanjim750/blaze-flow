import { readDownloadChunk, transferDelay, waitForTransferRecovery } from "./transfer-lifecycle";
import { trackDownload } from "./download-store";

/**
 * "Download folder", built in the browser. The server only answers what goes in the zip and
 * hands out short-lived signed storage URLs; each file is fetched straight from R2 and written
 * into a STORED (uncompressed) ZIP64 archive. Nothing streams through the web workers.
 *
 * Where the bytes go: with the File System Access API (Chrome/Edge on desktop) the zip streams
 * straight to the file the user picked, so any size works with flat memory. Elsewhere it is
 * assembled as a Blob (browsers spill big blobs to disk, but not all do), capped at
 * BLOB_FALLBACK_MAX_BYTES with a clear message beyond it.
 */

export type FolderZipEntry = { path: string; size: number; url: string; modified?: string | null };
export type FolderZipManifest = {
  name: string; file_count: number; total_bytes: number;
  skipped: { path: string; reason: string }[];
  entries?: FolderZipEntry[]; empty_dirs?: string[]; urls_expire_at?: string;
};
export type FolderZipProgress = { doneBytes: number; totalBytes: number; filesDone: number; fileCount: number; current: string | null };
export type ZipSink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };

export const BLOB_FALLBACK_MAX_BYTES = 2 * 1024 ** 3;

// ----------------------------------------------------------------------------- CRC-32
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

// ----------------------------------------------------------------------------- ZIP64 writer
const utf8 = new TextEncoder();
type EntryRecord = { name: Uint8Array; offset: number; crc: number; size: number; time: number; date: number; dir: boolean };

function dosTime(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}
class Bytes {
  private view: DataView; readonly buf: Uint8Array; private at = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); }
  u16(v: number) { this.view.setUint16(this.at, v, true); this.at += 2; return this; }
  u32(v: number) { this.view.setUint32(this.at, v >>> 0, true); this.at += 4; return this; }
  u64(v: number) { this.view.setBigUint64(this.at, BigInt(v), true); this.at += 8; return this; }
  raw(v: Uint8Array) { this.buf.set(v, this.at); this.at += v.length; return this; }
}
const FLAGS = 0x0808; // data descriptor follows + UTF-8 names
const MAX32 = 0xffffffff;

/** Writes entries one after another; sizes and CRCs go in data descriptors, so nothing is buffered. */
export class ZipWriter {
  offset = 0;
  private records: EntryRecord[] = [];
  private current: EntryRecord | null = null;
  constructor(private sink: ZipSink) {}

  private async emit(chunk: Uint8Array) { this.offset += chunk.length; await this.sink.write(chunk); }

  async begin(path: string, { dir = false, modified = new Date() }: { dir?: boolean; modified?: Date } = {}) {
    const name = utf8.encode(dir && !path.endsWith("/") ? `${path}/` : path);
    const { time, date } = dosTime(modified);
    this.current = { name, offset: this.offset, crc: 0, size: 0, time, date, dir };
    await this.emit(new Bytes(30 + name.length + 20)
      .u32(0x04034b50).u16(45).u16(FLAGS).u16(0).u16(time).u16(date).u32(0).u32(MAX32).u32(MAX32).u16(name.length).u16(20)
      .raw(name).u16(0x0001).u16(16).u64(0).u64(0).buf);
  }
  async data(chunk: Uint8Array) {
    const record = this.current!;
    record.crc = crc32(chunk, record.crc); record.size += chunk.length;
    await this.emit(chunk);
  }
  async end() {
    const record = this.current!; this.current = null;
    await this.emit(new Bytes(24).u32(0x08074b50).u32(record.crc).u64(record.size).u64(record.size).buf);
    this.records.push(record);
  }
  async finish() {
    const start = this.offset; let size = 0;
    for (const r of this.records) {
      const header = new Bytes(46 + r.name.length + 28)
        .u32(0x02014b50).u16((3 << 8) | 45).u16(45).u16(FLAGS).u16(0).u16(r.time).u16(r.date).u32(r.crc).u32(MAX32).u32(MAX32)
        .u16(r.name.length).u16(28).u16(0).u16(0).u16(0).u32(r.dir ? ((0o40755 << 16) | 0x10) : (0o100644 << 16)).u32(MAX32)
        .raw(r.name).u16(0x0001).u16(24).u64(r.size).u64(r.size).u64(r.offset).buf;
      size += header.length; await this.emit(header);
    }
    const zip64End = this.offset, n = this.records.length;
    await this.emit(new Bytes(56 + 20 + 22)
      .u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(n).u64(n).u64(size).u64(start)
      .u32(0x07064b50).u32(0).u64(zip64End).u32(1)
      .u32(0x06054b50).u16(0).u16(0).u16(0xffff).u16(0xffff).u32(MAX32).u32(MAX32).u16(0).buf);
  }
}

// ----------------------------------------------------------------------------- sinks
type SavePicker = (options: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;

export const canStreamToDisk = () => typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function";

/** Must run inside the click handler (the picker needs the user's gesture). Null = user cancelled. */
export async function pickDiskSink(suggestedName: string): Promise<ZipSink | null> {
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
  let handle;
  try { handle = await picker({ suggestedName, types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }] }); }
  catch (error) { if ((error as Error).name === "AbortError") return null; throw error; }
  const writable = await handle.createWritable();
  return { write: (chunk) => writable.write(chunk), close: () => writable.close(), abort: () => writable.abort() };
}

/** Collects the zip as a Blob and saves it with an <a download> when done. */
export function blobSink(filename: string, save: (blob: Blob, filename: string) => void = saveBlob): ZipSink {
  let parts: BlobPart[] = [];
  return {
    async write(chunk) { parts.push(chunk as BlobPart); },
    async close() { save(new Blob(parts, { type: "application/zip" }), filename); parts = []; },
    async abort() { parts = []; },
  };
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ----------------------------------------------------------------------------- download
export class FolderZipError extends Error {}

/**
 * Fetches every entry and writes the zip into `sink`. A file that fails is left out and listed in
 * `_download-notes.txt` (with the server's own skips). If signed URLs expired (403), `refresh`
 * fetches a fresh manifest once and the file is retried. A network/CORS failure on the first
 * file stops the whole download with an explanation instead of producing an empty zip.
 */
export async function writeFolderZip({ manifest, sink, refresh, onProgress, signal, fetcher = fetch }: {
  manifest: FolderZipManifest; sink: ZipSink; refresh?: () => Promise<FolderZipManifest>;
  onProgress?: (progress: FolderZipProgress) => void; signal?: AbortSignal; fetcher?: typeof fetch;
}): Promise<{ skipped: { path: string; reason: string }[]; bytes: number }> {
  const entries = manifest.entries ?? [];
  const root = manifest.name.replace(/\.zip$/i, "");
  const zip = new ZipWriter(sink);
  const skipped = [...manifest.skipped];
  let urls = new Map(entries.map((entry) => [entry.path, entry.url]));
  let refreshed = false, anyOk = false, doneBytes = 0, filesDone = 0;
  const progress = (current: string | null) => onProgress?.({ doneBytes, totalBytes: manifest.total_bytes, filesDone, fileCount: entries.length, current });
  try {
    for (const dir of manifest.empty_dirs ?? []) { await zip.begin(dir, { dir: true }); await zip.end(); }
    for (const entry of entries) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      progress(entry.path);
      let response: Response | null = null;
      try {
        response = await fetcher(urls.get(entry.path)!, { signal, credentials: "omit", cache: "no-store" });
        if ((response.status === 403 || response.status === 400) && refresh && !refreshed) {
          refreshed = true;
          urls = new Map(((await refresh()).entries ?? []).map((item) => [item.path, item.url]));
          response = await fetcher(urls.get(entry.path) ?? entry.url, { signal, credentials: "omit", cache: "no-store" });
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        if (!anyOk) throw new FolderZipError("Couldn’t reach file storage from this browser. Check your connection; if it keeps happening, the storage bucket may not allow browser downloads yet (CORS).");
        skipped.push({ path: entry.path, reason: "couldn’t be fetched (network error)" }); continue;
      }
      if (!response.ok || !response.body) { skipped.push({ path: entry.path, reason: `couldn’t be fetched (HTTP ${response.status})` }); continue; }
      anyOk = true;
      await zip.begin(entry.path, { modified: entry.modified ? new Date(entry.modified) : new Date() });
      let reader = response.body.getReader();
      let received = 0, retries = 0;
      const etag = response.headers.get("ETag");
      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await readDownloadChunk(reader, signal);
            if (chunk.done && received !== entry.size) throw new Error("Download ended before the whole file arrived");
          } catch (error) {
            if (signal?.aborted || (error as Error).name === "AbortError" || retries >= 3) throw error;
            await reader.cancel().catch(() => {});
            await waitForTransferRecovery(signal);
            await transferDelay([1000, 4000, 10000][retries++], signal);
            // URLs may have expired while locked. Re-authorize before reconnecting.
            if (refresh) urls = new Map(((await refresh()).entries ?? []).map((item) => [item.path, item.url]));
            const next = await fetcher(urls.get(entry.path) ?? entry.url, {
              signal, credentials: "omit", cache: "no-store",
              headers: { Range: `bytes=${received}-`, ...(etag ? { "If-Match": etag } : {}) },
            });
            const range = next.headers.get("Content-Range");
            if (next.status !== 206 || range !== `bytes ${received}-${entry.size - 1}/${entry.size}` || !next.body || (etag && next.headers.get("ETag") !== etag))
              throw new FolderZipError("Storage could not safely resume this folder download. Please start it again.");
            reader = next.body.getReader();
            continue;
          }
          if (chunk.done) break;
          if (received + chunk.value.length > entry.size) throw new FolderZipError("The downloaded file changed size. Please start again.");
          await zip.data(chunk.value); received += chunk.value.length; doneBytes += chunk.value.length; progress(entry.path);
        }
      } finally { await reader.cancel().catch(() => {}); }
      await zip.end(); filesDone += 1;
    }
    if (skipped.length) {
      await zip.begin(`${root}/_download-notes.txt`);
      await zip.data(utf8.encode(`Some files in this folder were not included in the download:\n\n${skipped.map((s) => `- ${s.path}: ${s.reason}`).join("\n")}\n`));
      await zip.end();
    }
    await zip.finish();
    await sink.close();
    progress(null);
    return { skipped, bytes: doneBytes };
  } catch (error) {
    await sink.abort().catch(() => undefined);
    throw error;
  }
}

export function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1e3))} KB`;
}
export const percent = (p: FolderZipProgress) => (p.totalBytes ? Math.min(100, Math.floor((p.doneBytes / p.totalBytes) * 100)) : 0);

/**
 * The whole flow for one folder: pick where to save (inside the click), load the manifest,
 * check size limits for the Blob fallback, then write the zip.
 */
async function runFolderDownload({ folderName, loadManifest, onProgress, signal, onManifest }: {
  folderName: string; loadManifest: (retry: boolean) => Promise<FolderZipManifest>;
  onProgress?: (progress: FolderZipProgress) => void; onManifest?: (manifest: FolderZipManifest) => void; signal?: AbortSignal;
}): Promise<{ manifest: FolderZipManifest; skipped: { path: string; reason: string }[] } | null> {
  const filename = `${folderName.replace(/[\\/:*?"<>|]+/g, "_") || "folder"}.zip`;
  const disk = canStreamToDisk() ? await pickDiskSink(filename) : null;
  if (canStreamToDisk() && !disk) return null; // the user closed the save dialog
  let manifest: FolderZipManifest;
  try { manifest = await loadManifest(false); } catch (error) { await disk?.abort(); throw error; }
  onManifest?.(manifest);
  if (manifest.file_count === 0) { await disk?.abort(); throw new FolderZipError("This folder has no files ready to download yet."); }
  if (!disk && manifest.total_bytes > BLOB_FALLBACK_MAX_BYTES) {
    throw new FolderZipError(`This folder is ${formatBytes(manifest.total_bytes)}. This browser can only save folder zips up to ${formatBytes(BLOB_FALLBACK_MAX_BYTES)}; use Chrome or Edge on a computer, or download its subfolders one by one.`);
  }
  const { skipped } = await writeFolderZip({ manifest, sink: disk ?? blobSink(manifest.name), refresh: () => loadManifest(true), onProgress, signal });
  return { manifest, skipped };
}

/** Keep all page-managed downloads cancellable from the global transfer tray. */
export async function downloadFolderZip(options: Parameters<typeof runFolderDownload>[0]) {
  const tracked = trackDownload(options.folderName, options.signal);
  try { return await runFolderDownload({ ...options, signal: tracked.signal }); }
  finally { tracked.finish(); }
}
