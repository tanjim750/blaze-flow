"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { Archive, AudioLines, ChevronRight, Clapperboard, Download, Ellipsis, File, FileImage, FileText, Film, FolderPlus, Grid2X2, Image as ImageIcon, Info, List, ListFilter, Move, Pencil, Play, RotateCcw, Search, Tag, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import type { FilesView } from "@/lib/files-view";
import { applyLibraryStage, demoLibrary, markPending, replaceLibrary, snapshotLibrary, assignFolderTree, assignLibraryEntities, deleteLibraryEntities, descendantFolderIds, kindFor, newId, stageFileIds, updateLibrary, useAssetLibrary, type LibraryFile, type LibraryFolder, type LibraryKind, type LibraryState } from "@/lib/asset-library";
import { createAssetFolder, deleteAssetFile, deleteAssetFolder, updateAssetFile, updateAssetFolder, uploadAssetFile } from "@/lib/asset-api-client";
import { TextRoll } from "@/components/ui/skiper-ui/skiper58";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

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
export function AssetLibrary({ view, projectId = null, projectName, clientId = null, compact = false }: Props) {
  const router = useRouter();
  const [writeError, setWriteError] = useState<string | null>(null);
  const write = useAssetWrite(() => router.refresh(), setWriteError);
  const stored = useAssetLibrary(); const [folderId, setFolderId] = useState<string | null>(null); const [query, setQuery] = useState(""); const [searchEverywhere, setSearchEverywhere] = useState(false); const [dialog, setDialog] = useState<"folder" | "upload" | null>(null); const [preview, setPreview] = useState<LibraryFile | null>(null); const [details, setDetails] = useState<LibraryFile | LibraryFolder | null>(null); const [selected, setSelected] = useState<Set<string>>(new Set()); const [clientFilter, setClientFilter] = useState(""); const [projectFilter, setProjectFilter] = useState(""); const [kindFilter, setKindFilter] = useState<LibraryKind | "">(""); const [stageFilter, setStageFilter] = useState(""); const [sort, setSort] = useState<"newest" | "name" | "size">("newest"); const [dense, setDense] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false); const [renamingId, setRenamingId] = useState<string | null>(null);
  const stages = view?.stages ?? [];
  const serverFolders: LibraryFolder[] = (view?.folders ?? []).map((folder) => ({ id: folder.id, name: folder.name, clientId: folder.client_team_id, projectId: folder.project_id, parentFolderId: folder.parent_folder_id, createdAt: folder.created_at, createdBy: "Workspace member" }));
  const serverFiles: LibraryFile[] = (view?.files ?? []).map((item) => ({ id: item.id, fileId: item.file.id, name: item.file.name, kind: mimeKind(item.file.mime_type, item.file.name), mimeType: item.file.mime_type, size: item.file.size_bytes, url: view?.workspaceId && item.file.status === "READY" ? `/api/workspaces/${view.workspaceId}/asset-files/${item.id}/download/` : null, preview: view?.workspaceId && item.file.status === "READY" && item.file.mime_type.startsWith("image/") ? `/api/workspaces/${view.workspaceId}/asset-files/${item.id}/download/` : null, uploadedBy: "Workspace member", uploadedAt: item.created_at, folderId: item.folder_id, clientId: item.client_team_id, projectId: item.project_id, stageId: item.task_stage_id }));
  // With no workspace there is no server to be authoritative, so the sample library stands
  // in and every local edit applies. Connected, a local row may only override a server row
  // while its write is still in flight; everything else defers to the server.
  const offline = !view?.workspaceId;
  const localWins = offline ? null : new Set(stored.pending ?? []);
  const folders = merge(offline ? demoLibrary.folders : serverFolders, stored.folders, localWins).filter((item) => !stored.deletedIds.includes(item.id) && (!projectId || item.projectId === projectId));
  const files = merge(offline ? demoLibrary.files : serverFiles, stored.files, localWins).filter((item) => !stored.deletedIds.includes(item.id) && (!projectId || item.projectId === projectId));
  const current = folders.find((item) => item.id === folderId) ?? null; const recursiveSearch = searchEverywhere && Boolean(query.trim()); const filteredProjects = (view?.groups ?? []).filter((group) => !clientFilter || group.clientId === clientFilter); const scopeFolders = sortFolders(folders.filter((item) => (recursiveSearch || item.parentFolderId === folderId) && matches(item.name, query) && matchesRelation(item, clientFilter, projectFilter)), sort); const scopeFiles = sortFiles(files.filter((item) => (recursiveSearch || item.folderId === folderId) && matches(item.name, query) && matchesRelation(item, clientFilter, projectFilter) && (!kindFilter || item.kind === kindFilter) && (!stageFilter || item.stageId === stageFilter)), sort);
  const crumbs = folderTrail(current, folders);
  // Drives the count on the filter button, so a narrowed list is never a silent surprise.
  const activeFilters = [clientFilter, projectFilter, kindFilter, stageFilter].filter(Boolean).length
    + (searchEverywhere ? 1 : 0) + (sort === "newest" ? 0 : 1);
  const resetFilters = () => {
    setClientFilter(""); setProjectFilter(""); setKindFilter(""); setStageFilter("");
    setSort("newest"); setSearchEverywhere(false);
  };
  const toggleSelected = (id: string) => setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const deleteSelected = () => {
    if (!selected.size || !confirm(`Delete ${selected.size} selected item${selected.size === 1 ? "" : "s"}?`)) return;
    const ids = [...selected];
    if (view?.workspaceId) {
      write({ ids, optimistic: (state) => deleteLibraryEntities(state, selected), describe: `Deleting ${ids.length} item${ids.length === 1 ? "" : "s"}`,
        send: () => Promise.all(ids.map((id) => files.some((item) => item.id === id) ? deleteAssetFile(view.workspaceId!, id) : deleteAssetFolder(view.workspaceId!, id))) });
    } else {
      updateLibrary((state) => deleteLibraryEntities(state, selected));
    }
    setSelected(new Set());
  };
  const visibleIds = [...scopeFolders, ...scopeFiles].map((item) => item.id); const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAllVisible = () => setSelected((value) => { const next = new Set(value); visibleIds.forEach((id) => allVisibleSelected ? next.delete(id) : next.add(id)); return next; });
  useEffect(() => { const shortcuts = (event: KeyboardEvent) => { const target = event.target; if ((target instanceof Element && target.matches("input, select, textarea, [contenteditable=true]")) || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key.toLowerCase() === "u") { event.preventDefault(); setDialog("upload"); } if (event.key.toLowerCase() === "n") { event.preventDefault(); setDialog("folder"); } }; window.addEventListener("keydown", shortcuts); return () => window.removeEventListener("keydown", shortcuts); }, []);
  return <RefreshContext.Provider value={() => router.refresh()}><ReportContext.Provider value={setWriteError}><div className={compact ? "asset-library compact" : "asset-library"}>
    <div className="al-head">
      <div>{!compact && <><p className="eyebrow">Central asset library</p><h1><TextRoll>Files</TextRoll></h1><p>Creative files, folders, clients, and projects—connected in one place.</p></>}</div>
      <div className="al-actions">
        <label className="al-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this location…" /></label>
        <div className="al-view-toggle"><button className={!dense ? "active" : ""} onClick={() => setDense(false)} aria-label="Card view" aria-pressed={!dense}><Grid2X2 /></button><button className={dense ? "active" : ""} onClick={() => setDense(true)} aria-label="List view" aria-pressed={dense}><List /></button></div>
        <FilterMenu
          view={view} groups={filteredProjects} stages={stages} showRelations={!projectId} activeCount={activeFilters}
          searchEverywhere={searchEverywhere} setSearchEverywhere={setSearchEverywhere}
          clientFilter={clientFilter} setClientFilter={setClientFilter}
          projectFilter={projectFilter} setProjectFilter={setProjectFilter}
          kindFilter={kindFilter} setKindFilter={setKindFilter}
          stageFilter={stageFilter} setStageFilter={setStageFilter}
          sort={sort} setSort={setSort} onReset={resetFilters}
        />
        <Button variant="secondary" size={compact ? "sm" : "md"} onClick={() => setDialog("folder")}><FolderPlus />New folder</Button>
        <Button variant="primary" size={compact ? "sm" : "md"} onClick={() => setDialog("upload")}><Upload />Upload</Button>
      </div>
    </div>
    <div className="al-toolbar"><nav><button onClick={() => setFolderId(null)}>{projectName || "All Files"}</button>{crumbs.map((folder) => <span key={folder.id}><ChevronRight /><button onClick={() => setFolderId(folder.id)}>{folder.name}</button></span>)}</nav></div>
    {visibleIds.length > 0 && <div className="al-selection-row"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />Select all visible</label><span>Shortcuts: N new folder · U upload</span></div>}
    {selected.size > 0 && <div className="al-bulk" role="status" aria-live="polite"><strong>{selected.size} selected</strong><button onClick={() => setSelected(new Set())}>Clear</button><button onClick={() => setBulkOpen(true)}><Move />Move / assign</button><button className="danger" onClick={deleteSelected}><Trash2 />Delete</button></div>}
    {writeError && <p className="al-write-error" role="alert"><TriangleAlert />{writeError}<button onClick={() => setWriteError(null)} aria-label="Dismiss error"><X /></button></p>}
    {recursiveSearch && <p className="al-results-note">Showing matches from every folder in {projectName || "Files"}.</p>}
    <section className="al-section"><header><h2>Items</h2><span>{scopeFolders.length + scopeFiles.length}</span></header><div className={`al-grid ${dense ? "dense" : ""}`}>{scopeFolders.map((folder) => <FolderCard key={folder.id} folder={folder} files={files.filter((file) => file.folderId === folder.id)} folders={folders} view={view} selected={selected.has(folder.id)} renaming={renamingId === folder.id} onSelect={() => toggleSelected(folder.id)} onDetails={() => setDetails(folder)} onOpen={() => setFolderId(folder.id)} onRename={() => setRenamingId(folder.id)} onRenameDone={() => setRenamingId(null)} />)}{scopeFiles.map((file) => <FileCard key={file.id} file={file} view={view} folders={folders} selected={selected.has(file.id)} renaming={renamingId === file.id} onSelect={() => toggleSelected(file.id)} onDetails={() => setDetails(file)} onPreview={() => setPreview(file)} onRename={() => setRenamingId(file.id)} onRenameDone={() => setRenamingId(null)} />)}{!scopeFiles.length && !scopeFolders.length && <div className="al-empty"><Archive /><strong>This location is empty</strong><span>Upload standalone files or organize them in a folder.</span><button onClick={() => setDialog("upload")}>Upload files</button></div>}</div></section>
    {dialog === "folder" && <FolderDialog view={view} folders={folders} defaultProjectId={projectId} defaultClientId={clientId} parentFolderId={folderId} close={() => setDialog(null)} />}
    {dialog === "upload" && <UploadDialog view={view} folders={folders} defaultProjectId={projectId} defaultClientId={clientId} currentFolderId={folderId} close={() => setDialog(null)} />}
    {preview && <PreviewDialog file={preview} close={() => setPreview(null)} />}
    {details && <DetailsDialog entity={details} view={view} close={() => setDetails(null)} />}
    {bulkOpen && <BulkAssignmentDialog view={view} folders={folders} selected={selected} close={() => setBulkOpen(false)} done={() => { setBulkOpen(false); setSelected(new Set()); }} />}
  </div></ReportContext.Provider></RefreshContext.Provider>;
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
function FilterField({ label, value, placeholder, options, onChange, clearable = true }: {
  label: string; value: string; placeholder: string; clearable?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="al-filter-field">
      <span>{label}</span>
      <select aria-label={`Filter by ${label.toLowerCase()}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {clearable && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function FolderCard({ folder, files, folders, view, selected, renaming, onSelect, onDetails, onOpen, onRename, onRenameDone }: { folder: LibraryFolder; files: LibraryFile[]; folders: LibraryFolder[]; view?: FilesView; selected: boolean; renaming: boolean; onSelect: () => void; onDetails: () => void; onOpen: () => void; onRename: () => void; onRenameDone: () => void }) {
  const meta = `${files.length + folders.filter((item) => item.parentFolderId === folder.id).length} items · ${relationLabel(folder, view)}`;
  return <article className={`al-folder-card ${selected ? "selected" : ""}`}>
    <label className="al-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${folder.name}`} /></label>
    <button className="al-folder-preview" onClick={onOpen}>{[...files.slice(0, 4), ...Array(Math.max(0, 4 - files.length)).fill(null)].map((file, index) => <Preview key={file?.id ?? index} file={file} />)}</button>
    <footer>
      {renaming
        ? <div className="al-name-edit"><RenameField entity={folder} isFile={false} view={view} done={onRenameDone} /><small>{meta}</small></div>
        : <button onClick={onOpen}><strong>{folder.name}</strong><small>{meta}</small></button>}
      <ContextMenu entity={folder} folders={folders} folderFiles={files} view={view} onOpen={onOpen} onDetails={onDetails} onRename={onRename} />
    </footer>
  </article>;
}
function FileCard({ file, folders, view, selected, renaming, onSelect, onDetails, onPreview, onRename, onRenameDone }: { file: LibraryFile; folders: LibraryFolder[]; view?: FilesView; selected: boolean; renaming: boolean; onSelect: () => void; onDetails: () => void; onPreview: () => void; onRename: () => void; onRenameDone: () => void }) {
  const router = useRouter();
  const review = reviewHref(file);
  return <article className={`al-file-card ${selected ? "selected" : ""}`}>
    <label className="al-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${file.name}`} /></label>
    <button className="al-file-preview" onClick={() => review ? router.push(review) : onPreview()} aria-label={review ? `Open review for ${file.name}` : `Preview ${file.name}`}>
      <Preview file={file} large />
      <i>{review ? <Clapperboard /> : <Play />}</i>
    </button>
    <div>
      <KindIcon kind={file.kind} />
      <span>
        {renaming ? <RenameField entity={file} isFile view={view} done={onRenameDone} /> : <strong>{file.name}</strong>}
        <small>{formatSize(file.size)} · {relationLabel(file, view)}</small>
        <StageChip stageId={file.stageId} view={view} />
      </span>
      <ContextMenu entity={file} folders={folders} view={view} onPreview={onPreview} onDetails={onDetails} onRename={onRename} />
    </div>
  </article>;
}

/** Renames in place. The browser's `prompt()` this replaced sat outside the page entirely. */
function RenameField({ entity, isFile, view, done }: { entity: LibraryFile | LibraryFolder; isFile: boolean; view?: FilesView; done: () => void }) {
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
    className="al-rename-input"
    value={value}
    autoFocus
    aria-label={`Rename ${entity.name}`}
    onChange={(event) => setValue(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { event.preventDefault(); done(); } }}
    onClick={(event) => event.stopPropagation()}
  />;
}
function Preview({ file, large = false }: { file: LibraryFile | null; large?: boolean }) { if (!file) return <span className="al-preview-blank" />; if (file.preview) return <span className="al-preview-image" style={{ backgroundImage: `url(${file.preview})` }} />; if (file.kind === "video" && file.url) return <span className="al-preview-video"><video src={file.url} muted preload="metadata" /></span>; const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : null; return <span className={`al-kind-preview ${file.kind} ${large ? "large" : ""}`}><KindIcon kind={file.kind} />{file.kind === "audio" && <i><b /><b /><b /><b /><b /><b /><b /></i>}{["document", "source", "other"].includes(file.kind) && extension && <em>{extension}</em>}</span>; }
function StageChip({ stageId, view }: { stageId: string | null; view?: FilesView }) {
  const stage = view?.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  // The colour is the workspace's own, so the chip matches its column on the Tasks board.
  return <em className="al-stage" style={{ borderColor: `${stage.color}59`, background: `${stage.color}24`, color: stage.color }}>{stage.name}</em>;
}
function KindIcon({ kind }: { kind: LibraryKind }) { const Icon = kind === "video" ? Film : kind === "audio" ? AudioLines : kind === "image" ? ImageIcon : kind === "document" ? FileText : kind === "source" ? FileImage : File; return <Icon />; }

function ContextMenu({ entity, folders, folderFiles = [], view, onPreview, onOpen, onDetails, onRename }: { entity: LibraryFile | LibraryFolder; folders: LibraryFolder[]; folderFiles?: LibraryFile[]; view?: FilesView; onPreview?: () => void; onOpen?: () => void; onDetails?: () => void; onRename?: () => void }) { const isFile = "kind" in entity; const router = useRouter(); const write = useAssetWrite(); const mutate = (action: string) => { if (action === "preview") return onPreview?.(); if (action === "open") return onOpen?.(); if (action === "details") return onDetails?.(); if (action === "rename") return onRename?.(); if (action === "download" && isFile && entity.url) { window.location.assign(entity.url); return; } if (action === "download-folder" && !isFile) { const blob = new Blob([folderFiles.map((file) => `${file.name}\t${file.mimeType}\t${file.size}`).join("\n")], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${entity.name}-manifest.txt`; link.click(); URL.revokeObjectURL(link.href); return; } if (action === "delete") { if (!confirm(`Delete ${entity.name}?`)) return; const remove = (state: LibraryState) => deleteLibraryEntities(state, new Set([entity.id])); if (view?.workspaceId) write({ ids: [entity.id], optimistic: remove, describe: `Deleting ${entity.name}`, send: (): Promise<unknown> => isFile ? deleteAssetFile(view.workspaceId!, entity.id) : deleteAssetFolder(view.workspaceId!, entity.id) }); else updateLibrary(remove); return; } };
  const review = isFile ? reviewHref(entity as LibraryFile) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="al-menu-trigger" aria-label={`Actions for ${entity.name}`}><Ellipsis /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="al-menu-content">
        {!isFile && <DropdownMenuItem onSelect={() => mutate("open")}>Open</DropdownMenuItem>}
        {review && <DropdownMenuItem onSelect={() => router.push(review)}><Clapperboard />Open review</DropdownMenuItem>}
        {isFile && <DropdownMenuItem onSelect={() => mutate("preview")}>Preview</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => mutate("details")}><Info />Details</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => mutate("rename")}><Pencil />Rename</DropdownMenuItem>
        <AssignmentMenu entity={entity} folders={folders} view={view} />
        {isFile && <StageMenu file={entity as LibraryFile} view={view} />}
        {isFile && entity.url && <DropdownMenuItem onSelect={() => mutate("download")}><Download />Download</DropdownMenuItem>}
        {!isFile && <DropdownMenuItem onSelect={() => mutate("download-folder")}><Download />Download manifest</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => mutate("delete")}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  return <Modal title={`Move / assign ${selected.size} items`} close={close}><form className="al-form" onSubmit={submit}><RelationFields view={view} projects={projects} client={client} setClient={setClient} selectedProject={project} setProject={setProject} /><label>Destination folder<select name="folder" defaultValue=""><option value="">Project or Files root</option>{destinations.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>Stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="">Leave unchanged</option>{(view?.stages ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button>Apply to {selected.size} items</button></form></Modal>;
}

function FolderDialog({ view, folders, defaultProjectId, defaultClientId, parentFolderId, close }: { view?: FilesView; folders: LibraryFolder[]; defaultProjectId: string | null; defaultClientId: string | null; parentFolderId: string | null; close: () => void }) { const write = useAssetWrite(); const [client, setClient] = useState(defaultClientId ?? ""); const [selectedProject, setSelectedProject] = useState(defaultProjectId ?? ""); const projects = (view?.groups ?? []).filter((group) => !client || group.clientId === client); const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget), project = String(data.get("project") || selectedProject || "") || null; const projectRow = view?.groups.find((item) => item.projectId === project); const draft = { id: newId("folder"), name: String(data.get("name")), clientId: (projectRow?.clientId ?? client) || null, projectId: project, parentFolderId, createdAt: new Date().toISOString(), createdBy: "You" }; const add = (state: LibraryState) => ({ ...state, folders: [...state.folders, draft] });
    if (view?.workspaceId) {
      write({ ids: [draft.id], optimistic: add, describe: `Creating ${draft.name}`,
        send: () => createAssetFolder(view.workspaceId!, { name: draft.name, client_team_id: draft.clientId, project_id: draft.projectId, parent_folder_id: draft.parentFolderId }),
        onSaved: (saved) => updateLibrary((state) => ({ ...state, folders: state.folders.map((item) => item.id === draft.id ? { ...draft, id: saved.id, createdAt: saved.created_at } : item) })) });
    } else { updateLibrary(add); }
    close(); }; return <Modal title="Create folder" close={close}><form onSubmit={submit} className="al-form"><label>Folder name<input name="name" required autoFocus placeholder="Footage" /></label><RelationFields view={view} projects={projects} client={client} setClient={setClient} selectedProject={selectedProject} setProject={setSelectedProject} /><label>Inside folder<select name="parent" value={parentFolderId ?? ""} disabled><option value="">Root Files area</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><button>Create folder</button></form></Modal>; }
function UploadDialog({ view, folders, defaultProjectId, defaultClientId, currentFolderId, close }: { view?: FilesView; folders: LibraryFolder[]; defaultProjectId: string | null; defaultClientId: string | null; currentFolderId: string | null; close: () => void }) {
  const write = useAssetWrite();
  const [client, setClient] = useState(defaultClientId ?? ""); const [selectedProject, setSelectedProject] = useState(defaultProjectId ?? ""); const [uploads, setUploads] = useState<File[]>([]); const [stageId, setStageId] = useState(""); const [dragging, setDragging] = useState(false); const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle"); const [progress, setProgress] = useState(0); const [failure, setFailure] = useState<string | null>(null); const cancelled = useRef(false);
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
        const draft = { id: newId("file"), fileId: null, name: file.name, kind: kindFor(file), mimeType: file.type || "application/octet-stream", size: file.size, url: URL.createObjectURL(file), preview, uploadedBy: "You", uploadedAt: new Date().toISOString(), folderId: folder, clientId: (projectRow?.clientId ?? client) || null, projectId: project, stageId: stageId || null } satisfies LibraryFile;

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
function PreviewDialog({ file, close }: { file: LibraryFile; close: () => void }) { return <Modal title={file.name} close={close}><div className="al-full-preview">{file.preview ? <NextImage src={file.preview} alt={file.name} width={1200} height={800} unoptimized /> : file.url && file.kind === "video" ? <video src={file.url} controls /> : file.url && file.kind === "audio" ? <audio src={file.url} controls /> : <Preview file={file} large />}<p>{file.mimeType} · {formatSize(file.size)} · uploaded {new Date(file.uploadedAt).toLocaleString()}</p></div></Modal>; }
function DetailsDialog({ entity, view, close }: { entity: LibraryFile | LibraryFolder; view?: FilesView; close: () => void }) { const isFile = "kind" in entity; const rows = isFile ? [["Type", entity.kind], ["Format", entity.mimeType], ["Size", formatSize(entity.size)], ["Uploaded by", entity.uploadedBy], ["Uploaded", new Date(entity.uploadedAt).toLocaleString()], ["Stage", view?.stages.find((item) => item.id === entity.stageId)?.name ?? "No stage"], ["Relationship", relationLabel(entity, view)]] : [["Type", "Folder"], ["Created by", entity.createdBy], ["Created", new Date(entity.createdAt).toLocaleString()], ["Relationship", relationLabel(entity, view)]]; return <Modal title="Asset details" close={close}><div className="al-details"><div><KindIcon kind={isFile ? entity.kind : "other"} /><h3>{entity.name}</h3></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div></Modal>; }
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
const matches = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());
const matchesRelation = (entity: { clientId: string | null; projectId: string | null }, client: string, project: string) => (!client || entity.clientId === client) && (!project || entity.projectId === project);
function sortFolders(items: LibraryFolder[], sort: "newest" | "name" | "size") { return [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)); }
function sortFiles(items: LibraryFile[], sort: "newest" | "name" | "size") { return [...items].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : b.uploadedAt.localeCompare(a.uploadedAt)); }
const formatSize = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
function mimeKind(mime: string, name: string): LibraryKind { return kindFor({ type: mime, name } as File); }
function dataUrl(file: File) { return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => resolve(""); reader.readAsDataURL(file); }); }
function relationLabel(entity: { clientId: string | null; projectId: string | null }, view?: FilesView) { const project = view?.groups.find((item) => item.projectId === entity.projectId); const client = view?.clients.find((item) => item.id === (entity.clientId ?? project?.clientId)); return [client?.name, project?.projectName].filter(Boolean).join(" / ") || "Unassigned"; }
