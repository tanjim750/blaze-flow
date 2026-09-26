"use client";

/**
 * The Files panel: the asset library redesigned after Figma's assets panel.
 *
 * Three regions: a resizable Library tree (folders + campaigns) on the left, the main area
 * (breadcrumb toolbar, search, collapsible grouped sections in a grid or list) and a
 * resizable inspector for the selection on the right. Below the widths that fit, the tree
 * becomes a drawer and the inspector a sheet (a bottom sheet on phones). In project mode
 * (`compact`, the project page's Files tab) the tree is left out, since the project page has
 * its own.
 *
 * Every write still goes through `useAssetWrite` (optimistic, rolled back and reported on
 * failure). The pure rules (filtering, grouping, selection, keyboard movement) live in
 * `lib/files-panel.ts` and the presentational pieces in `components/files/`.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { Archive, ChevronRight, Clapperboard, Copy, Download, Ellipsis, Eye, FolderOpen, FolderPlus, Info, LayoutGrid, List, ListFilter, Move, PanelLeft, PanelRight, Pencil, RefreshCw, RotateCcw, Search, SearchX, Tag, Trash2, TriangleAlert, Upload, X, ArrowDown, ArrowUp } from "lucide-react";
import type { FilesView } from "@/lib/files-view";
import { applyLibraryStage, demoLibrary, isProcessing, markPending, replaceLibrary, snapshotLibrary, assignFolderTree, assignLibraryEntities, deleteLibraryEntities, descendantFolderIds, kindFor, newId, stageFileIds, updateLibrary, useAssetLibrary, type LibraryFile, type LibraryFolder, type LibraryKind, type LibraryState } from "@/lib/asset-library";
import { addAssetFileVersion, createAssetFolder, deleteAssetFile, deleteAssetFolder, duplicateAssetFile, updateAssetFile, updateAssetFolder, uploadAssetFile } from "@/lib/asset-api-client";
import { folderTreeRows, formatSize, groupSections, isMoveKey, moveIndex, nextSelection, pruneSelection, scopeItems, visibleOrder, type Density, type GroupBy, type SelectionState, type SortKey, type ViewMode } from "@/lib/files-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { openUniversalReview } from "@/components/universal-review";
import { FileItem, FolderItem, type ItemCommon } from "@/components/files/asset-item";
import { AssetInspector, type InspectorActions } from "@/components/files/asset-inspector";
import { LibraryTree } from "@/components/files/library-tree";
import { PanelResizer, useStoredNumber } from "@/components/files/panel-resizer";
import { KindIcon, Thumb } from "@/components/files/files-ui";
import "@/components/files/files.css";

const RefreshContext = createContext<() => void>(() => {});
const useServerRefresh = () => useContext(RefreshContext);
const ReportContext = createContext<(message: string) => void>(() => {});

/**
 * The single path for a write that touches the server.
 *
 * Applies the change optimistically, marks the rows in flight so they keep winning over
 * server data until the API answers, then either re-fetches the server views or rolls the
 * whole library back and says what failed. Writes used to be fire-and-forget through
 * `updateNoWait`, which swallowed every rejection.
 */
function useAssetWrite(ownRefresh?: () => void, ownReport?: (message: string) => void) {
  const contextRefresh = useServerRefresh();
  const contextReport = useContext(ReportContext);
  const refresh = ownRefresh ?? contextRefresh;
  const report = ownReport ?? contextReport;
  /** Resolves to null when the write landed, or to the message explaining why it did not. */
  return function write<T>({ ids, optimistic, rollback, send, onSaved, describe }: {
    ids: string[];
    optimistic?: (state: LibraryState) => LibraryState;
    /**
     * Undoes just this write. Prefer it over the whole-store snapshot whenever writes can
     * be in flight together: restoring a snapshot taken before a *sibling* write also
     * discards that sibling's work.
     */
    rollback?: (state: LibraryState) => LibraryState;
    send: () => Promise<T>;
    onSaved?: (saved: T) => void;
    describe: string;
  }): Promise<string | null> {
    const before = snapshotLibrary();
    if (optimistic) updateLibrary(optimistic);
    markPending(ids, true);
    return send().then(
      (saved) => { onSaved?.(saved); markPending(ids, false); refresh(); return null; },
      (error: unknown) => {
        if (rollback) updateLibrary(rollback);
        else replaceLibrary(before);
        markPending(ids, false);
        const message = `${describe} failed. ${error instanceof Error ? error.message : "The server rejected the change."}`;
        report(message);
        return message;
      },
    );
  };
}

/**
 * Video and audio open in the review workspace rather than a preview modal. `fileId` is
 * the `File` the review is addressed by, so the link is identical to the one a project or
 * a task would produce for the same media — see `lib/review-media.ts`.
 */
const reviewHref = (file: LibraryFile) =>
  (file.kind === "video" || file.kind === "audio") && file.fileId ? `/review?media=${file.fileId}` : null;

type Props = { view?: FilesView; projectId?: string | null; projectName?: string; clientId?: string | null; compact?: boolean };

