/**
 * Pure logic behind the Files panel (the Figma-assets-panel redesign): scoping and filtering,
 * grouping into collapsible sections, selection, keyboard movement through a sectioned grid,
 * the folder tree, and the small formatters the tiles and the inspector share.
 *
 * Nothing here touches React or the DOM, so every rule is unit-tested in
 * `files-panel.test.ts` rather than through a rendered component.
 */
import type { TaskStageKind } from "./api";
import type { LibraryFile, LibraryFolder, LibraryKind } from "./asset-library";

export type SortKey = "newest" | "name" | "size";
export type GroupBy = "project" | "type" | "none";
export type ViewMode = "grid" | "list";
export type Density = "comfortable" | "compact";

/* ------------------------------------------------------------------ scope + filter */

export type ScopeInput = {
  folders: LibraryFolder[];
  files: LibraryFile[];
  folderId: string | null;
  query: string;
  /** Search every folder, not only the one being viewed. Only applies while there is a query. */
  everywhere: boolean;
  client: string;
  project: string;
  kind: LibraryKind | "";
  stage: string;
  sort: SortKey;
};

export const matchesQuery = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());
const matchesRelation = (entity: { clientId: string | null; projectId: string | null }, client: string, project: string) =>
  (!client || entity.clientId === client) && (!project || entity.projectId === project);

/**
 * What the current location shows. Folders are hidden by a type or stage filter, since
 * neither describes a folder, and only the latest cut of each asset is listed.
 */
export function scopeItems(input: ScopeInput): { folders: LibraryFolder[]; files: LibraryFile[]; recursive: boolean } {
  const recursive = input.everywhere && Boolean(input.query.trim());
  const inScope = (parent: string | null) => recursive || parent === input.folderId;
  const folders = input.kind || input.stage ? [] : input.folders.filter((item) =>
    inScope(item.parentFolderId) && matchesQuery(item.name, input.query) && matchesRelation(item, input.client, input.project));
  const files = input.files.filter((item) =>
    inScope(item.folderId) && matchesQuery(item.name, input.query) && matchesRelation(item, input.client, input.project)
    && (!input.kind || item.kind === input.kind) && (!input.stage || item.stageId === input.stage) && item.versioning.isLatest);
  return { folders: sortFolders(folders, input.sort), files: sortFiles(files, input.sort), recursive };
}

export function sortFolders(items: LibraryFolder[], sort: SortKey) {
  return [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt));
}
export function sortFiles(items: LibraryFile[], sort: SortKey) {
  return [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : b.uploadedAt.localeCompare(a.uploadedAt));
}

/* ------------------------------------------------------------------ sections */

export type Section = { id: string; title: string; folders: LibraryFolder[]; files: LibraryFile[] };

export const KIND_ORDER: LibraryKind[] = ["video", "image", "audio", "document", "source", "other"];
export const KIND_LABEL: Record<LibraryKind, string> = { video: "Video", image: "Images", audio: "Audio", document: "Documents", source: "Source files", other: "Other" };
/** Singular, for a type badge or the inspector's Type row. */
export const KIND_NAME: Record<LibraryKind, string> = { video: "Video", image: "Image", audio: "Audio", document: "Document", source: "Source file", other: "File" };

/**
 * Splits the visible items into the collapsible sections the panel renders, the way
 * Figma's assets panel groups components under their library and page.
 *
 * Folders always come first, in their own section, because they are how you move around.
 * Files follow, grouped by campaign (project) or by type. Campaigns are listed A–Z with
 * "Unassigned" last. Empty sections are never returned, so a heading always has something under it.
 */
export function groupSections(folders: LibraryFolder[], files: LibraryFile[], groupBy: GroupBy, projectName: (id: string) => string | undefined): Section[] {
  if (groupBy === "none") return folders.length || files.length ? [{ id: "all", title: "All items", folders, files }] : [];
  const sections: Section[] = [];
  if (folders.length) sections.push({ id: "folders", title: "Folders", folders, files: [] });
  if (groupBy === "type") {
    KIND_ORDER.forEach((kind) => {
      const matching = files.filter((file) => file.kind === kind);
      if (matching.length) sections.push({ id: `type:${kind}`, title: KIND_LABEL[kind], folders: [], files: matching });
    });
    return sections;
  }
  const byProject = new Map<string, LibraryFile[]>();
  files.forEach((file) => {
    const known = file.projectId && projectName(file.projectId) ? file.projectId : "";
    byProject.set(known, [...(byProject.get(known) ?? []), file]);
  });
  [...byProject.keys()].filter(Boolean)
    .sort((a, b) => projectName(a)!.localeCompare(projectName(b)!))
    .forEach((id) => sections.push({ id: `project:${id}`, title: projectName(id)!, folders: [], files: byProject.get(id)! }));
  if (byProject.has("")) sections.push({ id: "project:none", title: "Unassigned", folders: [], files: byProject.get("")! });
  return sections;
}

