"use client";
/**
 * The stage columns. Drag and drop is @dnd-kit with a mouse sensor (6px activation, so a
 * click still opens the card) and a keyboard sensor (Space lifts, arrows move, Space/Enter
 * drops, Escape cancels). There is deliberately no touch sensor: on phones a swipe scrolls,
 * and moving is done from the card menu. Every drop calls the board's single `onMove`.
 */
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, MouseSensor, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import type { ProjectFile, Task } from "@/lib/api";
import type { BoardStage } from "@/lib/task-board";
import { CardMenu, FileCardView, FileMenu, TaskCardView, type Cover } from "./task-card";
import { QuickAdd } from "./quick-add";
import { StageDot } from "./stage-ui";

export type BoardColumn = { stage: BoardStage; tasks: Task[]; files: ProjectFile[]; total: number };
export type KanbanProps = {
  columns: BoardColumn[];
  filtersActive: boolean;
  contextOf: (task: Task) => string;
  fileContextOf: (file: ProjectFile) => string;
  coverOf: (task: Task) => Cover;
  /** Opens the task: its primary linked cut in review, else the detail sheet. */
  onOpen: (task: Task) => void;
  /** Always the detail sheet. */
  onDetails: (task: Task) => void;
  onOpenFile: (file: ProjectFile) => void;
  onMove: (task: Task, stageId: string, index: number | null, source: "drag" | "keyboard" | "menu") => void;
  onMoveFile: (file: ProjectFile, stageId: string) => void;
  onDelete: (task: Task) => void;
  onCreate: (stageId: string, title: string) => Promise<boolean>;
  quickAddStage: string | null;
  setQuickAddStage: (stageId: string | null) => void;
  menuFor: string | null;
  setMenuFor: (taskId: string | null) => void;
  /** Read-only viewers (clients, view-only roles) get no quick add, no drag and no move/delete menu. */
  canCreate?: boolean;
  canMove?: boolean;
  canDelete?: boolean;
};

const EMPTY_COPY: Record<string, string> = {
  todo: "Nothing queued", in_progress: "Nothing in production", review: "Nothing waiting for internal review",
  client_review: "No cuts with the client", revisions: "No revisions requested", approved: "Approved work lands here",
};

const taskKey = (id: string) => `task:${id}`;
const fileKey = (id: string) => `file:${id}`;
const colKey = (id: string) => `col:${id}`;

