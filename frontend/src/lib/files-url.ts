/**
 * The Files view in the URL: `/files?folder=…&q=…&all=1&client=…&project=…&kind=…&stage=…&sort=…`.
 *
 * Opening a file is a real navigation to review now, so the Files view has to survive the
 * round trip: Back (or the review's own Back button) restores the folder, search, filters
 * and sort, and a refresh keeps them too.
 */
export type FilesQuery = { folder: string | null; q: string; all: boolean; client: string; project: string; kind: string; stage: string; sort: string };

const KINDS = new Set(["video", "audio", "image", "document", "source", "other"]);
const SORTS = new Set(["newest", "name", "size"]);
const ID = /^[A-Za-z0-9-]{1,64}$/;
const id = (value: string | null) => (value && ID.test(value) ? value : "");

export function parseFilesQuery(params: URLSearchParams): FilesQuery {
  const kind = params.get("kind") ?? "";
  const sort = params.get("sort") ?? "";
  return {
    folder: id(params.get("folder")) || null,
    q: (params.get("q") ?? "").slice(0, 200),
    all: params.get("all") === "1",
    client: id(params.get("client")),
    project: id(params.get("project")),
    kind: KINDS.has(kind) ? kind : "",
    stage: id(params.get("stage")),
    sort: SORTS.has(sort) && sort !== "newest" ? sort : "",
  };
}

/** Writes the view onto `base`, removing empty values and leaving unrelated params alone. */
export function writeFilesQuery(query: FilesQuery, base = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base);
  const set = (key: string, value: string | null | undefined) => { if (value) params.set(key, value); else params.delete(key); };
  set("folder", query.folder);
  set("q", query.q.trim() ? query.q : "");
  set("all", query.all ? "1" : "");
  set("client", query.client);
  set("project", query.project);
  set("kind", query.kind);
  set("stage", query.stage);
  set("sort", query.sort && query.sort !== "newest" ? query.sort : "");
  return params;
}
