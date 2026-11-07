import type { FilesView } from "./files-view";

/** Keep bookmarks (including search, folder and filters) without making a second home. */
export function legacyFilesHref(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
  }
  query.set("view", "files");
  return `/projects?${query}`;
}

/** A reversible bucket, not a data move. No IDs, links or permissions change. */
export function unsortedFiles(view: FilesView): FilesView {
  return { ...view, files: view.files.filter((file) => !file.project_id), folders: view.folders.filter((folder) => !folder.project_id) };
}
