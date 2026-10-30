import { describe, expect, it } from "vitest";
import { parseFilesQuery, writeFilesQuery } from "./files-url";

describe("files URL state", () => {
  it("round-trips folder, search, filters and sort", () => {
    const query = parseFilesQuery(new URLSearchParams("folder=f-1&q=hero cut&all=1&client=c1&project=p1&kind=video&stage=s1&sort=name"));
    expect(query).toEqual({ folder: "f-1", q: "hero cut", all: true, client: "c1", project: "p1", kind: "video", stage: "s1", sort: "name" });
    expect(writeFilesQuery(query).toString()).toBe("folder=f-1&q=hero+cut&all=1&client=c1&project=p1&kind=video&stage=s1&sort=name");
  });
  it("drops defaults and empty values, and keeps unrelated params", () => {
    const empty = parseFilesQuery(new URLSearchParams(""));
    expect(writeFilesQuery(empty, new URLSearchParams("upload=1&q=old")).toString()).toBe("upload=1");
    expect(writeFilesQuery({ ...empty, sort: "newest" }).toString()).toBe("");
  });
  it("ignores values that are not ids or known options", () => {
    expect(parseFilesQuery(new URLSearchParams("folder=../../x&kind=exe&sort=evil&client=<script>"))).toMatchObject({ folder: null, kind: "", sort: "", client: "" });
  });
});
