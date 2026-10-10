"use client";
/** List view: the same tasks and stages as the board, grouped by stage in board order. */
import type { KeyboardEvent } from "react";
import type { Task } from "@/lib/api";
import type { BoardColumn } from "./board-kanban";
import { PanelRightOpen } from "lucide-react";
import { CardMenu } from "./task-card";
import { Avatar, DueChip, PriorityIcon, StagePill } from "./stage-ui";

export function BoardList({ columns, contextOf, onOpen, onDetails, onMove, onDelete, menuFor, setMenuFor, canMove = true, canDelete = true }: {
  columns: BoardColumn[]; contextOf: (task: Task) => string; onOpen: (task: Task) => void; onDetails: (task: Task) => void;
  onMove: (task: Task, stageId: string, index: number | null, source: "list") => void; onDelete: (task: Task) => void;
  menuFor: string | null; setMenuFor: (id: string | null) => void;
  /** Read-only viewers: no Move to menu, no 1–9 shortcuts, no Delete. */
  canMove?: boolean; canDelete?: boolean;
}) {
  const stages = columns.map((column) => column.stage);
  const counts = new Map(columns.map((column) => [column.stage.id, column.tasks.length]));
  const shown = columns.filter((column) => column.tasks.length);
  if (!shown.length) return null;
  return <div className="tb-list" role="table" aria-label="Tasks by stage">
    <div role="rowgroup" className="tb-list-head"><div role="row">
      <span role="columnheader">Task</span><span role="columnheader">Assignee</span><span role="columnheader">Priority</span><span role="columnheader">Due</span><span role="columnheader"><span className="tb-sr">Actions</span></span>
    </div></div>
    {shown.map((column) => <div role="rowgroup" key={column.stage.id} className="tb-list-group">
      <div role="row" className="tb-list-stage"><span role="rowheader" aria-colspan={5}><StagePill stage={column.stage} /><span className="tb-count">{column.tasks.length}</span></span></div>
      {column.tasks.map((task, index) => {
        const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter") { event.preventDefault(); onOpen(task); }
          if (!canMove) return;
          if (event.key.toLowerCase() === "m") { event.preventDefault(); setMenuFor(task.id); }
          const digit = Number(event.key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= stages.length && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            if (stages[digit - 1].id !== column.stage.id) onMove(task, stages[digit - 1].id, null, "list");
          }
        };
        return <div role="row" key={task.id} tabIndex={0} className={`tb-list-row ${column.stage.isDone ? "is-done" : ""}`} data-task-id={task.id} data-opens={task.attachment_file_ids?.length ? "review" : "details"} aria-label={`${task.title}, ${column.stage.name}`}
          onKeyDown={onKeyDown} onClick={(event) => { if (event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest("[data-no-dnd]")) onOpen(task); }}>
          <span role="cell" className="tb-list-title"><strong>{task.title}</strong><small>{contextOf(task) || "No client"}</small></span>
          <span role="cell" className="tb-list-person"><Avatar name={task.assignees[0]?.name} size="sm" />{task.assignees[0]?.name ?? <span className="tb-muted">Unassigned</span>}</span>
          <span role="cell"><PriorityIcon priority={task.priority} withLabel /></span>
          <span role="cell"><DueChip dueAt={task.due_at} done={column.stage.isDone} />{!task.due_at && <span className="tb-muted">—</span>}</span>
          <span role="cell" className="tb-list-actions">
            <button type="button" className="tb-icon-button" data-no-dnd aria-label={`Details for ${task.title}`} title="Details" onClick={(event) => { event.stopPropagation(); onDetails(task); }}><PanelRightOpen aria-hidden="true" /></button>
            {(canMove || canDelete) && <CardMenu task={task} stages={stages} current={column.stage.id} counts={counts} open={menuFor === task.id} onOpenChange={(open) => setMenuFor(open ? task.id : null)}
              onOpenDetails={() => onDetails(task)} onMove={canMove ? (stageId) => onMove(task, stageId, null, "list") : undefined}
              onMoveEdge={(edge) => onMove(task, column.stage.id, edge === "top" ? 0 : column.tasks.length - 1, "list")} canReorder={canMove && column.tasks.length > 1 && index >= 0} onDelete={canDelete ? () => onDelete(task) : undefined} />}
          </span>
        </div>;
      })}
    </div>)}
  </div>;
}