/** Item ids in on-screen order, skipping collapsed sections: the order range selection and arrow keys walk. */
export function visibleOrder(sections: Section[], collapsed: ReadonlySet<string>): string[] {
  return sections.flatMap((section) => collapsed.has(section.id) ? [] : [...section.folders, ...section.files].map((item) => item.id));
}

/* ------------------------------------------------------------------ selection */

export type SelectionState = { selected: ReadonlySet<string>; anchor: string | null };
export type SelectMode = "replace" | "toggle" | "range";

/**
 * Figma's layer-panel rules. A plain click replaces the selection. ⌘/Ctrl toggles one
 * item and moves the anchor. Shift selects from the anchor to the clicked item in
 * on-screen order, replacing the previous range but keeping the anchor where it was.
 */
export function nextSelection(state: SelectionState, id: string, mode: SelectMode, order: string[]): SelectionState {
  if (mode === "toggle") {
    const selected = new Set(state.selected);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    return { selected, anchor: id };
  }
  if (mode === "range" && state.anchor && order.includes(state.anchor) && order.includes(id)) {
    const [from, to] = [order.indexOf(state.anchor), order.indexOf(id)].sort((a, b) => a - b);
    return { selected: new Set(order.slice(from, to + 1)), anchor: state.anchor };
  }
  return { selected: new Set([id]), anchor: id };
}

/** Drops ids that are no longer on screen (after a delete, a move or a new filter). */
export function pruneSelection(state: SelectionState, present: ReadonlySet<string>): SelectionState {
  const kept = [...state.selected].filter((id) => present.has(id));
  if (kept.length === state.selected.size && (!state.anchor || present.has(state.anchor))) return state;
  return { selected: new Set(kept), anchor: state.anchor && present.has(state.anchor) ? state.anchor : null };
}

/* ------------------------------------------------------------------ keyboard movement */

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";
export const isMoveKey = (key: string): key is MoveKey => ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key);

/**
 * Where an arrow key goes in a grid split into sections. `sizes` is the item count of each
 * visible section (0 for collapsed/empty ones), `index` is the flat position, and
 * `columns` is how many tiles fit a row (1 in list view).
 *
 * Left/right walk the flat order. Up/down keep the column, and from the last row of a
 * section they drop into the first row of the next (the column is clamped to what that row
 * has), the way a user reads the page. Home/End go to the first and last item. The result
 * is clamped, so pressing past an edge stays put.
 */
export function moveIndex(sizes: number[], index: number, key: MoveKey, columns: number): number {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!total) return -1;
  const cols = Math.max(1, columns);
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(total - 1, index + 1);
  // Locate the section and the position inside it.
  let section = 0, start = 0;
  while (section < sizes.length && index >= start + sizes[section]) { start += sizes[section]; section += 1; }
  const local = index - start, size = sizes[section], column = local % cols;
  const startOf = (target: number) => sizes.slice(0, target).reduce((sum, value) => sum + value, 0);
  if (key === "ArrowDown") {
    if (local + cols < size) return index + cols;
    const lastRow = Math.floor((size - 1) / cols);
    if (Math.floor(local / cols) < lastRow) return start + size - 1; // partial last row below
    let next = section + 1;
    while (next < sizes.length && !sizes[next]) next += 1;
    if (next >= sizes.length) return index;
    return startOf(next) + Math.min(column, sizes[next] - 1);
  }
  // ArrowUp
  if (local - cols >= 0) return index - cols;
  let previous = section - 1;
  while (previous >= 0 && !sizes[previous]) previous -= 1;
  if (previous < 0) return index;
  const previousSize = sizes[previous], lastRowStart = Math.floor((previousSize - 1) / cols) * cols;
  return startOf(previous) + Math.min(lastRowStart + column, previousSize - 1);
}

/* ------------------------------------------------------------------ folder tree */

export type TreeRow = { folder: LibraryFolder; depth: number; count: number; hasChildren: boolean; expanded: boolean };

/**
 * The folder tree flattened to the rows currently visible, depth-first and A–Z, with each
 * folder's direct item count (files plus subfolders, the same number a folder tile shows).
 * A folder is only walked into when it is expanded. `expanded` also opens every ancestor of
 * `reveal`, so the folder being viewed is always visible in the tree.
 */