/** A choice remembered in localStorage. Read after mount, so server and client render the same first frame. */
function useStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    // Stored preferences load after mount so server and client render the same first frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const stored = window.localStorage.getItem(key) as T | null; if (stored && allowed.includes(stored)) setValue(stored); } catch { /* storage blocked */ }
    // `allowed` is a literal per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, (next: T) => { setValue(next); try { window.localStorage.setItem(key, next); } catch { /* storage blocked */ } }];
}
function useStoredSet(key: string): [ReadonlySet<string>, (update: (current: Set<string>) => Set<string>) => void] {
  const [value, setValue] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads after mount, as above
    try { const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]"); if (Array.isArray(stored)) setValue(new Set(stored.filter((item) => typeof item === "string"))); } catch { /* storage blocked or bad JSON */ }
  }, [key]);
  const update = (change: (current: Set<string>) => Set<string>) => setValue((current) => {
    const next = change(new Set(current));
    try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* storage blocked */ }
    return next;
  });
  return [value, update];
}
/** The panel's own width, which decides what docks. Assumes a desktop width until measured (and under jsdom). */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => { const next = node.getBoundingClientRect().width; if (next > 0) setWidth(next); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const MIN_MAIN = 480;
const VIEW_MODES = ["grid", "list"] as const;
const DENSITIES = ["comfortable", "compact"] as const;
const GROUPINGS = ["project", "type", "none"] as const;

export function AssetLibrary({ view, projectId = null, projectName, clientId = null, compact = false }: Props) {
  const router = useRouter();
  const [writeError, setWriteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const write = useAssetWrite(() => router.refresh(), setWriteError);
  const stored = useAssetLibrary();
  const [folderId, setFolderIdRaw] = useState<string | null>(null); const [query, setQuery] = useState(""); const [searchEverywhere, setSearchEverywhere] = useState(false);
  const [dialog, setDialog] = useState<"folder" | "upload" | null>(null); const [dropped, setDropped] = useState<File[]>([]);
  const [preview, setPreview] = useState<LibraryFile | null>(null);
  const [clientFilter, setClientFilter] = useState(""); const [projectFilter, setProjectFilter] = useState(""); const [kindFilter, setKindFilter] = useState<LibraryKind | "">(""); const [stageFilter, setStageFilter] = useState(""); const [sort, setSort] = useState<SortKey>("newest");
  const [mode, setMode] = useStoredChoice<ViewMode>("bf.files.view", "grid", VIEW_MODES);
  const [density, setDensity] = useStoredChoice<Density>("bf.files.density", "comfortable", DENSITIES);
  const [groupBy, setGroupBy] = useStoredChoice<GroupBy>(compact ? "bf.files.group.project" : "bf.files.group", compact ? "type" : "project", GROUPINGS);
  const [collapsed, setCollapsed] = useStoredSet("bf.files.collapsed");
  const [expandedFolders, setExpandedFolders] = useStoredSet("bf.files.tree");
  const [inspectorPref, setInspectorPref] = useStoredChoice<"open" | "closed">("bf.files.inspector", "open", ["open", "closed"] as const);
  const [treeWidthPref, setTreeWidth] = useStoredNumber("bf.files.treeWidth");
  const [inspectorWidthPref, setInspectorWidth] = useStoredNumber("bf.files.inspectorWidth");
  const [sheetOpen, setSheetOpen] = useState(false); const [treeDrawer, setTreeDrawer] = useState(false);
  const [rawSelection, setSelection] = useState<SelectionState>({ selected: new Set(), anchor: null });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; where: "item" | "inspector" } | null>(null);
  const [moveIds, setMoveIds] = useState<Set<string> | null>(null);
  const [osDrag, setOsDrag] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const gridRefs = useRef(new Map<string, HTMLDivElement>());
  const width = useWidth(rootRef);

  const stages = view?.stages ?? [];
  const serverFolders: LibraryFolder[] = (view?.folders ?? []).map((folder) => ({ id: folder.id, name: folder.name, clientId: folder.client_team_id, projectId: folder.project_id, parentFolderId: folder.parent_folder_id, createdAt: folder.created_at, createdBy: "Workspace member" }));
  const serverFiles: LibraryFile[] = (view?.files ?? []).map((item) => ({ id: item.id, fileId: item.file.id, name: item.file.name, kind: mimeKind(item.file.mime_type, item.file.name), mimeType: item.file.mime_type, size: item.file.size_bytes, durationMs: item.file.duration_ms, status: item.file.status as LibraryFile["status"], versioning: {
    assetId: item.media_asset?.id ?? null,
    assetName: item.media_asset?.name ?? item.file.name,
    versionNumber: item.version_number,
    versionCount: item.media_asset?.version_count ?? 1,
    isLatest: item.media_asset?.is_latest ?? true,
  }, url: view?.workspaceId && item.file.status === "READY" ? `/api/workspaces/${view.workspaceId}/asset-files/${item.id}/download/` : null, preview: view?.workspaceId && item.poster ? `/api/workspaces/${view.workspaceId}/asset-files/${item.id}/poster/` : null, uploadedBy: item.added_by?.name || "Workspace member", uploadedAt: item.created_at, folderId: item.folder_id, clientId: item.client_team_id, projectId: item.project_id, stageId: item.task_stage_id, width: item.poster?.width ?? null, height: item.poster?.height ?? null, commentCount: item.comment_count ?? 0 }));
  // With no workspace there is no server to be authoritative, so the sample library stands
  // in and every local edit applies. Connected, a local row may only override a server row
  // while its write is still in flight; everything else defers to the server.
  const offline = !view?.workspaceId;
  const localWins = offline ? null : new Set(stored.pending ?? []);
  const folders = merge(offline ? demoLibrary.folders : serverFolders, stored.folders, localWins).filter((item) => !stored.deletedIds.includes(item.id) && (!projectId || item.projectId === projectId));
  const files = merge(offline ? demoLibrary.files : serverFiles, stored.files, localWins).filter((item) => !stored.deletedIds.includes(item.id) && (!projectId || item.projectId === projectId));
  const current = folders.find((item) => item.id === folderId) ?? null;
  const scope = scopeItems({ folders, files, folderId, query, everywhere: searchEverywhere, client: clientFilter, project: projectFilter, kind: kindFilter, stage: stageFilter, sort });
  const recursiveSearch = scope.recursive;
  const filteredProjects = (view?.groups ?? []).filter((group) => !clientFilter || group.clientId === clientFilter);
  const projectName_ = (id: string) => view?.groups.find((group) => group.projectId === id)?.projectName;
  const sections = groupSections(scope.folders, scope.files, groupBy, projectName_);
  const order = visibleOrder(sections, collapsed);
  const byId = new Map<string, LibraryFile | LibraryFolder>([...folders, ...files].map((item) => [item.id, item]));
  const crumbs = folderTrail(current, folders);
  const rootLabel = projectName || "All files";
  const setFolderId = (id: string | null) => { setFolderIdRaw(id); setSelection({ selected: new Set(), anchor: null }); setFocusedId(null); setTreeDrawer(false); };

  // Layout: what docks depends on the panel's own width (it is also used inside the project page).
  const phone = width < 768;
  const treeWidth = clamp(treeWidthPref ?? (width >= 1400 ? 240 : 224), 200, 360);
  const inspectorWidth = clamp(inspectorWidthPref ?? (width >= 1400 ? 320 : 280), 280, 400);
  const hasTree = !compact;
  const treeDocked = hasTree && width >= 1000;
  const inspectorDocked = !phone && width - (treeDocked ? treeWidth : 0) - inspectorWidth >= MIN_MAIN;
  const inspectorVisible = inspectorDocked ? inspectorPref === "open" : sheetOpen;
  const toggleInspector = () => { if (inspectorDocked) setInspectorPref(inspectorPref === "open" ? "closed" : "open"); else setSheetOpen(!sheetOpen); };

  // Selection only ever covers what is on screen: items that are deleted, moved or filtered away drop out.
  const present = new Set(order);
  const selection = pruneSelection(rawSelection, present);
  const selected = selection.selected;
  const selectedFiles = files.filter((item) => selected.has(item.id));
  const selectedFolders = folders.filter((item) => selected.has(item.id));

  /**
   * Dragging one file onto another makes it the next version of that asset.
   *
   * `dragging` is the row being carried and `versionTarget` the card under it, so a card
   * can say "Drop to create V3" before anything happens — the spec asks for a drop state
   * rather than a silent merge, and merging two assets is not something to do by accident.
   * Dragging onto a folder (tile, row or tree) moves the dragged items into it instead.
   */
  const [dragging, setDragging] = useState<{ ids: string[]; file: LibraryFile | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const draggedFile = dragging?.ids.length === 1 ? dragging.file : null;
  const canVersionOnto = (target: LibraryFile) =>
    Boolean(draggedFile) && draggedFile!.id !== target.id && draggedFile!.kind === target.kind
    && draggedFile!.versioning.versionCount === 1 && draggedFile!.versioning.assetId !== target.versioning.assetId;
  const canMoveInto = (targetId: string | null) => {
    if (!dragging) return false;
    const ids = dragging.ids;
    if (targetId && ids.includes(targetId)) return false;
    const blocked = new Set<string>();
    ids.forEach((id) => { if (folders.some((folder) => folder.id === id)) descendantFolderIds(folders, id).forEach((child) => blocked.add(child)); });
    if (targetId && blocked.has(targetId)) return false;
    // Nothing to do if every dragged item already lives there.
    return !ids.every((id) => { const item = byId.get(id); return item && ("kind" in item ? item.folderId : item.parentFolderId) === targetId; });
  };
  const createVersion = (target: LibraryFile) => {
    const source = draggedFile;
    setDragging(null);
    setDropTarget(null);
    if (!source || !view?.workspaceId || !canVersionOnto(target)) return;
    write({
      ids: [source.id, target.id],
      describe: `Adding ${source.name} to ${target.versioning.assetName}`,
      // Removed rather than moved optimistically: the row leaves the grid the moment it
      // becomes a version, because only the latest cut is shown.
      optimistic: (state) => ({ ...state, files: state.files.filter((item) => item.id !== source.id) }),
      rollback: (state) => ({ ...state, files: upsert(state.files, source) }),
      send: () => addAssetFileVersion(view.workspaceId!, target.id, source.id),
    });
  };
  /** Moves items into a folder (or to the root). A folder carries its client/project to what it receives; the root leaves them as they are. */
  const moveInto = (ids: string[], targetId: string | null) => {
    const target = targetId ? folders.find((folder) => folder.id === targetId) ?? null : null;
    const entities = ids.map((id) => byId.get(id)).filter(Boolean) as (LibraryFile | LibraryFolder)[];
    if (!entities.length) return;
    const apply = (state: LibraryState) => entities.reduce<LibraryState>((next, entity) => "kind" in entity
      ? { ...next, files: upsert(next.files, { ...entity, folderId: targetId, clientId: target ? target.clientId : entity.clientId, projectId: target ? target.projectId : entity.projectId }) }
      : assignFolderTree({ ...next, folders: upsert(next.folders, entity) }, entity, target ? target.clientId : entity.clientId, target ? target.projectId : entity.projectId, targetId), state);
    const where = target?.name ?? rootLabel;
    const describe = `Moving ${entities.length === 1 ? entities[0].name : `${entities.length} items`} to ${where}`;
    if (view?.workspaceId) {
      write({ ids, optimistic: apply, describe, send: () => Promise.all(entities.map((entity) => "kind" in entity
        ? updateAssetFile(view.workspaceId!, entity.id, { folder_id: targetId, client_team_id: target ? target.clientId : entity.clientId, project_id: target ? target.projectId : entity.projectId })
        : updateAssetFolder(view.workspaceId!, entity.id, { parent_folder_id: targetId, client_team_id: target ? target.clientId : entity.clientId, project_id: target ? target.projectId : entity.projectId }))) });
    } else {
      updateLibrary(apply);
    }
    setAnnouncement(`Moved ${entities.length === 1 ? entities[0].name : `${entities.length} items`} to ${where}.`);
  };

  /*
   * Re-reads the server while anything is still being processed.
   *
   * Scanning and thumbnail encoding happen in the worker, and nothing pushes their result
   * back, so without this the progress bar would sit there until someone reloaded. Capped
   * rather than endless: a poster that can never be produced — an mp4 with no video stream
   * does exactly that — must not keep the page polling for the rest of the session.
   */
  const workingKey = files.filter(isProcessing).map((item) => item.id).sort().join(",");
  const polls = useRef({ key: "", count: 0 });
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    if (!workingKey || !view?.workspaceId) return;
    if (polls.current.key !== workingKey) polls.current = { key: workingKey, count: 0 };
    if (polls.current.count >= 20) return;
    const timer = setTimeout(() => {
      polls.current.count += 1;
      setPoll((value) => value + 1);
      router.refresh();
    }, 3000);
    return () => clearTimeout(timer);
  }, [workingKey, poll, router, view?.workspaceId]);
  // Drives the count on the filter button, so a narrowed list is never a silent surprise.
  const activeFilters = [clientFilter, projectFilter, kindFilter, stageFilter].filter(Boolean).length
    + (searchEverywhere ? 1 : 0) + (sort === "newest" ? 0 : 1);
  /** Whether the empty grid means "nothing matches" rather than "nothing here". Sort never hides anything. */
  const narrowing = Boolean(query.trim()) || [clientFilter, projectFilter, kindFilter, stageFilter].some(Boolean);
  const resetFilters = () => {
    setClientFilter(""); setProjectFilter(""); setKindFilter(""); setStageFilter("");
    setSort("newest"); setSearchEverywhere(false);
  };

  /* ---------------------------------------------------------------- entity actions */
  const openEntity = (entity: LibraryFile | LibraryFolder) => {
    if (!("kind" in entity)) { setFolderId(entity.id); return; }
    if (isProcessing(entity)) return;
    const review = reviewHref(entity);
    if (review) openUniversalReview({ href: review, title: entity.name }); else setPreview(entity);
  };
  const removeEntities = (entities: (LibraryFile | LibraryFolder)[]) => {
    if (!entities.length) return;
    const label = entities.length === 1 ? entities[0].name : `${entities.length} selected items`;
    if (!confirm(`Delete ${label}?`)) return;
    const ids = new Set(entities.map((entity) => entity.id));
    const remove = (state: LibraryState) => deleteLibraryEntities(state, ids);
    if (view?.workspaceId) {
      write({ ids: [...ids], optimistic: remove, describe: `Deleting ${label}`,
        send: () => Promise.all(entities.map((entity) => "kind" in entity ? deleteAssetFile(view.workspaceId!, entity.id) : deleteAssetFolder(view.workspaceId!, entity.id))) });
    } else {
      updateLibrary(remove);
    }
    setSelection({ selected: new Set(), anchor: null });
  };
  const duplicate = (entity: LibraryFile) => {
    if (!view?.workspaceId) return;
    const draft: LibraryFile = { ...entity, id: newId("copy"), fileId: null, name: copyName(entity.name), status: "DUPLICATING", url: null, preview: null, uploadedAt: new Date().toISOString() };
    write({
      ids: [draft.id],
      describe: `Duplicating ${entity.name}`,
      optimistic: (state) => ({ ...state, files: [...state.files, draft] }),
      rollback: (state) => ({ ...state, files: state.files.filter((item) => item.id !== draft.id) }),
      send: () => duplicateAssetFile(view.workspaceId!, entity.id),
      onSaved: (saved) => updateLibrary((state) => ({ ...state, files: state.files.filter((item) => item.id !== draft.id && item.id !== saved.id) })),
    });
  };
  const download = (file: LibraryFile) => { if (file.url) window.location.assign(file.url); };
  const downloadManifest = (folder: LibraryFolder) => {
    const folderFiles = files.filter((file) => file.folderId === folder.id);
    const blob = new Blob([folderFiles.map((file) => `${file.name}\t${file.mimeType}\t${file.size}`).join("\n")], { type: "text/plain" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${folder.name}-manifest.txt`; link.click(); URL.revokeObjectURL(link.href);
  };
  const setStage = (file: LibraryFile, stageId: string | null) => {
    const apply = (state: LibraryState) => ({ ...state, files: upsert(state.files, { ...file, stageId }) });
    if (view?.workspaceId) write({ ids: [file.id], optimistic: apply, describe: `Moving ${file.name}`, send: () => updateAssetFile(view.workspaceId!, file.id, { task_stage_id: stageId }) });
    else updateLibrary(apply);
  };
  const showDetails = (entity: LibraryFile | LibraryFolder) => {
    setSelection({ selected: new Set([entity.id]), anchor: entity.id });
    if (inspectorDocked) setInspectorPref("open"); else setSheetOpen(true);
  };
  const inspectorActions: InspectorActions = {
    open: openEntity,
    rename: (entity) => setRenaming({ id: entity.id, where: "inspector" }),
    move: (entity) => setMoveIds(new Set([entity.id])),
    duplicate,
    download,
    downloadManifest,
    remove: (entity) => removeEntities([entity]),
    setStage,
  };

  /* ---------------------------------------------------------------- selection + keyboard */
  const select = (id: string, selectMode: "replace" | "toggle" | "range") => {
    setSelection((state) => nextSelection(pruneSelection(state, present), id, selectMode, order));
    setFocusedId(id);
  };
  const toggleSelected = (id: string) => select(id, "toggle");
  const allVisibleSelected = order.length > 0 && order.every((id) => selected.has(id));
  const toggleAllVisible = () => setSelection(allVisibleSelected ? { selected: new Set(), anchor: null } : { selected: new Set(order), anchor: order[0] ?? null });
  // After an inline rename the item is re-rendered; find it by id on the next frame.
  const refocusSoon = (id: string) => { requestAnimationFrame(() => document.querySelector<HTMLElement>(`.fx-item[data-id="${CSS.escape(id)}"]`)?.focus()); };
  const focusItem = (id: string | undefined) => { if (!id) return; setFocusedId(id); itemRefs.current.get(id)?.focus(); };
  const tabStop = focusedId && order.includes(focusedId) ? focusedId : order[0];
  const columnsFor = (sectionId: string) => {
    if (mode === "list") return 1;
    const grid = gridRefs.current.get(sectionId);
    const template = grid ? getComputedStyle(grid).gridTemplateColumns : "";
    return template && template !== "none" ? template.split(" ").filter(Boolean).length : 1;
  };
  const onItemKey = (event: ReactKeyboardEvent<HTMLDivElement>, entity: LibraryFile | LibraryFolder) => {
    if (event.target !== event.currentTarget) return; // keys inside the rename field or a menu stay there
    const id = entity.id;
    if (isMoveKey(event.key)) {
      event.preventDefault();
      const visibleSections = sections.map((section) => collapsed.has(section.id) ? 0 : section.folders.length + section.files.length);
      const sectionOf = sections.find((section) => [...section.folders, ...section.files].some((item) => item.id === id));
      const next = order[moveIndex(visibleSections, order.indexOf(id), event.key, sectionOf ? columnsFor(sectionOf.id) : 1)];
      if (!next) return;
      if (event.shiftKey) setSelection((raw) => { const state = pruneSelection(raw, present); return nextSelection(state.anchor ? state : { selected: state.selected, anchor: id }, next, "range", order); });
      focusItem(next);
      return;
    }
    if (event.key === " ") { event.preventDefault(); select(id, event.shiftKey ? "range" : "toggle"); return; }
    if (event.key === "Enter") { event.preventDefault(); openEntity(entity); return; }
    if (event.key === "F2") { event.preventDefault(); setRenaming({ id, where: "item" }); return; }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeEntities(selected.has(id) ? [...selectedFiles, ...selectedFolders] : [entity]);
      return;
    }
    if (event.key === "Escape" && selected.size) { event.preventDefault(); setSelection({ selected: new Set(), anchor: null }); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelection({ selected: new Set(order), anchor: order[0] ?? null }); return; }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); setMenuFor(id); }
  };
  const onPointerSelect = (event: ReactMouseEvent, entity: LibraryFile | LibraryFolder) => {
    if ((event.target as HTMLElement).closest("input, button, a, [role=menu]")) return;
    const selectMode = event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace";
    if (phone && selectMode === "replace" && !("kind" in entity)) { setFolderId(entity.id); return; }
    select(entity.id, selectMode);
    if (phone && selectMode === "replace") setSheetOpen(true);
  };

  // Page-level shortcuts: N new folder, U upload, / search, ] details panel.
  useEffect(() => { const shortcuts = (event: KeyboardEvent) => { const target = event.target; if ((target instanceof Element && target.matches("input, select, textarea, [contenteditable=true]")) || event.metaKey || event.ctrlKey || event.altKey) return; if (target instanceof Element && target.closest("[role=dialog], [role=menu]")) return; const key = event.key.toLowerCase(); if (key === "u") { event.preventDefault(); setDialog("upload"); } if (key === "n") { event.preventDefault(); setDialog("folder"); } if (key === "/") { event.preventDefault(); searchRef.current?.focus(); } if (key === "]") { event.preventDefault(); document.dispatchEvent(new CustomEvent("bf-files-toggle-inspector")); } }; window.addEventListener("keydown", shortcuts); return () => window.removeEventListener("keydown", shortcuts); }, []);
  const toggleRef = useRef(toggleInspector);
  useEffect(() => { toggleRef.current = toggleInspector; });
  useEffect(() => { const listener = () => toggleRef.current(); document.addEventListener("bf-files-toggle-inspector", listener); return () => document.removeEventListener("bf-files-toggle-inspector", listener); }, []);

  /* ---------------------------------------------------------------- OS file drop (upload) */
  const isOsDrag = (event: DragEvent) => !dragging && [...event.dataTransfer.types].includes("Files");
  const osDragProps = {
    onDragOver: (event: DragEvent) => { if (!isOsDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!osDrag) setOsDrag(true); },
    onDragLeave: (event: DragEvent) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setOsDrag(false); },
    onDrop: (event: DragEvent) => { if (!isOsDrag(event)) return; event.preventDefault(); setOsDrag(false); const list = [...event.dataTransfer.files]; if (list.length) { setDropped(list); setDialog("upload"); } },
  };

  /* ---------------------------------------------------------------- render helpers */
  const relation = (entity: { clientId: string | null; projectId: string | null }) => relationLabel(entity, view);
  const locationLabel = (id: string | null) => { const folder = folders.find((item) => item.id === id) ?? null; return [rootLabel, ...folderTrail(folder, folders).map((item) => item.name)].join(" / "); };
  const folderItemCount = (folder: LibraryFolder) => files.filter((file) => file.folderId === folder.id && file.versioning.isLatest).length + folders.filter((item) => item.parentFolderId === folder.id).length;
  const showRelation = !compact && groupBy !== "project";
  const showChecks = selected.size > 0;
  const renameField = (entity: LibraryFile | LibraryFolder, where: "item" | "inspector") =>
    renaming?.id === entity.id && renaming.where === where
      ? <RenameField entity={entity} isFile={"kind" in entity} view={view} done={() => { setRenaming(null); if (where === "item") refocusSoon(entity.id); }} large={where === "inspector"} />
      : null;
  const commonFor = (entity: LibraryFile | LibraryFolder): ItemCommon => {
    const isFile = "kind" in entity;
    const folderTarget = !isFile && canMoveInto(entity.id);
    const versionTarget = isFile && canVersionOnto(entity);
    const accepting = folderTarget || versionTarget;
    return {
      mode, density, selected: selected.has(entity.id), focusable: tabStop === entity.id, showChecks,
      renaming: renameField(entity, "item"),
      menu: <ItemMenu entity={entity} folders={folders} view={view} open={menuFor === entity.id} onOpenChange={(open) => setMenuFor(open ? entity.id : null)}
        returnFocus={() => itemRefs.current.get(entity.id)?.focus()}
        onOpen={() => openEntity(entity)} onDetails={() => showDetails(entity)} onRename={() => setRenaming({ id: entity.id, where: "item" })}
        onDuplicate={isFile ? () => duplicate(entity) : undefined} onDownload={isFile ? () => download(entity) : undefined}
        onDownloadManifest={!isFile ? () => downloadManifest(entity) : undefined} onDelete={() => removeEntities([entity])} />,
      onPointerSelect: (event) => onPointerSelect(event, entity),
      onToggle: () => toggleSelected(entity.id),
      onOpen: () => openEntity(entity),
      onKeyDown: (event) => onItemKey(event, entity),
      onFocus: () => setFocusedId(entity.id),
      onContextMenu: (event) => { event.preventDefault(); if (!selected.has(entity.id)) select(entity.id, "replace"); setMenuFor(entity.id); },
      register: (node) => { if (node) itemRefs.current.set(entity.id, node); else itemRefs.current.delete(entity.id); },
      draggable: !(isFile && isProcessing(entity)) && renaming?.id !== entity.id,
      isDragSource: Boolean(dragging?.ids.includes(entity.id)),
      onDragStart: (event) => {
        const ids = selected.has(entity.id) && selected.size > 1 ? order.filter((id) => selected.has(id)) : [entity.id];
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/asset-file", ids.join(","));
        setDragging({ ids, file: isFile ? entity : null });
      },
      onDragEnd: () => { setDragging(null); setDropTarget(null); },
      dropLabel: dropTarget === entity.id && accepting ? (versionTarget ? `Drop to create V${(entity as LibraryFile).versioning.versionCount + 1}` : `Move to ${entity.name}`) : null,
      dropInert: Boolean(dragging) && !accepting && !dragging!.ids.includes(entity.id),
      onDragOver: (event) => { if (!accepting) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dropTarget !== entity.id) setDropTarget(entity.id); },
      onDragLeave: () => setDropTarget((target) => target === entity.id ? null : target),
      onDrop: (event) => {
        if (!accepting) return;
        event.preventDefault(); event.stopPropagation();
        if (versionTarget) { createVersion(entity as LibraryFile); return; }
        const ids = dragging!.ids; setDragging(null); setDropTarget(null); moveInto(ids, entity.id);
      },
    };
  };

  const itemTotal = scope.folders.length + scope.files.length;
  const treeRows = folderTreeRows(folders, files, expandedFolders, folderId);
  const campaigns = (view?.groups ?? []).map((group) => ({ id: group.projectId, name: group.projectName, count: files.filter((file) => file.projectId === group.projectId && file.versioning.isLatest).length })).sort((a, b) => a.name.localeCompare(b.name));
  const activeChips: { key: string; label: string; clear: () => void }[] = [
    ...(clientFilter ? [{ key: "client", label: `Client: ${view?.clients.find((item) => item.id === clientFilter)?.name ?? "…"}`, clear: () => { setClientFilter(""); setProjectFilter(""); } }] : []),
    ...(projectFilter ? [{ key: "project", label: `Campaign: ${projectName_(projectFilter) ?? "…"}`, clear: () => setProjectFilter("") }] : []),
    ...(kindFilter ? [{ key: "kind", label: `Type: ${kindFilter}`, clear: () => setKindFilter("") }] : []),
    ...(stageFilter ? [{ key: "stage", label: `Stage: ${stages.find((item) => item.id === stageFilter)?.name ?? "…"}`, clear: () => setStageFilter("") }] : []),
  ];

  const tree = hasTree && (
    <aside className={`fx-tree ${treeDocked ? "is-docked" : "is-drawer"}`} style={{ width: treeDocked ? treeWidth : undefined }} aria-label="Library">
      <header className="fx-tree-head">
        <h1>{compact ? rootLabel : "Files"}</h1>
        {!treeDocked && <button type="button" className="fx-icon-btn is-sm" onClick={() => setTreeDrawer(false)} aria-label="Close library panel"><X /></button>}
      </header>
      <LibraryTree
        rows={treeRows} rootLabel={rootLabel} rootCount={files.filter((file) => file.versioning.isLatest).length}
        folderId={folderId} onOpenFolder={setFolderId}
        onToggleFolder={(id, open) => setExpandedFolders((set) => { if (open) set.add(id); else set.delete(id); return set; })}
        campaigns={campaigns} campaignFilter={projectFilter}
        onCampaign={(id) => { setProjectFilter(projectFilter === id ? "" : id); setFolderId(null); }}
        canDrop={canMoveInto} onDrop={(target) => { if (!dragging) return; const ids = dragging.ids; setDragging(null); setDropTarget(null); moveInto(ids, target); }}
      />
      {treeDocked && <PanelResizer label="Resize library panel" value={treeWidth} min={200} max={360} fallback={width >= 1400 ? 240 : 224} edge="left" onChange={setTreeWidth} />}
    </aside>
  );

  const inspector = inspectorVisible && (
    <aside
      className={`fx-inspector ${inspectorDocked ? "is-docked" : phone ? "is-bottom-sheet" : "is-sheet"}`}
      style={{ width: inspectorDocked ? inspectorWidth : undefined }}
      aria-labelledby="fx-inspector-title"
      {...(inspectorDocked ? {} : { role: "dialog", "aria-modal": true })}
    >
      {inspectorDocked && <PanelResizer label="Resize details panel" value={inspectorWidth} min={280} max={400} fallback={width >= 1400 ? 320 : 280} edge="right" onChange={setInspectorWidth} />}
      <SheetFocus active={!inspectorDocked} onClose={() => setSheetOpen(false)}>
        <AssetInspector
          selectedFiles={selectedFiles} selectedFolders={selectedFolders}
          scope={{ title: current?.name ?? (projectFilter ? projectName_(projectFilter) ?? rootLabel : rootLabel), files: scope.files, folders: scope.folders }}
          stages={stages} relation={relation} location={locationLabel} folderItemCount={folderItemCount}
          reviewable={(file) => Boolean(reviewHref(file))}
          renaming={selected.size === 1 ? renameField([...selectedFiles, ...selectedFolders][0], "inspector") : null}
          actions={inspectorActions}
          onClose={() => { if (inspectorDocked) setInspectorPref("closed"); else setSheetOpen(false); }}
          canDuplicate={!offline}
        />
      </SheetFocus>
    </aside>
  );

  return <RefreshContext.Provider value={() => router.refresh()}><ReportContext.Provider value={setWriteError}>
    <div ref={rootRef} className={`fx asset-library ${compact ? "is-compact" : ""} ${phone ? "is-phone" : ""}`} data-tree={hasTree ? (treeDocked ? "docked" : "drawer") : "none"} data-inspector={inspectorVisible ? (inspectorDocked ? "docked" : "sheet") : "closed"}>
      {tree && treeDocked && tree}
      {tree && !treeDocked && treeDrawer && <><button type="button" className="fx-scrim" aria-label="Close library panel" tabIndex={-1} onClick={() => setTreeDrawer(false)} /><SheetFocus active onClose={() => setTreeDrawer(false)}>{tree}</SheetFocus></>}

      <section className="fx-main" aria-label="Files" {...osDragProps}>
        <header className="fx-toolbar">
          {hasTree && !treeDocked && <button type="button" className="fx-icon-btn" onClick={() => setTreeDrawer(true)} aria-label="Open library panel" aria-expanded={treeDrawer}><PanelLeft /></button>}
          <nav className="fx-crumbs" aria-label="Breadcrumb">
            <ol>
              <li><button type="button" onClick={() => setFolderId(null)} aria-current={!current ? "page" : undefined}>{rootLabel}</button></li>
              {crumbs.map((folder) => <li key={folder.id}><ChevronRight aria-hidden="true" /><button type="button" onClick={() => setFolderId(folder.id)} aria-current={folder.id === folderId ? "page" : undefined}>{folder.name}</button></li>)}
            </ol>
          </nav>
          <span className="fx-total" aria-live="polite">{itemTotal} item{itemTotal === 1 ? "" : "s"}</span>
          <div className="fx-toolbar-actions">
            <button type="button" className="fx-btn" onClick={() => setDialog("folder")}><FolderPlus /><span>New folder</span></button>
            <button type="button" className="fx-icon-btn" onClick={() => router.refresh()} aria-label="Refresh assets"><RefreshCw /></button>
            {/* Inside the project page the page header already owns the one primary Upload. */}
            <button type="button" className={`fx-btn ${compact ? "" : "is-primary"}`} onClick={() => setDialog("upload")}><Upload /><span>Upload</span></button>
          </div>
        </header>
        <div className="fx-toolbar is-secondary">
          <label className="fx-search">
            <Search aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this location…" aria-label={searchEverywhere ? "Search all folders" : "Search this location"}
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); if (query) setQuery(""); else event.currentTarget.blur(); } }} />
            {query && <button type="button" className="fx-icon-btn is-xs" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search text"><X /></button>}
          </label>
          <FilterMenu
            view={view} groups={filteredProjects} stages={stages} showRelations={!projectId} activeCount={activeFilters}
            searchEverywhere={searchEverywhere} setSearchEverywhere={setSearchEverywhere}
            clientFilter={clientFilter} setClientFilter={setClientFilter}
            projectFilter={projectFilter} setProjectFilter={setProjectFilter}
            kindFilter={kindFilter} setKindFilter={setKindFilter}
            stageFilter={stageFilter} setStageFilter={setStageFilter}
            sort={sort} setSort={setSort} onReset={resetFilters}
            groupBy={groupBy} setGroupBy={setGroupBy} density={density} setDensity={setDensity}
          />
          {activeChips.length > 0 && <ul className="fx-chips" aria-label="Active filters">{activeChips.map((chip) => <li key={chip.key}><span>{chip.label}</span><button type="button" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`}><X /></button></li>)}</ul>}
          <span className="fx-spacer" />
          {order.length > 0 && <label className="fx-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />Select all visible</label>}
          <div className="fx-segmented" role="group" aria-label="Layout">
            <button type="button" className={mode === "grid" ? "is-on" : ""} onClick={() => setMode("grid")} aria-label="Grid view" aria-pressed={mode === "grid"}><LayoutGrid /></button>
            <button type="button" className={mode === "list" ? "is-on" : ""} onClick={() => setMode("list")} aria-label="List view" aria-pressed={mode === "list"}><List /></button>
          </div>
          <button type="button" className={`fx-icon-btn fx-details-toggle ${inspectorVisible ? "is-on" : ""}`} onClick={toggleInspector} aria-pressed={inspectorVisible} aria-label="Details panel" title="Details panel (])"><PanelRight /></button>
        </div>
        {selected.size > 1 && <div className="fx-bulk" role="region" aria-label="Selection">
          <strong role="status" aria-live="polite">{selected.size} selected</strong>
          <button type="button" className="fx-btn is-ghost is-sm" onClick={() => setSelection({ selected: new Set(), anchor: null })}>Clear</button>
          <span className="fx-spacer" />
          <button type="button" className="fx-btn is-sm" onClick={() => setMoveIds(new Set(selected))}><Move />Move / assign</button>
          <button type="button" className="fx-btn is-sm is-danger" onClick={() => removeEntities([...selectedFiles, ...selectedFolders])}><Trash2 />Delete</button>
        </div>}

        <div className="fx-content">
          {writeError && <p className="fx-notice" data-tone="danger" role="alert"><TriangleAlert />{writeError}<button type="button" className="fx-icon-btn is-xs" onClick={() => setWriteError(null)} aria-label="Dismiss error"><X /></button></p>}
          {recursiveSearch && <p className="fx-results-note">Showing matches from every folder in {projectName || "Files"}.</p>}
          {mode === "list" && sections.length > 0 && <div className="fx-list-head" role="group" aria-label="Sort list">
            <span className="fx-col-check" />
            <SortHeader label="Name" active={sort === "name"} onClick={() => setSort(sort === "name" ? "newest" : "name")} />
            <span className="fx-col-stage">Stage</span><span className="fx-col-version">Ver.</span><span className="fx-col-feedback" aria-label="Comments" />
            <SortHeader label="Size" active={sort === "size"} onClick={() => setSort(sort === "size" ? "newest" : "size")} className="fx-col-size" />
            <SortHeader label="Added" active={sort === "newest"} onClick={() => setSort("newest")} className="fx-col-date" />
            <span className="fx-col-actions" />
          </div>}
          {sections.map((section) => {
            const isCollapsed = collapsed.has(section.id);
            const bodyId = `fx-section-${section.id.replace(/[^a-z0-9-]/gi, "-")}`;
            const count = section.folders.length + section.files.length;
            return (
              <section key={section.id} className="fx-section">
                {(sections.length > 1 || section.id !== "all") && <h2 className="fx-section-head">
                  <button type="button" aria-expanded={!isCollapsed} aria-controls={bodyId} onClick={() => setCollapsed((set) => { if (set.has(section.id)) set.delete(section.id); else set.add(section.id); return set; })}>
                    <ChevronRight className="fx-chevron" aria-hidden="true" /><span>{section.title}</span><span className="fx-count">{count}</span>
                  </button>
                </h2>}
                {!isCollapsed && <div
                  id={bodyId} role="grid" aria-label={section.title} aria-multiselectable="true" aria-rowcount={count}
                  className={`fx-grid is-${mode} is-${density}`}
                  ref={(node) => { if (node) gridRefs.current.set(section.id, node); else gridRefs.current.delete(section.id); }}
                >
                  {section.folders.map((folder) => <FolderItem key={folder.id} folder={folder} childFiles={files.filter((file) => file.folderId === folder.id && file.versioning.isLatest)} itemCount={folderItemCount(folder)} relation={showRelation ? relation(folder) : null} common={commonFor(folder)} />)}
                  {section.files.map((file) => <FileItem key={file.id} file={file} stage={stages.find((item) => item.id === file.stageId) ?? null} relation={showRelation ? relation(file) : null} reviewable={Boolean(reviewHref(file))} common={commonFor(file)} />)}
                </div>}
              </section>
            );
          })}
          {!itemTotal && (narrowing
            ? <div className="fx-empty is-no-results" role="status">
                <span><SearchX aria-hidden="true" /></span>
                <strong>{query.trim() ? `No files match “${query.trim()}”` : "No files match these filters"}</strong>
                <p>{query.trim() ? `Nothing in ${current?.name ?? rootLabel}${searchEverywhere ? " or its folders" : ""}. Try another name${searchEverywhere ? " or loosen the filters" : ", or search all folders"}.` : `${activeChips.length} filter${activeChips.length === 1 ? "" : "s"} active.`}</p>
                <div>
                  <button type="button" className="fx-btn" onClick={() => { setQuery(""); resetFilters(); }}>{query.trim() ? "Clear search" : "Clear filters"}</button>
                  {query.trim() && !searchEverywhere && <button type="button" className="fx-btn is-ghost" onClick={() => setSearchEverywhere(true)}>Search all folders</button>}
                </div>
              </div>
            : <div className="fx-empty">
                <span><Archive aria-hidden="true" /></span>
                <strong>{current ? "This folder is empty" : "No files yet"}</strong>
                <p>Drop files here or upload to start a review.</p>
                <div><button type="button" className="fx-btn is-primary" onClick={() => setDialog("upload")}><Upload />Upload files</button></div>
              </div>)}
        </div>
        {osDrag && <div className="fx-os-drop" aria-hidden="true"><Upload /><strong>Upload to {current?.name ?? rootLabel}</strong><span>Release to stage these files</span></div>}
      </section>

      {inspector && !inspectorDocked && <button type="button" className="fx-scrim" aria-label="Close details" tabIndex={-1} onClick={() => setSheetOpen(false)} />}
      {inspector}
      <p className="fx-sr-only" role="status" aria-live="polite">{announcement}</p>

      {dialog === "folder" && <FolderDialog view={view} folders={folders} defaultProjectId={projectId} defaultClientId={clientId} parentFolderId={folderId} close={() => setDialog(null)} />}
      {dialog === "upload" && <UploadDialog view={view} folders={folders} defaultProjectId={projectId} defaultClientId={clientId} currentFolderId={folderId} initialFiles={dropped} close={() => { setDialog(null); setDropped([]); }} />}
      {preview && <PreviewDialog file={preview} close={() => setPreview(null)} />}
      {moveIds && <BulkAssignmentDialog view={view} folders={folders} selected={moveIds} close={() => setMoveIds(null)} done={() => { setMoveIds(null); setSelection({ selected: new Set(), anchor: null }); }} />}
    </div>
  </ReportContext.Provider></RefreshContext.Provider>;
}