export function KanbanBoard(props: KanbanProps) {
  const { columns, onMove, onMoveFile } = props;
  const reduceMotion = useReducedMotion();
  const dndId = useId();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );

  const index = useMemo(() => {
    const tasks = new Map<string, { task: Task; column: BoardColumn; position: number }>();
    const files = new Map<string, { file: ProjectFile; column: BoardColumn }>();
    for (const column of columns) {
      column.tasks.forEach((task, position) => tasks.set(taskKey(task.id), { task, column, position }));
      column.files.forEach((file) => files.set(fileKey(file.id), { file, column }));
    }
    return { tasks, files };
  }, [columns]);

  /** Stage and position a drop on `over` means, as `applyMove` expects it. */
  function target(active: UniqueIdentifier, over: UniqueIdentifier | null): { column: BoardColumn; position: number } | null {
    if (!over) return null;
    const key = String(over);
    const from = index.tasks.get(String(active));
    if (key.startsWith("col:")) {
      const column = columns.find((item) => item.stage.id === key.slice(4));
      if (!column) return null;
      return { column, position: column.tasks.filter((task) => taskKey(task.id) !== String(active)).length };
    }
    const overTask = index.tasks.get(key);
    if (overTask) {
      const sameColumn = from?.column.stage.id === overTask.column.stage.id;
      return { column: overTask.column, position: sameColumn ? overTask.position : overTask.column.tasks.filter((task) => taskKey(task.id) !== String(active)).findIndex((task) => task.id === overTask.task.id) };
    }
    const overFile = index.files.get(key);
    if (overFile) return { column: overFile.column, position: overFile.column.tasks.filter((task) => taskKey(task.id) !== String(active)).length };
    return null;
  }

  const nameOf = (id: UniqueIdentifier) => index.tasks.get(String(id))?.task.title ?? index.files.get(String(id))?.file.file.name ?? "item";
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const at = index.tasks.get(String(active.id));
      return at ? `Picked up “${at.task.title}”. In ${at.column.stage.name}, position ${at.position + 1} of ${at.column.tasks.length}. Use the arrow keys to move, Space to drop, Escape to cancel.` : `Picked up “${nameOf(active.id)}”.`;
    },
    onDragOver: ({ active, over }) => {
      const at = over ? target(active.id, over.id) : null;
      return at ? `Over ${at.column.stage.name}, position ${at.position + 1}.` : "Not over a stage.";
    },
    onDragEnd: ({ active, over }) => {
      const at = over ? target(active.id, over.id) : null;
      return at ? `Dropped “${nameOf(active.id)}” in ${at.column.stage.name}, position ${at.position + 1}.` : `“${nameOf(active.id)}” was dropped outside the board and did not move.`;
    },
    onDragCancel: ({ active }) => {
      const at = index.tasks.get(String(active.id));
      return `Move cancelled. “${nameOf(active.id)}” returned to ${at?.column.stage.name ?? "its stage"}.`;
    },
  };

  function onDragStart(event: DragStartEvent) { setActiveId(event.active.id); }
  function onDragOver(event: DragOverEvent) { setOverId(event.over?.id ?? null); }
  function onDragEnd(event: DragEndEvent) {
    const active = event.active.id;
    const dropped = target(active, event.over?.id ?? null);
    setActiveId(null); setOverId(null);
    if (!dropped) return;
    const task = index.tasks.get(String(active));
    if (task) {
      if (task.column.stage.id === dropped.column.stage.id && task.position === dropped.position) return;
      const keyboard = event.activatorEvent instanceof globalThis.KeyboardEvent;
      onMove(task.task, dropped.column.stage.id, dropped.position, keyboard ? "keyboard" : "drag");
      return;
    }
    const file = index.files.get(String(active));
    if (file && file.column.stage.id !== dropped.column.stage.id) onMoveFile(file.file, dropped.column.stage.id);
  }

  const activeTask = activeId ? index.tasks.get(String(activeId)) : undefined;
  const activeFile = activeId ? index.files.get(String(activeId)) : undefined;
  const overTarget = activeId && overId ? target(activeId, overId) : null;

  return <DndContext
    id={dndId} sensors={sensors} collisionDetection={closestCorners}
    onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverId(null); }}
    accessibility={{ announcements, screenReaderInstructions: { draggable: "To move a task, press Space to pick it up. Use the arrow keys to move it within or between stages, then press Space to drop it or Escape to cancel. Press M for the Move to menu, Enter to open details, or 1 to 9 to send it to that stage." } }}
    autoScroll={{ threshold: { x: 0.08, y: 0.1 }, acceleration: 12 }}
  >
    <nav className="tb-stage-strip" aria-label="Jump to stage">
      {columns.map((column) => <button key={column.stage.id} type="button" onClick={() => document.getElementById(`tb-col-${column.stage.id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", inline: "start", block: "nearest" })}>
        <StageDot stage={column.stage} />{column.stage.name}<span className="tb-count">{column.tasks.length + column.files.length}</span>
      </button>)}
    </nav>
    <div className="tb-board" role="list" aria-label="Task stages">
      {columns.map((column) => <Column key={column.stage.id} column={column} {...props}
        isOver={Boolean(overTarget && overTarget.column.stage.id === column.stage.id && activeTask?.column.stage.id !== column.stage.id)}
        dropBeforeId={overTarget && overTarget.column.stage.id === column.stage.id && activeTask && activeTask.column.stage.id !== column.stage.id ? column.tasks[overTarget.position]?.id ?? null : null}
        activeId={activeId}
      />)}
    </div>
    <DragOverlay dropAnimation={reduceMotion ? null : { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" }}>
      {activeTask ? <TaskCardView overlay task={activeTask.task} stage={activeTask.column.stage} context={props.contextOf(activeTask.task)} cover={props.coverOf(activeTask.task)} done={activeTask.column.stage.isDone} />
        : activeFile ? <FileCardView overlay file={activeFile.file} stage={activeFile.column.stage} context={props.fileContextOf(activeFile.file)} onOpen={() => undefined} /> : null}
    </DragOverlay>
  </DndContext>;
}

function Column({ column, isOver, dropBeforeId, activeId, ...props }: KanbanProps & { column: BoardColumn; isOver: boolean; dropBeforeId: string | null; activeId: UniqueIdentifier | null }) {
  const { stage, tasks, files, total } = column;
  const { setNodeRef } = useDroppable({ id: colKey(stage.id) });
  const shown = tasks.length + files.length;
  const count = props.filtersActive ? `${shown} / ${total}` : String(total);
  const wip = stage.wipLimit ? tasks.length > stage.wipLimit ? "over" : tasks.length === stage.wipLimit ? "at" : "" : "";
  const guarded = stage.kind === "client_review" || stage.isDone;
  const counts = new Map(props.columns.map((item) => [item.stage.id, item.tasks.length]));
  const allStages = props.columns.map((item) => item.stage);
  const headingId = `tb-col-${stage.id}-name`;
  return <section id={`tb-col-${stage.id}`} role="listitem" aria-labelledby={headingId} className={`tb-column ${isOver ? "is-over" : ""}`}>
    <header className="tb-column-head">
      <StageDot stage={stage} />
      <h3 id={headingId}>{stage.name}</h3>
      <span className="tb-count" aria-label={props.filtersActive ? `${shown} of ${total} tasks shown` : `${total} items`}>{count}</span>
      {stage.wipLimit ? <span className={`tb-wip ${wip ? `is-${wip}` : ""}`} title={`Work-in-progress limit ${stage.wipLimit}`}>{tasks.length}/{stage.wipLimit}<span className="tb-sr"> WIP</span></span> : null}
      <span className="tb-spacer" />
      {!guarded && props.canCreate !== false && <button type="button" className="tb-icon-button" aria-label={`Add task to ${stage.name}`} onClick={() => props.setQuickAddStage(stage.id)}><Plus aria-hidden="true" /></button>}
    </header>
    <div ref={setNodeRef} className="tb-column-body">
      <SortableContext id={stage.id} items={[...tasks.map((task) => taskKey(task.id)), ...files.map((file) => fileKey(file.id))]} strategy={verticalListSortingStrategy}>
        {tasks.map((task, position) => <SortableTask key={task.id} task={task} stage={stage} position={position} size={tasks.length} counts={counts} stages={allStages} dropBefore={dropBeforeId === task.id} {...props} />)}
        {files.map((file) => <SortableFile key={file.id} file={file} stage={stage} stages={allStages} {...props} />)}
      </SortableContext>
      {!shown && <p className={`tb-column-empty ${activeId ? "is-target" : ""}`}>{props.filtersActive ? "No matches" : EMPTY_COPY[stage.kind] ?? "No tasks yet"}</p>}
      {isOver && dropBeforeId === null && shown > 0 && <span className="tb-drop-line" aria-hidden="true" />}
    </div>
    {props.canCreate !== false && <footer className="tb-column-foot">
      <QuickAdd
        stageName={stage.name} open={props.quickAddStage === stage.id}
        onOpenChange={(open) => props.setQuickAddStage(open ? stage.id : null)}
        onCreate={(title) => props.onCreate(stage.id, title)}
        disabledReason={guarded ? `Add tasks in an earlier stage, then move them to ${stage.name}.` : null}
      />
    </footer>}
  </section>;
}

function SortableTask({ task, stage, position, size, counts, stages, dropBefore, ...props }: KanbanProps & { task: Task; stage: BoardStage; position: number; size: number; counts: Map<string, number>; stages: BoardStage[]; dropBefore: boolean }) {
  const canMove = props.canMove !== false;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: taskKey(task.id), data: { type: "task", stageId: stage.id }, disabled: !canMove });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const menuOpen = props.menuFor === task.id;
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.target as Node) || event.target !== event.currentTarget) return;
    if (event.key === "Enter") { event.preventDefault(); props.onOpen(task); return; }
    if (!canMove) return;
    if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); props.setMenuFor(task.id); return; }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= stages.length && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (stages[digit - 1].id !== stage.id) props.onMove(task, stages[digit - 1].id, null, "keyboard");
      return;
    }
    listeners?.onKeyDown?.(event);
  }
  function onClick(event: MouseEvent<HTMLElement>) {
    const node = event.target as HTMLElement;
    if (!event.currentTarget.contains(node) || node.closest("[data-no-dnd]")) return;
    props.onOpen(task);
  }
  return <TaskCardView
    ref={setNodeRef} style={style} task={task} stage={stage} context={props.contextOf(task)} cover={props.coverOf(task)} done={stage.isDone}
    dragging={isDragging} dropBefore={dropBefore}
    {...attributes} {...listeners}
    role="button" aria-roledescription={canMove ? "draggable task" : "task"} aria-describedby={canMove ? attributes["aria-describedby"] : undefined}
    aria-label={`${task.title}. ${stage.name}, ${position + 1} of ${size}.`}
    onKeyDown={onKeyDown} onClick={onClick} onDetails={() => props.onDetails(task)}
    menu={canMove || props.canDelete !== false ? <CardMenu task={task} stages={stages} current={stage.id} counts={counts} open={menuOpen} onOpenChange={(open) => props.setMenuFor(open ? task.id : null)}
      onOpenDetails={() => props.onDetails(task)} onMove={canMove ? (stageId) => props.onMove(task, stageId, null, "menu") : undefined}
      onMoveEdge={(edge) => props.onMove(task, stage.id, edge === "top" ? 0 : size - 1, "menu")} canReorder={canMove && size > 1} onDelete={props.canDelete !== false ? () => props.onDelete(task) : undefined} /> : undefined}
  />;
}

function SortableFile({ file, stage, stages, ...props }: KanbanProps & { file: ProjectFile; stage: BoardStage; stages: BoardStage[] }) {
  const canMove = props.canMove !== false;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: fileKey(file.id), data: { type: "file", stageId: stage.id }, disabled: !canMove });
  return <FileCardView
    ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} file={file} stage={stage} context={props.fileContextOf(file)}
    dragging={isDragging} onOpen={() => props.onOpenFile(file)}
    {...attributes} {...listeners} aria-roledescription="draggable file" aria-label={`${file.file.name}. File in ${stage.name}.`}
    menu={canMove ? <FileMenu file={file} stages={stages} current={stage.id} onMove={(stageId) => props.onMoveFile(file, stageId)} onOpen={() => props.onOpenFile(file)} /> : undefined}
  />;
}
