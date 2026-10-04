"use client";

/**
 * The task beside the player when review was opened from a task (`?task=`): what the work
 * is, where it stands, who has it and when it is due, plus the one action people take
 * after watching the cut — moving the task on. Everything else stays in the task's detail
 * sheet, one click away through "Details".
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, Clapperboard, ListChecks, PanelRightOpen, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { TaskStage } from "@/lib/api";
import type { ReviewTaskContext } from "@/lib/review-view";
import { dueState, formatDueLong, moveGuard, stageIdOf, toBoardStages, type MoveGuard } from "@/lib/task-board";
import { reviewHref } from "@/lib/open-in-review";
import { ConfirmDialog, errorText } from "@/components/tasks/task-dialogs";
import { moveTask } from "@/components/tasks/tasks-api";

type Props = {
  context: ReviewTaskContext;
  stages: TaskStage[];
  workspaceId: string | null;
  mediaId: string;
  /** Where review's Back goes, carried onto links between this task's cuts. */
  returnTo: string | null;
  onNavigate: (href: string) => void;
};

export function TaskPanel({ context, stages: rawStages, workspaceId, mediaId, returnTo, onNavigate }: Props) {
  const stages = useMemo(() => toBoardStages(rawStages), [rawStages]);
  const [task, setTask] = useState(context.task);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ stageId: string; guard: Extract<MoveGuard, { kind: "confirm" }> } | null>(null);
  const stageId = stageIdOf(task, stages);
  const stage = stages.find((item) => item.id === stageId);
  const due = dueState(task.due_at, stage?.isDone ?? false);
  const detailsHref = `/tasks?task=${task.id}`;

  async function commit(nextStageId: string) {
    const before = task;
    setBusy(true);
    setTask({ ...task, task_stage_id: nextStageId });
    try {
      const result = await moveTask(workspaceId, task.id, nextStageId, null);
      setTask((current) => ({ ...result.task, attachment_file_ids: result.task.attachment_file_ids ?? current.attachment_file_ids }));
      const name = stages.find((item) => item.id === nextStageId)?.name ?? "the new stage";
      toast(`Moved to ${name}`, { description: task.title });
      if (result.side_effects.includes("client_notified")) toast.info("Client notified", { description: `“${task.title}” is ready for client review.` });
    } catch (error) {
      setTask(before);
      toast.error(`Couldn't move “${task.title}”`, { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }
  function request(nextStageId: string) {
    const to = stages.find((item) => item.id === nextStageId);
    if (!to || nextStageId === stageId) return;
    const guard = moveGuard(task, stage, to, { clientId: context.clientId });
    if (guard.kind === "blocked") { toast.error(`Can't move to ${to.name}`, { description: guard.reason }); return; }
    if (guard.kind === "confirm") { setPending({ stageId: nextStageId, guard }); return; }
    void commit(nextStageId);
  }

  return (
    <section className="rv-task" data-task-context aria-labelledby="rv-task-title">
      <header>
        <span className="rv-task-eyebrow"><ListChecks size={12} aria-hidden="true" />Task{context.projectName ? ` · ${context.projectName}` : ""}</span>
        <Link href={detailsHref} className="rv-task-details" data-review-leave title="Open the task's detail sheet"><PanelRightOpen size={13} aria-hidden="true" />Details</Link>
      </header>
      <h2 id="rv-task-title" title={task.title}>{task.title}</h2>
      <dl>
        <dt><label htmlFor="rv-task-stage">Stage</label></dt>
        <dd>
          <select id="rv-task-stage" value={stageId} disabled={busy || !workspaceId} onChange={(event) => request(event.target.value)}>
            {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </dd>
        <dt><UserRound size={12} aria-hidden="true" />Assignee</dt>
        <dd>{task.assignees.length ? task.assignees.map((person) => person.name).join(", ") : <span className="rv-task-muted">Unassigned</span>}</dd>
        <dt><CalendarClock size={12} aria-hidden="true" />Due</dt>
        <dd className={due === "overdue" ? "is-overdue" : undefined}>{due === "overdue" ? `Overdue · ${formatDueLong(task.due_at)}` : formatDueLong(task.due_at)}</dd>
      </dl>
      {!context.onScreenIsLinked && (
        <p className="rv-task-note" role="status"><TriangleAlert size={12} aria-hidden="true" />This cut isn&rsquo;t linked to the task.</p>
      )}
      {context.linkedFiles.length > 1 && (
        <nav className="rv-task-files" aria-label="Files linked to this task">
          {context.linkedFiles.map((file) => (
            <button key={file.fileId} type="button" aria-current={file.fileId === mediaId ? "true" : undefined}
              onClick={() => file.fileId !== mediaId && onNavigate(reviewHref({ mediaId: file.fileId, taskId: task.id, from: returnTo }))}>
              <Clapperboard size={12} aria-hidden="true" /><span>{file.title}</span><small>{file.label}</small>
            </button>
          ))}
        </nav>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.guard.dialog === "approve" ? "Approve task?" : pending?.guard.dialog === "reopen" ? "Reopen approved task?" : "Send without a cut?"}
        body={pending?.guard.message ?? ""}
        confirmLabel={pending?.guard.dialog === "approve" ? "Approve" : pending?.guard.dialog === "reopen" ? "Reopen" : "Send anyway"}
        onCancel={() => setPending(null)}
        onConfirm={() => { const move = pending; setPending(null); if (move) void commit(move.stageId); }}
      />
    </section>
  );
}
