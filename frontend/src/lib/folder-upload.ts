/**
 * Folder upload helpers: turn a dropped or picked folder into `{ file, dir }` pairs, where
 * `dir` is the file's folder path relative to the upload target ("" = the target itself,
 * "Shoot/Day 1" = two levels down), and plan which folders need creating.
 *
 * Drops use `DataTransferItem.webkitGetAsEntry()` (Chrome, Safari, Firefox) and walk
 * directories recursively. `readEntries` returns entries in batches (Chrome: 100 at a time),
 * so it is called until it returns an empty batch. Picks use `<input webkitdirectory>`,
 * whose files carry `webkitRelativePath` ("Shoot/Day 1/a.mov").
 *
 * Hidden files and folders (".DS_Store", ".git", "._x" AppleDouble files) are skipped, as
 * are Windows "Thumbs.db"/"desktop.ini" junk files.
 */

export type StagedFile = { file: File; dir: string };

const JUNK = new Set(["thumbs.db", "desktop.ini"]);
export const isHiddenName = (name: string) => name.startsWith(".") || JUNK.has(name.toLowerCase());

/** Minimal shapes of the FileSystem entry API, so tests can fake it. */
export type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (file: File) => void, fail?: (error: unknown) => void) => void; createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail?: (error: unknown) => void) => void } };

const readAll = async (entry: FsEntry): Promise<FsEntry[]> => {
  const reader = entry.createReader!(); const all: FsEntry[] = [];
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
};
const entryFile = (entry: FsEntry) => new Promise<File>((ok, fail) => entry.file!(ok, fail));

/** Walks one entry. `dir` is the path of the folder that holds it. */
export async function walkEntry(entry: FsEntry, dir = ""): Promise<StagedFile[]> {
  if (isHiddenName(entry.name)) return [];
  if (entry.isFile) {
    try { return [{ file: await entryFile(entry), dir }]; } catch { return []; }
  }
  if (!entry.isDirectory) return [];
  const path = dir ? `${dir}/${entry.name}` : entry.name;
  const children = await readAll(entry).catch(() => [] as FsEntry[]);
  const nested = await Promise.all(children.map((child) => walkEntry(child, path)));
  return nested.flat();
}

/**
 * Must be called synchronously inside the `drop` handler: items and their entries are only
 * readable during the event. Returns a promise for every file, folders expanded.
 */
export function stagedFromDrop(data: DataTransfer): Promise<StagedFile[]> {
  const items = Array.from(data.items ?? []).filter((item) => item.kind === "file");
  const entries = items.map((item) => (typeof item.webkitGetAsEntry === "function" ? (item.webkitGetAsEntry() as FsEntry | null) : null));
  if (!entries.length || entries.some((entry) => !entry)) {
    // No entry API: plain files only.
    return Promise.resolve(Array.from(data.files ?? []).filter((file) => !isHiddenName(file.name)).map((file) => ({ file, dir: "" })));
  }
  return Promise.all(entries.map((entry) => walkEntry(entry!))).then((lists) => lists.flat());
}

/** Files from `<input type=file webkitdirectory>` (or a plain multi-file input). */
export function stagedFromInput(list: FileList | File[] | null): StagedFile[] {
  return Array.from(list ?? []).flatMap((file) => {
    const parts = (file.webkitRelativePath || "").split("/").filter(Boolean);
    if (parts.length <= 1) return isHiddenName(file.name) ? [] : [{ file, dir: "" }];
    if (parts.some(isHiddenName)) return [];
    return [{ file, dir: parts.slice(0, -1).join("/") }];
  });
}

/** Every folder path that has to exist, parents before children: "A", "A/B", "A/B/C". */
export function folderPaths(staged: StagedFile[]): string[] {
  const paths = new Set<string>();
  staged.forEach(({ dir }) => { const parts = dir.split("/").filter(Boolean); parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join("/"))); });
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

type FolderLike = { id: string; name: string; parentFolderId: string | null; projectId?: string | null };

/**
 * Creates (or reuses) every folder under `rootId`, parents first, and returns path → id.
 * A folder with the same name already at that level (and in the same project) is reused,
 * so uploading "Shoot" twice merges into the existing "Shoot" instead of making a second one.
 * If the server still says the name is taken (a folder this page has not loaded), the
 * upload falls back to "Shoot (2)", "Shoot (3)"… rather than failing.
 */
export async function ensureFolders(staged: StagedFile[], rootId: string | null, existing: FolderLike[], create: (name: string, parentId: string | null) => Promise<{ id: string }>, projectId?: string | null): Promise<Map<string, string | null>> {
  const ids = new Map<string, string | null>([["", rootId]]);
  const known = [...existing].filter((folder) => projectId === undefined || !projectId || folder.projectId === projectId);
  for (const path of folderPaths(staged)) {
    const cut = path.lastIndexOf("/"); const parentPath = cut < 0 ? "" : path.slice(0, cut); const name = path.slice(cut + 1);
    const parentId = ids.get(parentPath) ?? null;
    const reuse = known.find((folder) => folder.parentFolderId === parentId && folder.name === name);
    if (reuse) { ids.set(path, reuse.id); continue; }
    const made = await createUnique(create, name, parentId);
    known.push({ id: made.id, name, parentFolderId: parentId, projectId });
    ids.set(path, made.id);
  }
  return ids;
}

const TAKEN = /already exists/i;
async function createUnique(create: (name: string, parentId: string | null) => Promise<{ id: string }>, name: string, parentId: string | null) {
  for (let n = 1; ; n++) {
    try { return await create(n === 1 ? name : `${name} (${n})`, parentId); }
    catch (error) { if (n >= 20 || !(error instanceof Error && TAKEN.test(error.message))) throw error; }
  }
}