function SortHeader({ label, active, onClick, className }: { label: string; active: boolean; onClick: () => void; className?: string }) {
  return <button type="button" className={`fx-sort ${className ?? "fx-col-name"} ${active ? "is-on" : ""}`} onClick={onClick} aria-pressed={active} aria-label={`Sort by ${label.toLowerCase()}`}>{label}{active && (label === "Name" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)}</button>;
}

/**
 * Focus handling for the overlay forms of the tree and the inspector (drawer / sheet):
 * focus moves in, Tab stays inside, Esc closes and focus returns to where it was.
 */
function SheetFocus({ active, onClose, children }: { active: boolean; onClose: () => void; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button:not([disabled]), [tabindex='0'], input")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [active]);
  if (!active) return <>{children}</>;
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !(event.target as HTMLElement).closest("input")) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(root.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex='0']") ?? [])];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={root} className="fx-sheet-focus" onKeyDown={keys}>{children}</div>;
}

/**
 * Filters, behind one button.
 *
 * These used to be a permanent row of five controls under the breadcrumb, which cost a
 * band of vertical space on every visit to say "nothing is filtered". Collapsing them
 * keeps the page to a header and the grid, and the badge on the trigger is what stops a
 * filtered list from looking like an empty folder.
 *
 * Radix's `Select` is used rather than a native `<select>` so the options are themed with
 * the rest of the panel; `modal={false}` on the popover is deliberate, as a modal popover
 * fights the select's own focus trap when it opens inside one.
 */
