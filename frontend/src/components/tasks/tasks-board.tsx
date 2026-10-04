"use client";
/**
 * Blaze Flow Tasks: a stage-based production board.
 *
 * One task collection feeds the board, the list and the detail sheet, and every way of
 * moving a task (drag, keyboard, card menu, list menu, detail sheet) goes through
 * `requestMove`: guard → confirm when needed → optimistic update → `POST tasks/<id>/move/`
 * → reconcile, with an 8-second Undo toast and a Retry toast on failure.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Columns3, LayoutList, Plus, Settings2, TriangleAlert, X } from "lucide-react";
import type { ProjectFile, Task, TaskAttachment } from "@/lib/api";
import type { TasksView } from "@/lib/tasks-view";
import { updateAssetFile, uploadAssetFile } from "@/lib/asset-api-client";
import { openUniversalReview } from "@/components/universal-review";
import { reviewHref, taskOpenTarget, type LinkedCandidate } from "@/lib/open-in-review";
import {
  activeFilterCount, applyMove, dueState, EMPTY_FILTERS, groupByStage, matchTask, moveGuard, parseFilters, positionOf, stageIdOf, toBoardStages, writeFilters,
  type BoardStage, type FilterContext, type MoveGuard, type TaskFilters,
} from "@/lib/task-board";
import { KanbanBoard, type BoardColumn } from "./board-kanban";
import { BoardList } from "./board-list";
import { FilterBar } from "./filter-bar";
import { coverFor } from "./task-card";
import { ConfirmDialog, errorText, NewTaskDialog, StageDialog } from "./task-dialogs";
import { TaskSheet } from "./task-sheet";
import { createTask, deleteTask, linkAttachment, listAttachments, moveTask, patchTask, type MoveResult } from "./tasks-api";

type MoveSource = "drag" | "keyboard" | "menu" | "list" | "sheet";
type PendingMove = { task: Task; stageId: string; index: number | null; guard: Extract<MoveGuard, { kind: "confirm" }> };

export type TasksBoardProps = {
  view: TasksView;
  projectId?: string | null;
  compact?: boolean;
  /** The page's query string (without `?`), so filters and `?task=` survive a reload. */
  initialQuery?: string;
  /** Mirror filters and the open task into the URL. Only the /tasks page does this. */
  syncUrl?: boolean;
};

