import { describe, expect, it } from "vitest";
import { primaryLinkedFile, returnLabel, reviewHref, reviewSurface, safeReturnPath, taskOpenTarget, withReturnPath } from "./open-in-review";

describe("reviewHref", () => {
  it("builds one canonical address per cut", () => {
    expect(reviewHref({ mediaId: "f1" })).toBe("/review?media=f1");
    expect(reviewHref({ mediaId: "f1", taskId: "t1", from: "/tasks?q=hero" })).toBe("/review?media=f1&task=t1&from=%2Ftasks%3Fq%3Dhero");
    expect(reviewHref({ mediaId: "f1", commentId: "c1", timeMs: 5200.4 })).toBe("/review?media=f1&comment=c1&t=5200");
  });
  it("drops an unsafe way back and a bad timecode", () => {
    expect(reviewHref({ mediaId: "f1", from: "https://evil.example", timeMs: -1 })).toBe("/review?media=f1");
  });
});

describe("safeReturnPath", () => {
  it("accepts in-app paths with their query", () => {
    expect(safeReturnPath("/files?folder=a&q=b")).toBe("/files?folder=a&q=b");
    expect(safeReturnPath("/")).toBe("/");
  });
  it.each([null, undefined, "", "files", "//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/review?media=x", "/review-embed?media=x", "/a\nb"])("rejects %s", (value) => {
    expect(safeReturnPath(value as string | null)).toBeNull();
  });
});

describe("returnLabel", () => {
  it("names where Back goes", () => {
    expect(returnLabel("/files?q=x")).toBe("Files");
    expect(returnLabel("/tasks?task=1")).toBe("Tasks");
    expect(returnLabel("/projects?campaign=p")).toBe("Project");
    expect(returnLabel("/?view=editor")).toBe("Home");
    expect(returnLabel("/settings")).toBe("Back");
    expect(returnLabel(null)).toBe("Back");
  });
});

describe("withReturnPath", () => {
  it("adds the way back to a review link and keeps the rest", () => {
    expect(withReturnPath("/review?media=f&comment=c", "/?view=editor")).toBe("/review?media=f&comment=c&from=%2F%3Fview%3Deditor");
  });
  it("leaves a link that already has one, or is not a review link, alone", () => {
    expect(withReturnPath("/review?media=f&from=%2Ftasks", "/files")).toBe("/review?media=f&from=%2Ftasks");
    expect(withReturnPath("/files", "/tasks")).toBe("/files");
    expect(withReturnPath("/review?media=f", "//evil")).toBe("/review?media=f");
  });
});

describe("primaryLinkedFile", () => {
  const known = (map: Record<string, { mimeType: string; versionNumber?: number }>) => (id: string) => map[id] ? { fileId: id, ...map[id] } : null;
  it("prefers a cut over a still over a brief", () => {
    expect(primaryLinkedFile(["pdf", "img", "vid"], known({ pdf: { mimeType: "application/pdf" }, img: { mimeType: "image/png" }, vid: { mimeType: "video/mp4" } }))).toBe("vid");
    expect(primaryLinkedFile(["pdf", "img"], known({ pdf: { mimeType: "application/pdf" }, img: { mimeType: "image/png" } }))).toBe("img");
  });
  it("takes the newest version of a kind, then attach order", () => {
    expect(primaryLinkedFile(["v1", "v3"], known({ v1: { mimeType: "video/mp4", versionNumber: 1 }, v3: { mimeType: "video/mp4", versionNumber: 3 } }))).toBe("v3");
    expect(primaryLinkedFile(["a", "b"], known({ a: { mimeType: "video/mp4" }, b: { mimeType: "video/mp4" } }))).toBe("a");
  });
  it("treats a file outside the library as a cut, and nothing as nothing", () => {
    expect(primaryLinkedFile(["img", "project-cut"], known({ img: { mimeType: "image/png" } }))).toBe("project-cut");
    expect(primaryLinkedFile([], known({}))).toBeNull();
    expect(primaryLinkedFile(undefined, known({}))).toBeNull();
  });
});

describe("taskOpenTarget", () => {
  it("opens review with the task for a task with a linked file", () => {
    expect(taskOpenTarget({ id: "t", attachment_file_ids: ["f"] }, () => null, "/tasks?assignee=m")).toEqual({ kind: "review", href: "/review?media=f&task=t&from=%2Ftasks%3Fassignee%3Dm" });
  });
  it("opens the detail sheet for a task with nothing linked", () => {
    expect(taskOpenTarget({ id: "t", attachment_file_ids: [] }, () => null, null)).toEqual({ kind: "sheet" });
    expect(taskOpenTarget({ id: "t" }, () => null, null)).toEqual({ kind: "sheet" });
  });
});

describe("reviewSurface", () => {
  it("picks the player for media and a viewer for the rest", () => {
    expect(reviewSurface("video/mp4", "a.mp4")).toBe("video");
    expect(reviewSurface("audio/mpeg", "a.mp3")).toBe("audio");
    expect(reviewSurface("image/jpeg", "a.jpg")).toBe("image");
    expect(reviewSurface("application/pdf", "a.pdf")).toBe("pdf");
    expect(reviewSurface("application/octet-stream", "a.mov")).toBe("video");
    expect(reviewSurface("application/zip", "a.zip")).toBe("download");
  });
});