function FilterMenu({
  view, groups, stages, showRelations, activeCount,
  searchEverywhere, setSearchEverywhere, clientFilter, setClientFilter, projectFilter, setProjectFilter,
  kindFilter, setKindFilter, stageFilter, setStageFilter, sort, setSort, onReset,
  groupBy, setGroupBy, density, setDensity,
}: {
  view?: FilesView;
  groups: { projectId: string; projectName: string }[];
  stages: { id: string; name: string }[];
  showRelations: boolean;
  activeCount: number;
  searchEverywhere: boolean; setSearchEverywhere: (value: boolean) => void;
  clientFilter: string; setClientFilter: (value: string) => void;
  projectFilter: string; setProjectFilter: (value: string) => void;
  kindFilter: LibraryKind | ""; setKindFilter: (value: LibraryKind | "") => void;
  stageFilter: string; setStageFilter: (value: string) => void;
  sort: "newest" | "name" | "size"; setSort: (value: "newest" | "name" | "size") => void;
  onReset: () => void;
  groupBy: GroupBy; setGroupBy: (value: GroupBy) => void;
  density: Density; setDensity: (value: Density) => void;
}) {
  return (
    <FilterPopover activeCount={activeCount}>
        <header>
          <strong>Filters</strong>
          {activeCount > 0 && <button type="button" onClick={onReset}><RotateCcw />Reset</button>}
        </header>

        <label className="al-filter-switch">
          <span>
            Search all folders
            <small>Look through every subfolder, not just this one.</small>
          </span>
          <Switch checked={searchEverywhere} onCheckedChange={setSearchEverywhere} label="Search all folders" />
        </label>

        {showRelations && (
          <>
            <FilterField label="Client" value={clientFilter} placeholder="All clients"
              onChange={(value) => { setClientFilter(value); setProjectFilter(""); }}
              options={(view?.clients ?? []).map((client) => ({ value: client.id, label: client.name }))} />
            <FilterField label="Project" value={projectFilter} placeholder="All projects"
              onChange={setProjectFilter}
              options={groups.map((group) => ({ value: group.projectId, label: group.projectName }))} />
          </>
        )}

        <FilterField label="File type" value={kindFilter} placeholder="All file types"
          onChange={(value) => setKindFilter(value as LibraryKind | "")}
          options={[
            { value: "video", label: "Video" }, { value: "audio", label: "Audio" },
            { value: "image", label: "Images" }, { value: "document", label: "Documents" },
            { value: "source", label: "Source files" }, { value: "other", label: "Other" },
          ]} />

        <FilterField label="Stage" value={stageFilter} placeholder="All stages"
          onChange={setStageFilter}
          options={stages.map((stage) => ({ value: stage.id, label: stage.name }))} />

        <FilterField label="Sort" value={sort} placeholder="Newest first" clearable={false}
          onChange={(value) => setSort((value || "newest") as "newest" | "name" | "size")}
          options={[
            { value: "newest", label: "Newest first" }, { value: "name", label: "Name A–Z" }, { value: "size", label: "Largest first" },
          ]} />

        <p className="al-filter-group">Display</p>
        <FilterField label="Group by" ariaLabel="Group by" value={groupBy} placeholder="Campaign" clearable={false}
          onChange={(value) => setGroupBy((value || "project") as GroupBy)}
          options={[{ value: "project", label: "Campaign" }, { value: "type", label: "File type" }, { value: "none", label: "No grouping" }]} />
        <FilterField label="Density" ariaLabel="Density" value={density} placeholder="Comfortable" clearable={false}
          onChange={(value) => setDensity((value || "comfortable") as Density)}
          options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
    </FilterPopover>
  );
}

