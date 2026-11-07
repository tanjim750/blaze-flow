import { beforeEach, describe, expect, it } from "vitest";
import {
  __test, getUploads, PARK_KEY, PARK_TTL_MS, readParked, registerTransport, restoreParked, resumeFromFiles, resumeParked, startUpload,
  type TransportJob, type UploadResult,
} from "./upload-store";

type Call = { job: TransportJob; resolve: (result: UploadResult) => void };
let calls: Call[] = [];
let clock = 0;
const file = (name: string, size = 1000, lastModified = 111) => new File([new Uint8Array(size)], name, { lastModified, type: "video/mp4" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __test.reset(); calls = []; clock = 1_000_000;
  __test.setClock(() => clock);
  __test.setProcessing(async () => ({ stage: "ready", label: "Ready", ready: true }));
  registerTransport({ id: "fake", supports: () => true, send: (job) => new Promise((resolve) => { calls.push({ job, resolve }); }) });
});

function startDirect(name = "big.mov", size = 5000) {
  return startUpload({ url: "/api/workspaces/w1/asset-files/", file: file(name, size), fields: { folder_id: "f9" }, source: "files", destination: "Spring · Files", direct: { workspaceId: "w1" } });
}

describe("uploads survive a page reload", () => {
  it("parks unfinished uploads with what is needed to find the file again", () => {
    startDirect();
    calls[0].job.saveResume({ id: "du-1", mode: "multipart", completed: [] });
    calls[0].job.reportParts({ done: 3, total: 10 });
    const [row] = readParked();
    expect(row).toMatchObject({
      name: "big.mov", size: 5000, lastModified: 111, url: "/api/workspaces/w1/asset-files/", fields: { folder_id: "f9" },
      destination: "Spring · Files", direct: { workspaceId: "w1" }, uploadId: "du-1", parts: { done: 3, total: 10 },
    });
  });

  it("forgets an upload once it finishes or is cancelled", async () => {
    startDirect();
    expect(readParked()).toHaveLength(1);
    calls[0].resolve({ ok: true, data: {} });
    await flush();
    expect(localStorage.getItem(PARK_KEY)).toBeNull();
  });

  it("restores them as paused, and the same file continues the saved upload", async () => {
    startDirect();
    calls[0].job.reportParts({ done: 3, total: 10 });
    __test.reload();
    expect(getUploads()).toHaveLength(0);
    expect(restoreParked()).toBe(1);
    expect(restoreParked()).toBe(0); // idempotent
    const [paused] = getUploads();
    expect(paused).toMatchObject({ status: "paused", name: "big.mov", parts: { done: 3, total: 10 }, expired: false });

    expect(resumeParked(paused.id, file("big.mov", 5000, 999))).toBe(false); // different lastModified
    expect(resumeFromFiles([file("other.mov", 5000)]).unmatched).toHaveLength(1);
    expect(getUploads()[0].status).toBe("paused");

    expect(resumeFromFiles([file("big.mov", 5000)]).resumed).toBe(1);
    expect(getUploads()[0].status).toBe("uploading");
    const job = calls[calls.length - 1].job;
    expect(job.resume).toBeUndefined(); // the direct transport looks up its saved parts
    expect(job.direct).toEqual({ workspaceId: "w1" });
    expect(job.fields).toEqual({ folder_id: "f9" });
    calls[calls.length - 1].resolve({ ok: true, data: { file: { id: "file-1" } } });
    await flush(); await flush();
    expect(getUploads()[0].status).toBe("ready");
    expect(readParked()).toHaveLength(0);
  });

  it("starts clean when the upload sat paused past the server's 24h window", () => {
    startDirect();
    __test.reload();
    clock += PARK_TTL_MS + 1;
    restoreParked();
    expect(getUploads()[0].expired).toBe(true);
    resumeFromFiles([file("big.mov", 5000)]);
    expect(calls[calls.length - 1].job.resume).toBeNull();
    expect(getUploads()[0].parts).toBeNull();
  });

  it("a paused upload is not active, so it does not block the queue", () => {
    startDirect("a.mov");
    __test.reload();
    restoreParked();
    startDirect("b.mov");
    expect(getUploads().map((item) => item.status)).toEqual(["paused", "uploading"]);
  });
});