export function TasksBoard({ view, projectId = null, compact = false, initialQuery = "", syncUrl = false }: TasksBoardProps) {
  const stages = useMemo(() => toBoardStages(view.stages), [view.stages]);
  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const [tasks, setTasks] = useState(view.tasks);
  const [files, setFiles] = useState(view.files);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<TaskFilters>(() => initialQuery ? parseFilters(new URLSearchParams(initialQuery)) : EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => new URLSearchParams(initialQuery).get("task"));
  const [attachments, setAttachments] = useState<Record<string, TaskAttachment[]>>({});
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [dialog, setDialog] = useState<"new" | "stages" | null>(null);
  const [quickAddStage, setQuickAddStage] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const tasksRef = useRef(tasks);
  useLayoutEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const commitRef = useRef<(taskId: string, stageId: string, index: number | null, options?: { undo?: boolean }) => void>(() => undefined);
  const sequence = useRef(new Map<string, number>());
  const searchRef = useRef<HTMLInputElement>(null);

  const projectMap = useMemo(() => new Map(view.projects.map((project) => [project.id, project])), [view.projects]);
  const clientMap = useMemo(() => new Map(view.clients.map((client) => [client.id, client.name])), [view.clients]);
  const fileBySourceId = useMemo(() => new Map(files.map((file) => [file.file.id, file])), [files]);
  const clientOf = useCallback((task: Pick<Task, "client_team_id" | "project_id">) => task.client_team_id ?? (task.project_id ? projectMap.get(task.project_id)?.client_team_id ?? null : null), [projectMap]);
  const stageOf = useCallback((task: Task) => stageById.get(stageIdOf(task, stages)) ?? stages[0], [stageById, stages]);
  const contextOf = useCallback((task: Pick<Task, "client_team_id" | "project_id">) => {
    const client = clientOf(task);
    return [client ? clientMap.get(client) : null, task.project_id ? projectMap.get(task.project_id)?.name : null].filter(Boolean).join(" › ");
  }, [clientMap, clientOf, projectMap]);

  // --- URL sync ------------------------------------------------------------------------
  useEffect(() => {
    if (!syncUrl) return;
    const params = writeFilters(filters, new URLSearchParams(window.location.search));
    if (openTaskId) params.set("task", openTaskId); else params.delete("task");
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [filters, openTaskId, syncUrl]);

  // --- What is shown -------------------------------------------------------------------
  const scoped = useMemo(() => projectId ? tasks.filter((task) => task.project_id === projectId) : tasks, [projectId, tasks]);
  const scopedFiles = useMemo(() => files.filter((file) => file.task_stage_id && stageById.has(file.task_stage_id) && (!projectId || file.project_id === projectId)), [files, projectId, stageById]);
  const filterContext: FilterContext = useMemo(() => ({
    clientOf, isDone: (task) => stageOf(task)?.isDone ?? false,
    projectName: (task) => task.project_id ? projectMap.get(task.project_id)?.name ?? "" : "",
    clientName: (task) => clientMap.get(clientOf(task) ?? "") ?? "",
  }), [clientMap, clientOf, projectMap, stageOf]);
  const filterCount = activeFilterCount(filters);
  const visibleTasks = useMemo(() => filterCount ? scoped.filter((task) => matchTask(task, filters, filterContext)) : scoped, [filterContext, filterCount, filters, scoped]);
  const visibleFiles = useMemo(() => {
    if (!filterCount) return scopedFiles;
    // Files have no assignee, priority or due date, so those filters hide them.
    if (filters.assignee.length || filters.priority.length || filters.due) return [];
    const needle = filters.q.trim().toLowerCase();
    return scopedFiles.filter((file) => (!needle || file.file.name.toLowerCase().includes(needle)) && (!filters.client.length || filters.client.includes(file.client_team_id ?? "")) && (!filters.project.length || filters.project.includes(file.project_id ?? "")));
  }, [filterCount, filters, scopedFiles]);
  const columns: BoardColumn[] = useMemo(() => {
    const shown = groupByStage(visibleTasks, stages);
    const all = groupByStage(scoped, stages);
    return stages.map((stage) => {
      const stageFiles = scopedFiles.filter((file) => file.task_stage_id === stage.id);
      return { stage, tasks: shown.get(stage.id) ?? [], files: visibleFiles.filter((file) => file.task_stage_id === stage.id), total: (all.get(stage.id)?.length ?? 0) + stageFiles.length };
    });
  }, [scoped, scopedFiles, stages, visibleFiles, visibleTasks]);
  const coverOf = useCallback((task: Task) => coverFor(task, fileBySourceId), [fileBySourceId]);
  const overdueCount = scoped.filter((task) => dueState(task.due_at, stageOf(task)?.isDone ?? false) === "overdue").length;

  // --- Moves ---------------------------------------------------------------------------
  const commitMove = useCallback((taskId: string, stageId: string, index: number | null, options: { undo?: boolean } = {}) => {
    const before = tasksRef.current;
    const task = before.find((item) => item.id === taskId);
    const to = stageById.get(stageId);
    if (!task || !to) return;
    const from = positionOf(before, taskId, stages);
    const next = applyMove(before, taskId, stageId, index, stages);
    const at = positionOf(next, taskId, stages);
    if (from.stageId === stageId && from.index === at.index) return;
    tasksRef.current = next;
    setTasks(next);
    const changedStage = from.stageId !== stageId;
    setLive(changedStage ? `Moved “${task.title}” to ${to.name}.` : `Moved “${task.title}” to position ${at.index + 1} in ${to.name}.`);
    if (changedStage && to.wipLimit && view.workflowSettings.wip_warning) {
      const count = next.filter((item) => stageIdOf(item, stages) === stageId && (!projectId || item.project_id === projectId)).length;
      if (count > to.wipLimit) toast.warning(`${to.name} is over its WIP limit`, { description: `${count} tasks against a limit of ${to.wipLimit}.` });
    }
    const affected = new Set(before.filter((item) => [from.stageId, stageId].includes(stageIdOf(item, stages))).map((item) => item.id));
    const seq = (sequence.current.get(taskId) ?? 0) + 1;
    sequence.current.set(taskId, seq);
    moveTask(view.workspaceId, taskId, stageId, at.index).then((result: MoveResult) => {
      if (sequence.current.get(taskId) !== seq) return;
      const order = new Map(result.order.map((row) => [row.id, row.sort_order]));
      setTasks((current) => current.map((item) => item.id === taskId ? { ...result.task, sort_order: order.get(taskId) ?? result.task.sort_order } : order.has(item.id) ? { ...item, sort_order: order.get(item.id)! } : item));
      if (result.side_effects.includes("client_notified")) toast.info("Client notified", { description: `“${task.title}” is ready for client review.` });
    }).catch((error: unknown) => {
      if (sequence.current.get(taskId) !== seq) return;
      const previous = new Map(before.filter((item) => affected.has(item.id)).map((item) => [item.id, item]));
      setTasks((current) => current.map((item) => previous.get(item.id) ?? item));
      toast.error(`Couldn't move “${task.title}”`, { description: errorText(error), duration: 10000, action: { label: "Retry", onClick: () => commitRef.current(taskId, stageId, index, options) } });
    });
    if (changedStage && options.undo !== false) {
      toast(`Moved to ${to.name}`, { description: task.title, duration: 8000, action: { label: "Undo", onClick: () => commitRef.current(taskId, from.stageId, from.index, { undo: false }) } });
    }
  }, [projectId, stageById, stages, view.workflowSettings.wip_warning, view.workspaceId]);
  useEffect(() => { commitRef.current = commitMove; }, [commitMove]);

  const requestMove = useCallback((task: Task, stageId: string, index: number | null, source: MoveSource) => {
    void source;
    const from = stageOf(task);
    const to = stageById.get(stageId);
    if (!to) return;
    const guard = moveGuard(task, from, to, { clientId: clientOf(task) });
    if (guard.kind === "blocked") { toast.error(`Can't move to ${to.name}`, { description: guard.reason }); setLive(guard.reason); return; }
    if (guard.kind === "confirm") { setPendingMove({ task, stageId, index, guard }); return; }
    commitMove(task.id, stageId, index);
  }, [clientOf, commitMove, stageById, stageOf]);

  async function moveFile(file: ProjectFile, stageId: string) {
    const previous = file.task_stage_id;
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, task_stage_id: stageId } : item));
    try { await updateAssetFile(view.workspaceId!, file.id, { task_stage_id: stageId }); setLive(`Moved ${file.file.name} to ${stageById.get(stageId)?.name}.`); }
    catch (error) {
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, task_stage_id: previous } : item));
      toast.error(`Couldn't move ${file.file.name}`, { description: errorText(error) });
    }
  }

  // --- Create, edit, delete ------------------------------------------------------------
  async function quickCreate(stageId: string, title: string): Promise<boolean> {
    const project = projectId ? projectMap.get(projectId) : null;
    try {
      const task = await createTask(view.workspaceId, { title, task_stage_id: stageId, priority: "MEDIUM", project_id: projectId, client_team_id: project?.client_team_id ?? null });
      setTasks((current) => [...current, task]);
      setLive(`Added “${task.title}” to ${stageById.get(stageId)?.name}.`);
      return true;
    } catch (error) { toast.error("Couldn't add the task", { description: errorText(error) }); return false; }
  }
  async function patch(taskId: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const saved = await patchTask(view.workspaceId, taskId, payload);
      setTasks((current) => current.map((item) => item.id === taskId ? { ...saved, attachment_file_ids: saved.attachment_file_ids ?? item.attachment_file_ids } : item));
      return true;
    } catch (error) { toast.error("Couldn't save the change", { description: errorText(error) }); return false; }
  }
  async function confirmDelete(task: Task) {
    setPendingDelete(null);
    if (openTaskId === task.id) setOpenTaskId(null);
    const before = tasksRef.current;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try { await deleteTask(view.workspaceId, task.id); toast(`Deleted “${task.title}”`); }
    catch (error) { setTasks(before); toast.error(`Couldn't delete “${task.title}”`, { description: errorText(error) }); }
  }

  // --- Detail sheet --------------------------------------------------------------------
  const openTask = openTaskId ? tasks.find((task) => task.id === openTaskId) ?? null : null;
  const openStage = openTask ? stageOf(openTask) : null;
  useEffect(() => {
    if (!openTaskId || !view.workspaceId || !tasks.some((task) => task.id === openTaskId) || Object.hasOwn(attachments, openTaskId)) return;
    let alive = true;
    listAttachments(view.workspaceId, openTaskId)
      .then((rows) => { if (alive) setAttachments((current) => ({ ...current, [openTaskId]: rows })); })
      .catch((error: unknown) => { if (alive) { setAttachments((current) => ({ ...current, [openTaskId]: [] })); toast.error("Couldn't load attachments", { description: errorText(error) }); } });
    return () => { alive = false; };
  }, [attachments, openTaskId, tasks, view.workspaceId]);
  async function attach(task: Task, file: ProjectFile): Promise<boolean> {
    try {
      const row = await linkAttachment(view.workspaceId, task.id, file.file.id);
      setAttachments((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), row] }));
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, attachment_file_ids: [...(item.attachment_file_ids ?? []), file.file.id] } : item));
      toast.success(`Attached ${file.file.name}`);
      return true;
    } catch (error) { toast.error("Couldn't attach the file", { description: errorText(error) }); return false; }
  }
  async function uploadAndAttach(task: Task, file: File): Promise<boolean> {
    if (!view.workspaceId) return false;
    try {
      const uploaded = await uploadAssetFile(view.workspaceId, file, { client_team_id: clientOf(task), project_id: task.project_id, folder_id: null });
      setFiles((current) => [...current, uploaded]);
      return await attach(task, uploaded);
    } catch (error) { toast.error(`Couldn't upload ${file.name}`, { description: errorText(error) }); return false; }
  }
  /** A file card on the board, or an attachment in the sheet (then with its task beside it). */
  function review(fileId: string, title: string, taskId: string | null = null) {
    setOpenTaskId(null);
    openUniversalReview({ href: reviewHref({ mediaId: fileId, taskId }), title });
  }
  const knownFile = useCallback((fileId: string): LinkedCandidate | null => {
    const file = fileBySourceId.get(fileId);
    return file ? { fileId, mimeType: file.file.mime_type, versionNumber: file.version_number } : null;
  }, [fileBySourceId]);
  /**
   * Clicking a task opens what it is about: its primary linked cut in review, with the task
   * panel beside the player. A task with nothing linked opens the detail sheet, which asks
   * for a cut. The sheet is always one click away through the card's Details button and
   * the ⋯ menu.
   */
  const activate = useCallback((task: Task) => {
    const target = taskOpenTarget(task, knownFile, null);
    if (target.kind === "review") openUniversalReview({ href: target.href, title: task.title });
    else setOpenTaskId(task.id);
  }, [knownFile]);
  const reopenTarget = stages.find((stage) => stage.kind === "revisions") ?? stages.find((stage) => !stage.isDone);

  // --- Shortcuts -----------------------------------------------------------------------
  const firstOpenStage = stages.find((stage) => stage.kind !== "client_review" && !stage.isDone);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]"))) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key.toLowerCase() === "n" && firstOpenStage) { event.preventDefault(); setMode("board"); setQuickAddStage(firstOpenStage.id); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [firstOpenStage]);

  const hasAnything = visibleTasks.length + visibleFiles.length > 0;
  const clear = () => setFilters(EMPTY_FILTERS);
  const empty = mode === "list" ? !visibleTasks.length : filterCount > 0 && !hasAnything;

  return <div className={`tb-root ${compact ? "is-compact" : ""}`}>
    {view.notice && <p className="tb-notice" role="status"><TriangleAlert aria-hidden="true" />{view.notice}</p>}
    <header className="tb-head">
      <div className="tb-title">
        {compact ? <h2>Project tasks</h2> : <h1>Tasks</h1>}
        <p className="tb-muted">{scoped.length} task{scoped.length === 1 ? "" : "s"}{scopedFiles.length ? ` · ${scopedFiles.length} file${scopedFiles.length === 1 ? "" : "s"}` : ""}{overdueCount ? <> · <span className="tb-overdue-text">{overdueCount} overdue</span></> : null}</p>
      </div>
      <span className="tb-spacer" />
      <div className="tb-segmented" role="group" aria-label="View">
        <button type="button" aria-pressed={mode === "board"} onClick={() => setMode("board")}><Columns3 aria-hidden="true" />Board</button>
        <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}><LayoutList aria-hidden="true" />List</button>
      </div>
      {!compact && <button type="button" className="tb-button is-ghost" aria-label="Customize stages" onClick={() => setDialog("stages")}><Settings2 aria-hidden="true" /><span className="tb-label-md">Customize stages</span></button>}
      <button type="button" className="tb-button is-primary" onClick={() => setDialog("new")}><Plus aria-hidden="true" />New task</button>
    </header>

    <FilterBar
      filters={filters} setFilters={setFilters} searchRef={searchRef} compact={Boolean(projectId)}
      tasks={scoped} view={view} clientOf={clientOf}
    />

    {mode === "board"
      ? <KanbanBoard
          columns={columns} filtersActive={filterCount > 0} contextOf={contextOf} fileContextOf={(file) => contextOf({ client_team_id: file.client_team_id, project_id: file.project_id })}
          coverOf={coverOf} onOpen={activate} onDetails={(task) => setOpenTaskId(task.id)} onOpenFile={(file) => review(file.file.id, file.file.name)}
          onMove={requestMove} onMoveFile={(file, stageId) => void moveFile(file, stageId)} onDelete={setPendingDelete}
          onCreate={quickCreate} quickAddStage={quickAddStage} setQuickAddStage={setQuickAddStage} menuFor={menuFor} setMenuFor={setMenuFor}
        />
      : <BoardList columns={columns} contextOf={contextOf} onOpen={activate} onDetails={(task) => setOpenTaskId(task.id)} onMove={requestMove} onDelete={setPendingDelete} menuFor={menuFor} setMenuFor={setMenuFor} />}

    {empty && <div className="tb-empty" role="status">
      <strong>{filterCount ? "No matching tasks" : "No tasks yet"}</strong>
      <span>{filterCount ? "Nothing matches the current search and filters." : "Create the first piece of work with New task."}</span>
      {filterCount > 0 && <button type="button" className="tb-button" onClick={clear}><X aria-hidden="true" />Clear search and filters</button>}
    </div>}

    <p className="tb-sr" aria-live="polite" aria-atomic="true">{live}</p>

    <TaskSheet
      task={openTask} stage={openStage} stages={stages} view={view}
      locked={Boolean(openStage?.isDone && view.workflowSettings.lock_done_editing)}
      attachments={openTask ? attachments[openTask.id] : undefined} loadingAttachments={Boolean(openTask && !Object.hasOwn(attachments, openTask.id))} fileBySourceId={fileBySourceId}
      onClose={() => setOpenTaskId(null)}
      onPatch={(payload) => openTask ? patch(openTask.id, payload) : Promise.resolve(false)}
      onMove={(stageId) => openTask && requestMove(openTask, stageId, null, "sheet")}
      onReopen={() => openTask && reopenTarget && requestMove(openTask, reopenTarget.id, null, "sheet")}
      onDelete={() => openTask && setPendingDelete(openTask)}
      onReview={(fileId, title) => review(fileId, title, openTask?.id ?? null)}
      onAttach={(file) => openTask ? attach(openTask, file) : Promise.resolve(false)}
      onUpload={(file) => openTask ? uploadAndAttach(openTask, file) : Promise.resolve(false)}
    />

    <ConfirmDialog
      open={Boolean(pendingMove)}
      title={pendingMove?.guard.dialog === "approve" ? "Approve task?" : pendingMove?.guard.dialog === "reopen" ? "Reopen approved task?" : `Send to ${stageById.get(pendingMove?.stageId ?? "")?.name ?? "client"} without a cut?`}
      body={pendingMove?.guard.message ?? ""}
      confirmLabel={pendingMove?.guard.dialog === "approve" ? "Approve" : pendingMove?.guard.dialog === "reopen" ? "Reopen" : "Send anyway"}
      onCancel={() => { setPendingMove(null); setLive("Move cancelled."); }}
      onConfirm={() => { const move = pendingMove; setPendingMove(null); if (move) commitMove(move.task.id, move.stageId, move.index); }}
    />
    <ConfirmDialog
      open={Boolean(pendingDelete)} danger title="Delete task?" confirmLabel="Delete task"
      body={pendingDelete ? `“${pendingDelete.title}” will be deleted for everyone in the workspace. This can't be undone.` : ""}
      onCancel={() => setPendingDelete(null)} onConfirm={() => pendingDelete && void confirmDelete(pendingDelete)}
    />
    {dialog === "new" && <NewTaskDialog open view={view} stages={stages} defaultProjectId={projectId} defaultStageId={null} onClose={() => setDialog(null)}
      onCreated={(task) => { setTasks((current) => [...current, task]); setDialog(null); toast.success(`Created “${task.title}”`); }} />}
    {dialog === "stages" && <StageDialog open view={view} onClose={() => setDialog(null)} />}
  </div>;
}

export type { BoardStage };
