"use client";
/** Modal dialogs for the Tasks board: confirmations, New task and Customize stages. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Task, TaskStage, TaskWorkflowSettings } from "@/lib/api";
import type { TasksView } from "@/lib/tasks-view";
import { DEFAULT_STAGES, PRIORITIES, toBoardStages, type BoardStage, type StageKind } from "@/lib/task-board";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { createTask, stageRequest } from "./tasks-api";
import { StagePill } from "./stage-ui";

export const memberName = (member: TasksView["members"][number]) => member.user ? `${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email : member.client_team?.name ?? "Member";
export const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";

/**
 * A yes/no question. Replaces every `confirm()` the old board used.
 *
 * `children` renders between the question and the buttons (a warning, a summary); `busy`
 * keeps the dialog open and the buttons disabled while the confirmed action runs, so a
 * double click cannot fire it twice. `cancelLabel` lets "Stay" read better than "Cancel".
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "Cancel", danger = false, busy = false, children, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean;
  children?: ReactNode; onConfirm: () => void; onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) requestAnimationFrame(() => confirmRef.current?.focus()); }, [open]);
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
    {open && <DialogContent className="tb-dialog tb-dialog-confirm">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{body}</DialogDescription>
      {children}
      <footer className="tb-dialog-foot">
        <button type="button" className="tb-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button ref={confirmRef} type="button" className={`tb-button ${danger ? "is-danger" : "is-primary"}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </footer>
    </DialogContent>}
  </Dialog>;
}

/** Full create form. New tasks can't start in Client Review or the done stage: they are moved there. */
export function NewTaskDialog({ open, view, stages, defaultProjectId, defaultStageId, onClose, onCreated }: {
  open: boolean; view: TasksView; stages: BoardStage[]; defaultProjectId: string | null; defaultStageId: string | null; onClose: () => void; onCreated: (task: Task) => void;
}) {
  const initialClient = view.projects.find((project) => project.id === defaultProjectId)?.client_team_id ?? "";
  const [client, setClient] = useState(initialClient);
  const [project, setProject] = useState(defaultProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startable = stages.filter((stage) => stage.kind !== "client_review" && !stage.isDone);
  const projects = view.projects.filter((item) => !client || item.client_team_id === client);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const chosen = view.projects.find((item) => item.id === project);
    setBusy(true); setError("");
    try {
      const task = await createTask(view.workspaceId, {
        title: String(data.get("title")).trim(), description: String(data.get("description") ?? ""),
        client_team_id: (chosen?.client_team_id ?? client) || null, project_id: project || null,
        assignee_id: String(data.get("assignee") || "") || null, priority: String(data.get("priority")),
        task_stage_id: String(data.get("stage")), due_at: data.get("due") ? new Date(String(data.get("due"))).toISOString() : null,
      });
      onCreated(task);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    {open && <DialogContent className="tb-dialog">
      <form onSubmit={submit} className="tb-form">
        <header className="tb-dialog-head"><DialogTitle>New task</DialogTitle><DialogDescription>Add a piece of production work to the board.</DialogDescription><DialogClose /></header>
        <label className="tb-field is-wide"><span>Title</span><input name="title" required autoFocus maxLength={255} /></label>
        <label className="tb-field is-wide"><span>Description</span><textarea name="description" rows={3} /></label>
        <label className="tb-field"><span>Client</span><select value={client} onChange={(event) => { setClient(event.target.value); setProject(""); }}><option value="">No client</option>{view.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="tb-field"><span>Project</span><select value={project} onChange={(event) => { setProject(event.target.value); const match = view.projects.find((item) => item.id === event.target.value); if (match?.client_team_id) setClient(match.client_team_id); }}><option value="">No project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="tb-field"><span>Stage</span><select name="stage" defaultValue={startable.some((stage) => stage.id === defaultStageId) ? defaultStageId! : startable[0]?.id}>{startable.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label className="tb-field"><span>Assignee</span><select name="assignee" defaultValue=""><option value="">Unassigned</option>{view.members.filter((member) => member.user).map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}</select></label>
        <label className="tb-field"><span>Priority</span><select name="priority" defaultValue="MEDIUM">{PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="tb-field"><span>Due</span><input name="due" type="datetime-local" /></label>
        {error && <p className="tb-error is-wide" role="alert">{error}</p>}
        <footer className="tb-dialog-foot is-wide">
          <button type="button" className="tb-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="tb-button is-primary" disabled={busy}>{busy ? "Creating…" : "Create task"}</button>
        </footer>
      </form>
    </DialogContent>}
  </Dialog>;
}

type StageDraft = TaskStage & { isNew?: boolean; replacement?: string };

/** Customize stages: order, names, colours, WIP limits, the done stage and automation. */
export function StageDialog({ open, view, onClose }: { open: boolean; view: TasksView; onClose: () => void }) {
  const [rows, setRows] = useState<StageDraft[]>(() => withKinds(view.stages));
  const [removed, setRemoved] = useState<{ stage: TaskStage; replacement: string | null }[]>([]);
  const [settings, setSettings] = useState<TaskWorkflowSettings>(view.workflowSettings);
  const [pendingDelete, setPendingDelete] = useState<StageDraft | null>(null);
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<StageDraft>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  function shift(index: number, by: -1 | 1) {
    setRows((current) => { const next = [...current]; const [row] = next.splice(index, 1); next.splice(index + by, 0, row); return next; });
  }
  function add() {
    setRows((current) => [...current, { id: `new-${crypto.randomUUID()}`, name: "New stage", color: "#8b8b99", sort_order: current.length, wip_limit: null, is_done: false, automation_enabled: false, task_count: 0, kind: "custom", isNew: true }]);
  }
  function askRemove(row: StageDraft) {
    if (rows.length === 1) { setError("A workflow needs at least one stage."); return; }
    if (!row.task_count) { drop(row, null); return; }
    setPendingDelete(row); setReplacement(rows.find((item) => item.id !== row.id)?.id ?? "");
  }
  function drop(row: StageDraft, target: string | null) {
    setRows((current) => current.filter((item) => item.id !== row.id));
    if (!row.isNew) setRemoved((current) => [...current, { stage: row, replacement: target }]);
    setPendingDelete(null); setError("");
  }
  function reset() {
    setRows((current) => {
      const next = [...current];
      DEFAULT_STAGES.forEach((stage, index) => {
        const patch = { name: stage.name, color: stage.color, kind: stage.kind, is_done: stage.isDone, wip_limit: null };
        if (next[index]) next[index] = { ...next[index], ...patch };
        else next.push({ id: `new-${crypto.randomUUID()}`, sort_order: index, automation_enabled: true, task_count: 0, isNew: true, ...patch });
      });
      return next.map((row, index) => index >= DEFAULT_STAGES.length && row.is_done ? { ...row, is_done: false } : row);
    });
    setError("");
  }
  async function save() {
    if (rows.some((row) => !row.name.trim())) { setError("Every stage needs a name."); return; }
    if (rows.filter((row) => row.is_done).length !== 1) { setError("Mark exactly one stage as the done stage."); return; }
    setBusy(true); setError("");
    try {
      const created = new Map<string, string>();
      for (const [index, row] of rows.entries()) {
        const payload = { name: row.name.trim(), color: row.color, sort_order: index, wip_limit: row.wip_limit, is_done: row.is_done, automation_enabled: row.automation_enabled, kind: row.kind ?? "custom" };
        if (row.isNew) created.set(row.id, (await stageRequest<TaskStage>(view.workspaceId, "", "POST", payload)).id);
        else await stageRequest(view.workspaceId, `${row.id}/`, "PATCH", payload);
      }
      for (const item of removed) await stageRequest(view.workspaceId, `${item.stage.id}/`, "DELETE", { replacement_stage_id: item.replacement ? created.get(item.replacement) ?? item.replacement : null });
      await stageRequest(view.workspaceId, "settings/", "PATCH", settings);
      window.location.reload();
    } catch (reason) { setError(errorText(reason)); setBusy(false); }
  }
  const preview = toBoardStages(rows.map((row, index) => ({ ...row, sort_order: index })));

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    {open && <DialogContent className="tb-dialog is-wide">
      <header className="tb-dialog-head"><DialogTitle>Customize stages</DialogTitle><DialogDescription>Columns run left to right. Built-in stages keep their meaning when renamed.</DialogDescription><DialogClose /></header>
      <ol className="tb-stage-rows">
        {rows.map((row, index) => <li key={row.id} className="tb-stage-row">
          <span className="tb-stage-order">
            <button type="button" className="tb-icon-button" aria-label={`Move ${row.name} earlier`} disabled={index === 0} onClick={() => shift(index, -1)}><ArrowUp aria-hidden="true" /></button>
            <button type="button" className="tb-icon-button" aria-label={`Move ${row.name} later`} disabled={index === rows.length - 1} onClick={() => shift(index, 1)}><ArrowDown aria-hidden="true" /></button>
          </span>
          {(row.kind ?? "custom") === "custom"
            ? <input type="color" aria-label={`Colour for ${row.name}`} value={row.color} onChange={(event) => update(row.id, { color: event.target.value })} />
            : <span className="tb-stage-kind" title="Built-in stage colour"><StagePill stage={preview[index]} /></span>}
          <input className="tb-input" aria-label="Stage name" value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} maxLength={80} />
          <span className="tb-muted">{row.task_count} task{row.task_count === 1 ? "" : "s"}</span>
          <label className="tb-inline"><span>WIP</span><input className="tb-input is-num" type="number" min={1} placeholder="∞" aria-label={`WIP limit for ${row.name}`} value={row.wip_limit ?? ""} onChange={(event) => update(row.id, { wip_limit: event.target.value ? Number(event.target.value) : null })} /></label>
          <label className="tb-inline"><input type="radio" name="tb-done-stage" checked={row.is_done} onChange={() => setRows((current) => current.map((item) => ({ ...item, is_done: item.id === row.id })))} />Done</label>
          <label className="tb-inline" title="Run this stage's automation (the client hand-off for Client Review)"><input type="checkbox" checked={row.automation_enabled} onChange={(event) => update(row.id, { automation_enabled: event.target.checked })} />Auto</label>
          <button type="button" className="tb-icon-button" aria-label={`Delete ${row.name}`} onClick={() => askRemove(row)}><Trash2 aria-hidden="true" /></button>
        </li>)}
      </ol>
      {pendingDelete && <div className="tb-callout" role="group" aria-label={`Delete ${pendingDelete.name}`}>
        <p>{pendingDelete.task_count} task{pendingDelete.task_count === 1 ? "" : "s"} in {pendingDelete.name} will move to:</p>
        <select className="tb-input" aria-label="Replacement stage" value={replacement} onChange={(event) => setReplacement(event.target.value)}>{rows.filter((row) => row.id !== pendingDelete.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <button type="button" className="tb-button" onClick={() => setPendingDelete(null)}>Keep stage</button>
        <button type="button" className="tb-button is-danger" onClick={() => drop(pendingDelete, replacement)}>Delete stage</button>
      </div>}
      <button type="button" className="tb-button is-ghost" onClick={add}><Plus aria-hidden="true" />Add stage</button>
      <section className="tb-guardrails" aria-label="Automation and guardrails">
        <Toggle label="WIP limit warning" detail="Warn when a move puts a column over its limit." checked={settings.wip_warning} onChange={(value) => setSettings((current) => ({ ...current, wip_warning: value }))} />
        <Toggle label="Notify the client on Client Review" detail="Email client contacts when a task enters Client Review." checked={settings.auto_notify_client} onChange={(value) => setSettings((current) => ({ ...current, auto_notify_client: value }))} />
        <Toggle label="Lock approved tasks" detail="Approved work can't be edited until it is reopened." checked={settings.lock_done_editing} onChange={(value) => setSettings((current) => ({ ...current, lock_done_editing: value }))} />
      </section>
      {error && <p className="tb-error" role="alert">{error}</p>}
      <footer className="tb-dialog-foot">
        <button type="button" className="tb-button is-ghost" onClick={reset}><RotateCcw aria-hidden="true" />Reset to the six defaults</button>
        <span className="tb-spacer" />
        <button type="button" className="tb-button" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-button is-primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save stages"}</button>
      </footer>
    </DialogContent>}
  </Dialog>;
}

function withKinds(stages: TaskStage[]): StageDraft[] {
  const kinds = new Map(toBoardStages(stages).map((stage) => [stage.id, stage.kind as StageKind]));
  return [...stages].sort((a, b) => a.sort_order - b.sort_order).map((stage) => ({ ...stage, kind: kinds.get(stage.id) ?? stage.kind ?? "custom" }));
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="tb-toggle"><span><strong>{label}</strong><small>{detail}</small></span><Switch label={label} checked={checked} onCheckedChange={onChange} /></div>;
}