export function folderTreeRows(folders: LibraryFolder[], files: LibraryFile[], expanded: ReadonlySet<string>, reveal: string | null = null): TreeRow[] {
  const known = new Set(folders.map((folder) => folder.id));
  const children = new Map<string | null, LibraryFolder[]>();
  folders.forEach((folder) => {
    const parent = folder.parentFolderId && known.has(folder.parentFolderId) ? folder.parentFolderId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  });
  const open = new Set(expanded);
  let cursor = reveal ? folders.find((folder) => folder.id === reveal) ?? null : null;
  while (cursor?.parentFolderId) { open.add(cursor.parentFolderId); cursor = folders.find((folder) => folder.id === cursor!.parentFolderId) ?? null; }
  const fileCount = new Map<string, number>();
  files.forEach((file) => { if (file.folderId && file.versioning.isLatest) fileCount.set(file.folderId, (fileCount.get(file.folderId) ?? 0) + 1); });
  const rows: TreeRow[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name)).forEach((folder) => {
      if (seen.has(folder.id)) return; // a cycle in bad data must not hang the page
      const kids = children.get(folder.id) ?? [];
      const isOpen = open.has(folder.id) && kids.length > 0;
      rows.push({ folder, depth, count: (fileCount.get(folder.id) ?? 0) + kids.length, hasChildren: kids.length > 0, expanded: isOpen });
      if (isOpen) walk(folder.id, depth + 1, new Set([...seen, folder.id]));
    });
  };
  walk(null, 0, new Set());
  return rows;
}

/* ------------------------------------------------------------------ stage tones */

export type StageTone = "neutral" | "brand" | "teal" | "info" | "destructive" | "success";

/** Built-in stage kinds (backend `TaskStage.kind`, migration 0030) → DS tone, same table the Tasks board uses. */
const KIND_TONE: Record<Exclude<TaskStageKind, "custom">, StageTone> = {
  todo: "neutral", in_progress: "brand", review: "teal", client_review: "info", revisions: "destructive", approved: "success",
};

/**
 * The DS tone for a workspace stage (spec §13), kept in step with the Tasks board's
 * `StagePill`: when the stage payload carries a `kind`, the kind decides (so a renamed
 * built-in stage keeps its colour and a `custom` stage is always neutral, exactly as on the
 * board). Older payloads without `kind` fall back to the name: To Do neutral, In Progress
 * violet, Review/QA teal, Client info, Revisions destructive, Approved success. A name the
 * table does not know returns null, so the caller falls back to the neutral (`is-custom`) stage pill
 * with the stage's own colour as a dot only, because a user's hex cannot be relied on to
 * reach 4.5:1.
 */
export function stageTone(name: string, kind?: TaskStageKind | null): StageTone | null {
  if (kind) return kind === "custom" ? null : KIND_TONE[kind];
  const value = name.toLowerCase();
  if (/approv|done|deliver|final/.test(value)) return "success";
  if (/revision|changes|reject/.test(value)) return "destructive";
  if (/client/.test(value)) return "info";
  if (/review|qa|check/.test(value)) return "teal";
  if (/progress|doing|edit|working/.test(value)) return "brand";
  if (/to ?do|backlog|todo|new|queue/.test(value)) return "neutral";
  return null;
}

/* ------------------------------------------------------------------ formatters */

/**
 * Shortens a filename in the middle so its start and extension both survive
 * (`spring_launch…_v3_9x16.mp4`). End-truncation hides exactly the part that tells takes apart.
 */
export function middleTruncate(name: string, max = 32): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const stem = extension ? name.slice(0, dot) : name;
  const keep = Math.max(2, max - extension.length - 1);
  const head = Math.ceil(keep * 0.6), tail = keep - head;
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(-tail) : ""}${extension}`;
}

export const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;

/** `m:ss`, or `h:mm:ss` past an hour, matching the badge on the task board. */
export function runtime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60), seconds = String(total % 60).padStart(2, "0"), hours = Math.floor(minutes / 60);
  return hours ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** A readable aspect for common frames (`16:9`, `9:16`, `1:1`, `4:5`), else the ratio to two places. */
export function aspectLabel(width: number, height: number): string {
  if (!width || !height) return "";
  const ratio = width / height;
  const known: [string, number][] = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5], ["5:4", 5 / 4], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9], ["2:3", 2 / 3], ["3:2", 3 / 2]];
  const match = known.find(([, value]) => Math.abs(value - ratio) / value < 0.02);
  return match ? match[0] : `${ratio.toFixed(2)}:1`;
}

/** Totals for the inspector's folder summary and multi-select view. */
export function summarize(files: LibraryFile[], folders: LibraryFolder[]) {
  const stages = new Map<string | null, number>();
  files.forEach((file) => stages.set(file.stageId, (stages.get(file.stageId) ?? 0) + 1));
  return { files: files.length, folders: folders.length, bytes: files.reduce((sum, file) => sum + file.size, 0), stages };
}
