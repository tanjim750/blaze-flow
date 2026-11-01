import { describe, expect, it } from "vitest";
import {
  acceptedSummary, formatBytes, kindOf, linkSummary, localInputToIso, megabytesToBytes, rejectReason, uploadError,
} from "./client-uploads";

const MB = 1024 * 1024;

describe("kindOf", () => {
  it("reads the MIME type first and falls back to the extension", () => {
    expect(kindOf({ name: "a.mov", type: "video/quicktime" })).toBe("video");
    expect(kindOf({ name: "logo.png", type: "image/png" })).toBe("image");
    expect(kindOf({ name: "vo.wav", type: "audio/wav" })).toBe("audio");
    expect(kindOf({ name: "brief.pdf", type: "application/pdf" })).toBe("document");
    expect(kindOf({ name: "deck.pptx", type: "" })).toBe("document");
    expect(kindOf({ name: "raw.MOV", type: "" })).toBe("video");
    expect(kindOf({ name: "setup.exe", type: "application/x-msdownload" })).toBeNull();
  });
});

describe("formatBytes", () => {
  it("rounds like a file browser", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48 * 1024)).toBe("48 KB");
    expect(formatBytes(1.5 * 1024 * MB)).toBe("1.5 GB");
    expect(formatBytes(320 * MB)).toBe("320 MB");
    expect(formatBytes(-1)).toBe("?");
  });
});

describe("rejectReason", () => {
  const rules = { maxBytes: 100 * MB, allowedKinds: [] as never[] };
  it("passes an accepted file", () => {
    expect(rejectReason({ name: "a.mp4", type: "video/mp4", size: 5 * MB }, rules)).toBeNull();
  });
  it("refuses empty, oversized, unknown and disallowed files with a reason", () => {
    expect(rejectReason({ name: "a.mp4", type: "video/mp4", size: 0 }, rules)).toBe("This file is empty.");
    expect(rejectReason({ name: "a.mp4", type: "video/mp4", size: 200 * MB }, rules)).toBe("Too large: 200 MB, the limit is 100 MB.");
    expect(rejectReason({ name: "a.zip", type: "application/zip", size: 10 }, rules)).toBe("This type of file is not accepted.");
    expect(rejectReason({ name: "a.png", type: "image/png", size: 10 }, { maxBytes: MB, allowedKinds: ["video", "document"] }))
      .toBe("Only video and documents can be sent here.");
  });
});

describe("summaries", () => {
  it("describes what a link accepts", () => {
    expect(acceptedSummary([])).toBe("Video, images, audio and documents");
    expect(acceptedSummary(["video"])).toBe("Video");
    expect(acceptedSummary(["video", "image", "document"])).toBe("Video, images and documents");
  });

  it("summarises a link's state and count", () => {
    const base = { due_at: null, expires_at: null, revoked_at: null, upload_count: 0 };
    expect(linkSummary({ ...base, status: "active" })).toBe("Active · 0 files");
    expect(linkSummary({ ...base, status: "active", upload_count: 1 })).toBe("Active · 1 file");
    expect(linkSummary({ ...base, status: "revoked", upload_count: 3 })).toBe("Turned off · 3 files");
    expect(linkSummary({ ...base, status: "active", expires_at: "2026-10-14T16:00:00Z" })).toMatch(/^Active · closes Oct 14, \d\d:00 · 0 files$/);
  });
});

describe("form helpers", () => {
  it("turns blank inputs into null", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-10-14T17:00")).toBe(new Date("2026-10-14T17:00").toISOString());
    expect(megabytesToBytes("")).toBeNull();
    expect(megabytesToBytes("0")).toBeNull();
    expect(megabytesToBytes("1.5")).toBe(Math.round(1.5 * MB));
  });
});

describe("uploadError", () => {
  it("prefers the server's own words, then a plain sentence", () => {
    expect(uploadError(410, { detail: "This upload link has expired." })).toBe("This upload link has expired.");
    expect(uploadError(429, { detail: "Request was throttled. Expected available in 120 seconds." })).toBe("Too many uploads in a short time. Wait a few minutes and try again.");
    expect(uploadError(429, { detail: "This link has received its daily limit of files." })).toBe("This link has received its daily limit of files.");
    expect(uploadError(400, { email: ["Enter a valid email address."] })).toBe("Email: Enter a valid email address.");
    expect(uploadError(413, null)).toBe("This file is larger than the server accepts.");
    expect(uploadError(0, null)).toBe("The upload failed (network error).");
  });
});
