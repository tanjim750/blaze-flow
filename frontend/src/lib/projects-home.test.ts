import { describe, expect, it } from "vitest";
import { legacyFilesHref } from "./projects-home";

describe("Projects home compatibility", () => {
  it("keeps legacy searches, folder links, filters and action params", () => {
    const url = new URL(legacyFilesHref({ folder: "folder-1", q: "summer cut", client: "client-1", project: "project-1", kind: "video", do: "upload", view: "old" }), "http://localhost");
    expect(url.pathname).toBe("/projects");
    expect(Object.fromEntries(url.searchParams)).toEqual({ folder: "folder-1", q: "summer cut", client: "client-1", project: "project-1", kind: "video", do: "upload", view: "files" });
  });
  it("keeps repeated params and handles a bare bookmark", () => {
    expect(legacyFilesHref({})).toBe("/projects?view=files");
    expect(legacyFilesHref({ tag: ["one", "two"] })).toContain("tag=one&tag=two");
  });

});