/**
 * The panel itself, hand-rolled rather than taken from a registry.
 *
 * Radix's Popover was used here first. It is correct in a browser, but under jsdom its
 * Floating UI positioning polls without ever settling: merely opening the panel pushed a
 * test from 130ms to 1.8s, and opening it before a dialog hung the runner outright. This
 * panel is anchored to its own trigger and needs no collision detection, so the handful of
 * lines below buy back a fast, deterministic suite. Dismissal still matches what a popover
 * is expected to do — outside pointer, Escape, or the trigger again.
 */
function FilterPopover({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="al-filter-wrap" ref={root}>
      <button
        type="button"
        className="al-filter-trigger"
        data-state={open ? "open" : "closed"}
        aria-expanded={open}
        aria-label={activeCount ? `Filters, ${activeCount} active` : "Filters"}
        onClick={() => setOpen(!open)}
      >
        <ListFilter />
        <span>Filters</span>
        {activeCount > 0 && <i>{activeCount}</i>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="al-filter-panel"
            initial={reduced ? false : { opacity: 0, y: -6, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: -6, scale: .98 }}
            transition={{ duration: .16, ease: [.22, 1, .36, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One labelled filter.
 *
 * A native `<select>` on purpose. shadcn's Radix-backed Select was tried here and looks
 * better, but it does not open under jsdom and one of its keyboard paths hangs the test
 * runner outright — not something worth putting between a filter and its test. The native
 * control is keyboard- and screen-reader-correct for free, and `color-scheme: dark` on it
 * means the browser draws the option list to match the panel.
 */
function FilterField({ label, value, placeholder, options, onChange, clearable = true, ariaLabel }: {
  label: string; value: string; placeholder: string; clearable?: boolean; ariaLabel?: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="al-filter-field">
      <span>{label}</span>
      <select aria-label={ariaLabel ?? `Filter by ${label.toLowerCase()}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {clearable && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/**
 * The ⋯ menu on a tile or row. Controlled, so right-click and Shift+F10 open the same menu
 * from the item itself; closing it hands focus back to the item, not to the hidden trigger.
 */
function ItemMenu({ entity, folders, view, open, onOpenChange, returnFocus, onOpen, onDetails, onRename, onDuplicate, onDownload, onDownloadManifest, onDelete }: {
  entity: LibraryFile | LibraryFolder; folders: LibraryFolder[]; view?: FilesView;
  open: boolean; onOpenChange: (open: boolean) => void; returnFocus: () => void;
  onOpen: () => void; onDetails: () => void; onRename: () => void;
  onDuplicate?: () => void; onDownload?: () => void; onDownloadManifest?: () => void; onDelete: () => void;
}) {
  const isFile = "kind" in entity;
  const review = isFile ? reviewHref(entity as LibraryFile) : null;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger className="fx-menu-trigger" tabIndex={-1} aria-label={`Actions for ${entity.name}`} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><Ellipsis /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="fx-menu" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(); }}>
        {!isFile && <DropdownMenuItem onSelect={onOpen}><FolderOpen />Open</DropdownMenuItem>}
        {review && <DropdownMenuItem onSelect={onOpen}><Clapperboard />Open review</DropdownMenuItem>}
        {isFile && !review && <DropdownMenuItem onSelect={onOpen}><Eye />Preview</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onDetails}><Info />Details</DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}><Pencil />Rename</DropdownMenuItem>
        <AssignmentMenu entity={entity} folders={folders} view={view} />
        {isFile && <StageMenu file={entity as LibraryFile} view={view} />}
        {isFile && view?.workspaceId && onDuplicate && <DropdownMenuItem onSelect={onDuplicate}><Copy />Duplicate</DropdownMenuItem>}
        {isFile && (entity as LibraryFile).url && onDownload && <DropdownMenuItem onSelect={onDownload}><Download />Download</DropdownMenuItem>}
        {!isFile && onDownloadManifest && <DropdownMenuItem onSelect={onDownloadManifest}><Download />Download manifest</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Renames in place. The browser's `prompt()` this replaced sat outside the page entirely. */
function RenameField({ entity, isFile, view, done, large = false }: { entity: LibraryFile | LibraryFolder; isFile: boolean; view?: FilesView; done: () => void; large?: boolean }) {
  const write = useAssetWrite();
  const [value, setValue] = useState(entity.name);
  const commit = () => {
    const name = value.trim();
    if (!name || name === entity.name) return done();
    const rename = (state: LibraryState) => ({ ...state,
      folders: isFile ? state.folders : upsert(state.folders, { ...entity, name } as LibraryFolder),
      files: isFile ? upsert(state.files, { ...entity, name } as LibraryFile) : state.files });
    if (view?.workspaceId) {
      write({ ids: [entity.id], optimistic: rename, describe: `Renaming ${entity.name}`,
        send: (): Promise<unknown> => isFile ? updateAssetFile(view.workspaceId!, entity.id, { name }) : updateAssetFolder(view.workspaceId!, entity.id, { name }) });
    } else {
      updateLibrary(rename);
    }
    done();
  };
  return <input
    className={`fx-rename ${large ? "is-lg" : ""}`}
    value={value}
    autoFocus
    // The stem is selected, not the extension, so typing replaces the name and keeps `.mp4`.
    onFocus={(event) => { const dot = isFile ? value.lastIndexOf(".") : -1; event.currentTarget.setSelectionRange(0, dot > 0 ? dot : value.length); }}
    aria-label={`Rename ${entity.name}`}
    onChange={(event) => setValue(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { event.preventDefault(); done(); } }}
    onClick={(event) => event.stopPropagation()}
  />;
}
function StageMenu({ file, view }: { file: LibraryFile; view?: FilesView }) {
  const write = useAssetWrite();
  const set = (stageId: string | null) => {
    const apply = (state: LibraryState) => ({ ...state, files: upsert(state.files, { ...file, stageId }) });
    if (view?.workspaceId) write({ ids: [file.id], optimistic: apply, describe: `Moving ${file.name}`, send: () => updateAssetFile(view.workspaceId!, file.id, { task_stage_id: stageId }) });
    else updateLibrary(apply);
  };
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger><Tag />Stage</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => set(null)} aria-current={!file.stageId}>No stage</DropdownMenuItem>
        {(view?.stages ?? []).map((stage) => <DropdownMenuItem key={stage.id} onSelect={() => set(stage.id)} aria-current={file.stageId === stage.id}>{stage.name}</DropdownMenuItem>)}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
function AssignmentMenu({ entity, folders, view }: { entity: LibraryFile | LibraryFolder; folders: LibraryFolder[]; view?: FilesView }) {
  const isFile = "kind" in entity;
  const write = useAssetWrite();
  const blocked = isFile ? new Set<string>() : descendantFolderIds(folders, entity.id);
  const set = (clientId: string | null, projectId: string | null, folderId?: string | null) => {
    const apply = (state: LibraryState) => isFile
      ? ({ ...state, files: upsert(state.files, { ...entity, clientId, projectId, ...(folderId !== undefined ? { folderId } : {}) } as LibraryFile) })
      : assignFolderTree({ ...state, folders: upsert(state.folders, entity as LibraryFolder) }, entity as LibraryFolder, clientId, projectId, folderId ?? null);
    if (!view?.workspaceId) { updateLibrary(apply); return; }
    write({ ids: [entity.id], optimistic: apply, describe: `Assigning ${entity.name}`,
      send: (): Promise<unknown> => isFile
        ? updateAssetFile(view.workspaceId!, entity.id, { client_team_id: clientId, project_id: projectId, folder_id: folderId ?? null })
        : updateAssetFolder(view.workspaceId!, entity.id, { client_team_id: clientId, project_id: projectId, parent_folder_id: folderId ?? null }) });
  };
  const clients = view?.clients ?? [];
  const projects = view?.groups ?? [];
  const destinations = folders.filter((folder) => folder.id !== entity.id && !blocked.has(folder.id));
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger><Move />Move / assign</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="al-assign-menu">
        <DropdownMenuItem onSelect={() => set(null, null, null)}>Root / unassigned</DropdownMenuItem>
        {clients.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Clients</DropdownMenuLabel>
          {/* Client only: the asset belongs to the client but not to any one project yet. */}
          {clients.map((client) => <DropdownMenuItem key={client.id} onSelect={() => set(client.id, null, null)}>{client.name}</DropdownMenuItem>)}</>}
        {projects.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((group) => <DropdownMenuItem key={group.projectId} onSelect={() => set(group.clientId, group.projectId, null)}>{group.projectName}</DropdownMenuItem>)}</>}
        {destinations.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Folders</DropdownMenuLabel>
          {destinations.map((folder) => <DropdownMenuItem key={folder.id} onSelect={() => set(folder.clientId, folder.projectId, folder.id)}>{folder.name}</DropdownMenuItem>)}</>}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function BulkAssignmentDialog({ view, folders, selected, close, done }: { view?: FilesView; folders: LibraryFolder[]; selected: Set<string>; close: () => void; done: () => void }) {
  const write = useAssetWrite();
  const [client, setClient] = useState(""); const [project, setProject] = useState(""); const [stage, setStage] = useState("");
  const projects = (view?.groups ?? []).filter((group) => !client || group.clientId === client); const destinations = folders.filter((folder) => !selected.has(folder.id) && (!project || folder.projectId === project));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget), folderId = String(data.get("folder") || "") || null, projectRow = view?.groups.find((group) => group.projectId === project), clientId = (projectRow?.clientId ?? client) || null;
    const state = snapshotLibrary();
    // An empty choice means "leave each file's stage alone".
    const restaged: Set<string> = stage ? new Set(stageFileIds(state, selected)) : new Set<string>();
    const calls: (() => Promise<unknown>)[] = [];
    const touched = new Set<string>(restaged);
    if (view?.workspaceId) {
      selected.forEach((id) => {
        touched.add(id);
        const relations = { client_team_id: clientId, project_id: project || null };
        if (state.files.some((item) => item.id === id)) calls.push(() => updateAssetFile(view.workspaceId!, id, { ...relations, folder_id: folderId, ...(restaged.has(id) ? { task_stage_id: stage } : {}) }));
        if (state.folders.some((item) => item.id === id)) calls.push(() => updateAssetFolder(view.workspaceId!, id, { ...relations, parent_folder_id: folderId }));
      });
      // Files pulled in by a selected folder still need their own stage write.
      restaged.forEach((id) => { if (!selected.has(id)) calls.push(() => updateAssetFile(view.workspaceId!, id, { task_stage_id: stage })); });
    }
    const apply = (current: LibraryState) => {
      const assigned = assignLibraryEntities(current, selected, clientId, project || null, folderId);
      return stage ? applyLibraryStage(assigned, selected, stage) : assigned;
    };
    if (calls.length) write({ ids: [...touched], optimistic: apply, describe: `Moving ${selected.size} item${selected.size === 1 ? "" : "s"}`, send: () => Promise.all(calls.map((call) => call())) });
    else updateLibrary(apply);
    done();
  };
  return <Modal title={`Move / assign ${selected.size} item${selected.size === 1 ? "" : "s"}`} close={close}><form className="al-form" onSubmit={submit}><RelationFields view={view} projects={projects} client={client} setClient={setClient} selectedProject={project} setProject={setProject} /><label>Destination folder<select name="folder" defaultValue=""><option value="">Project or Files root</option>{destinations.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>Stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="">Leave unchanged</option>{(view?.stages ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button>Apply to {selected.size} item{selected.size === 1 ? "" : "s"}</button></form></Modal>;
}

function FolderDialog({ view, folders, defaultProjectId, defaultClientId, parentFolderId, close }: { view?: FilesView; folders: LibraryFolder[]; defaultProjectId: string | null; defaultClientId: string | null; parentFolderId: string | null; close: () => void }) { const write = useAssetWrite(); const [client, setClient] = useState(defaultClientId ?? ""); const [selectedProject, setSelectedProject] = useState(defaultProjectId ?? ""); const projects = (view?.groups ?? []).filter((group) => !client || group.clientId === client); const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget), project = String(data.get("project") || selectedProject || "") || null; const projectRow = view?.groups.find((item) => item.projectId === project); const draft = { id: newId("folder"), name: String(data.get("name")), clientId: (projectRow?.clientId ?? client) || null, projectId: project, parentFolderId, createdAt: new Date().toISOString(), createdBy: "You" }; const add = (state: LibraryState) => ({ ...state, folders: [...state.folders, draft] });
    if (view?.workspaceId) {
      write({ ids: [draft.id], optimistic: add, describe: `Creating ${draft.name}`,
        send: () => createAssetFolder(view.workspaceId!, { name: draft.name, client_team_id: draft.clientId, project_id: draft.projectId, parent_folder_id: draft.parentFolderId }),
        onSaved: (saved) => updateLibrary((state) => ({ ...state, folders: state.folders.map((item) => item.id === draft.id ? { ...draft, id: saved.id, createdAt: saved.created_at } : item) })) });
    } else { updateLibrary(add); }
    close(); }; return <Modal title="Create folder" close={close}><form onSubmit={submit} className="al-form"><label>Folder name<input name="name" required autoFocus placeholder="Footage" /></label><RelationFields view={view} projects={projects} client={client} setClient={setClient} selectedProject={selectedProject} setProject={setSelectedProject} /><label>Inside folder<select name="parent" value={parentFolderId ?? ""} disabled><option value="">Root Files area</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><button>Create folder</button></form></Modal>; }
function UploadDialog({ view, folders, defaultProjectId, defaultClientId, currentFolderId, initialFiles = [], close }: { view?: FilesView; folders: LibraryFolder[]; defaultProjectId: string | null; defaultClientId: string | null; currentFolderId: string | null; initialFiles?: File[]; close: () => void }) {
  const write = useAssetWrite();
  const [client, setClient] = useState(defaultClientId ?? ""); const [selectedProject, setSelectedProject] = useState(defaultProjectId ?? ""); const [uploads, setUploads] = useState<File[]>(() => initialFiles.filter((file) => file.size > 0)); const [stageId, setStageId] = useState(""); const [dragging, setDragging] = useState(false); const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle"); const [progress, setProgress] = useState(0); const [failure, setFailure] = useState<string | null>(null); const cancelled = useRef(false);
  const projects = (view?.groups ?? []).filter((group) => !client || group.clientId === client); const availableFolders = folders.filter((folder) => !selectedProject || folder.projectId === selectedProject);
  const busy = status === "uploading"; const totalSize = uploads.reduce((sum, file) => sum + file.size, 0); const done = Math.min(uploads.length, Math.round((progress / 100) * uploads.length));
  const stage = (items: FileList | null) => setUploads((staged) => { const next = [...staged]; Array.from(items ?? []).filter((file) => file.size > 0).forEach((file) => { if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file); }); return next; });
  const removeAt = (index: number) => setUploads((staged) => staged.filter((_, position) => position !== index));
  /**
   * Uploads one file at a time, and does not close until they have all landed.
   *
   * Two things used to go wrong here, and together they are why a video could appear in
   * the grid and then be gone after a refresh. The optimistic rows were added to the store
   * *after* each `write` had already snapshotted it, so a rejected upload had nothing to
   * roll back and its row was appended anyway; and the dialog closed without awaiting any
   * of the uploads, so a rejection arrived long after the flow looked finished. A row for
   * a file the server refused survives only in memory, which is exactly why it vanishes on
   * reload.
   *
   * Now the draft goes in as the write's own `optimistic` step, its `rollback` removes
   * precisely that row, and a failure keeps the dialog open and says which file and why.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploads.length) return;
    cancelled.current = false; setStatus("uploading"); setProgress(0); setFailure(null);
    const data = new FormData(event.currentTarget), project = String(data.get("project") || selectedProject || "") || null, folder = String(data.get("folder") || currentFolderId || "") || null, projectRow = view?.groups.find((item) => item.projectId === project);
    try {
      const remaining: File[] = [];
      let failed: string | null = null;
      for (const [index, file] of uploads.entries()) {
        if (cancelled.current) { setStatus("idle"); setProgress(0); return; }
        const preview = file.type.startsWith("image/") && file.size <= 1_000_000 ? await dataUrl(file) : null;
        const draft = { id: newId("file"), fileId: null, name: file.name, kind: kindFor(file), mimeType: file.type || "application/octet-stream", size: file.size, durationMs: null, status: "PENDING" as const, versioning: { assetId: null, assetName: file.name, versionNumber: 1, versionCount: 1, isLatest: true }, url: URL.createObjectURL(file), preview, uploadedBy: "You", uploadedAt: new Date().toISOString(), folderId: folder, clientId: (projectRow?.clientId ?? client) || null, projectId: project, stageId: stageId || null } satisfies LibraryFile;

        if (!view?.workspaceId) {
          updateLibrary((state) => ({ ...state, files: [...state.files, draft] }));
        } else {
          const error = await write({
            ids: [draft.id],
            describe: `Uploading ${file.name}`,
            optimistic: (state) => ({ ...state, files: [...state.files, draft] }),
            rollback: (state) => ({ ...state, files: state.files.filter((item) => item.id !== draft.id) }),
            send: () => uploadAssetFile(view.workspaceId!, file, { client_team_id: draft.clientId, project_id: draft.projectId, folder_id: draft.folderId, task_stage_id: draft.stageId }),
            onSaved: (saved) => updateLibrary((state) => ({ ...state, files: state.files.map((item) => item.id === draft.id ? { ...draft, id: saved.id, fileId: saved.file.id, uploadedAt: saved.created_at, url: null, preview: null } : item) })),
          });
          if (error) {
            URL.revokeObjectURL(draft.url!);
            failed = failed ?? error;
            remaining.push(file);
          }
        }
        setProgress(Math.round(((index + 1) / uploads.length) * 100));
      }

      if (failed) {
        // Keep the ones that did not make it staged, so the fix is one more click.
        setUploads(remaining);
        setFailure(failed);
        setStatus("error");
        setProgress(0);
        return;
      }
      close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The upload could not be completed.");
      setStatus("error");
    }
  };
  return <Modal title="Upload files" subtitle="Stage your media, then choose where it lives." icon={<Upload />} wide close={close}>
    <form onSubmit={submit} className="al-form al-upload-form">
      <label className={`al-drop ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); stage(event.dataTransfer.files); }}>
        <span className="al-drop-orb"><Upload /></span>
        <strong>{dragging ? "Release to stage these files" : "Drop files here or browse"}</strong>
        <em>Video, audio, images, documents, source files, or anything else</em>
        <span className="al-drop-cta">Browse files</span>
        <input name="files" type="file" multiple disabled={busy} onChange={(event) => { stage(event.target.files); if (event.target.value) event.target.value = ""; }} />
      </label>
      {uploads.length > 0 && <div className="al-upload-list">
        <header><strong>{uploads.length} file{uploads.length === 1 ? "" : "s"} ready</strong><span>{formatSize(totalSize)}</span><button type="button" onClick={() => setUploads([])} disabled={busy}>Clear all</button></header>
        <ul>{uploads.map((file, index) => <li key={`${file.name}-${file.size}-${file.lastModified}`}><span className={`al-upload-chip ${kindFor(file)}`}><KindIcon kind={kindFor(file)} /></span><span className="al-upload-meta"><strong>{file.name}</strong><small>{formatSize(file.size)} · {file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : kindFor(file)}</small></span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeAt(index)} disabled={busy}><X /></button></li>)}</ul>
      </div>}
      <fieldset className="al-destination" disabled={busy}>
        <legend>Destination</legend>
        <RelationFields view={view} projects={projects} client={client} setClient={setClient} selectedProject={selectedProject} setProject={setSelectedProject} />
        <div className="al-relations"><label>Folder (optional)<select name="folder" defaultValue={currentFolderId ?? ""}><option value="">Root Files area</option>{availableFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>Stage<select name="stage" value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">No stage</option>{(view?.stages ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      </fieldset>
      {busy && <div className="al-progress" role="status" aria-live="polite"><div><span>Uploading {done} of {uploads.length}…</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>}
      {status === "error" && <p className="al-upload-error" role="alert">{failure ?? "The upload could not be completed."} The files it could not take are still staged below.</p>}
      <footer className="al-submit-row">
        <small>{uploads.length ? `${uploads.length} file${uploads.length === 1 ? "" : "s"} · ${formatSize(totalSize)}` : "No files staged yet"}</small>
        {busy ? <button type="button" className="ghost" onClick={() => { cancelled.current = true; }}>Cancel upload</button> : <><button type="button" className="ghost" onClick={close}>Cancel</button><button disabled={!uploads.length}>{status === "error" ? "Retry upload" : `Upload ${uploads.length || ""} file${uploads.length === 1 ? "" : "s"}`}</button></>}
      </footer>
    </form>
  </Modal>;
}
function RelationFields({ view, projects, client, setClient, selectedProject, setProject }: { view?: FilesView; projects: FilesView["groups"]; client: string; setClient: (id: string) => void; selectedProject: string; setProject: (id: string) => void }) { return <div className="al-relations"><label>Client (optional)<select value={client} onChange={(event) => { setClient(event.target.value); setProject(""); }}><option value="">No client</option>{view?.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Project (optional)<select name="project" value={selectedProject} onChange={(event) => setProject(event.target.value)}><option value="">No project</option>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}</select></label></div>; }
function Modal({ title, subtitle, icon, wide = false, close, children }: { title: string; subtitle?: string; icon?: React.ReactNode; wide?: boolean; close: () => void; children: React.ReactNode }) {
  const titleId = useId(); const panel = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const first = panel.current?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), select:not([disabled])"); first?.focus(); return () => previous?.focus(); }, []);
  const keys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]") ?? [])]; if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="al-modal"><button className="al-backdrop" onClick={close} aria-label="Close dialog" tabIndex={-1} /><section ref={panel} className={wide ? "wide" : undefined} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keys}><header>{icon && <span className="al-modal-icon">{icon}</span>}<div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={close} aria-label="Close dialog"><X /></button></header>{children}</section></div>;
}
function PreviewDialog({ file, close }: { file: LibraryFile; close: () => void }) { return <Modal title={file.name} close={close}><div className="al-full-preview">{file.preview ? <NextImage src={file.preview} alt={file.name} width={1200} height={800} unoptimized /> : file.url && file.kind === "video" ? <video src={file.url} controls /> : file.url && file.kind === "audio" ? <audio src={file.url} controls /> : <span className="al-full-thumb"><Thumb file={file} size="lg" /></span>}<p>{file.mimeType} · {formatSize(file.size)} · uploaded {new Date(file.uploadedAt).toLocaleString("en-GB")}</p></div></Modal>; }
/**
 * Server rows are the base. A local row is used when the base has never heard of it — a
 * create that has not landed yet — or when `localWins` says its write is still in flight.
 * `null` lets every local row win, for the offline sample library.
 */
function merge<T extends { id: string }>(base: T[], local: T[], localWins: Set<string> | null): T[] {
  const map = new Map(base.map((item) => [item.id, item]));
  local.forEach((item) => { if (!map.has(item.id) || localWins === null || localWins.has(item.id)) map.set(item.id, item); });
  return [...map.values()];
}
function upsert<T extends { id: string }>(items: T[], item: T): T[] { return items.some((candidate) => candidate.id === item.id) ? items.map((candidate) => candidate.id === item.id ? item : candidate) : [...items, item]; }
function folderTrail(folder: LibraryFolder | null, folders: LibraryFolder[]): LibraryFolder[] { const result: LibraryFolder[] = []; let item = folder; while (item) { result.unshift(item); item = folders.find((candidate) => candidate.id === item!.parentFolderId) ?? null; } return result; }
function mimeKind(mime: string, name: string): LibraryKind { return kindFor({ type: mime, name } as File); }
function dataUrl(file: File) { return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => resolve(""); reader.readAsDataURL(file); }); }
function relationLabel(entity: { clientId: string | null; projectId: string | null }, view?: FilesView) { const project = view?.groups.find((item) => item.projectId === entity.projectId); const client = view?.clients.find((item) => item.id === (entity.clientId ?? project?.clientId)); return [client?.name, project?.projectName].filter(Boolean).join(" / ") || "Unassigned"; }

/** Mirrors the server's naming so the optimistic row reads the same as the real one. */
function copyName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (copy)${name.slice(dot)}` : `${name} (copy)`;
}
