"use client";
/**
 * Right-hand task detail sheet, deep-linked by `?task=`. Fields save as you go (title and
 * description after a short pause or on blur, selects immediately). Stage changes go
 * through the board's `requestMove`, so the same guards apply as on the board.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import NextImage from "next/image";
import { AudioLines, Clapperboard, File as FileIcon, Image as ImageIcon, Link2, Lock, Paperclip, Play, Search, Trash2, Upload, X } from "lucide-react";
import type { ProjectFile, Task, TaskAttachment } from "@/lib/api";
import type { TasksView } from "@/lib/tasks-view";
import { dueState, formatDueLong, PRIORITIES, type BoardStage } from "@/lib/task-board";
import { toDateTimeLocal } from "@/lib/task-dates";
import { StagePill } from "./stage-ui";
import { memberName } from "./task-dialogs";
import { TaskMoney } from "./task-money";

type SaveState = "idle" | "saving" | "saved" | "error";

export function TaskSheet({ task, stage, stages, view, locked, attachments, loadingAttachments, fileBySourceId, onClose, onPatch, onMove, onReopen, onDelete, onReview, onAttach, onUpload }: {
  task: Task | null; stage: BoardStage | null; stages: BoardStage[]; view: TasksView; locked: boolean;
  attachments: TaskAttachment[] | undefined; loadingAttachments: boolean; fileBySourceId: Map<string, ProjectFile>;
  onClose: () => void; onPatch: (payload: Record<string, unknown>) => Promise<boolean>; onMove: (stageId: string) => void; onReopen: () => void;
  onDelete: () => void; onReview: (fileId: string, title: string) => void; onAttach: (file: ProjectFile) => Promise<boolean>;
  /** Uploads a new file into the task's project and links it. */
  onUpload?: (file: File) => Promise<boolean>;
}) {
  return <DialogPrimitive.Root open={Boolean(task)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="tb-sheet-overlay" />
      <DialogPrimitive.Content className="tb-sheet" aria-describedby={undefined} onOpenAutoFocus={(event) => event.preventDefault()}>
        {task && stage ? <SheetBody key={task.id} task={task} stage={stage} stages={stages} view={view} locked={locked} attachments={attachments} loadingAttachments={loadingAttachments} fileBySourceId={fileBySourceId} onClose={onClose} onPatch={onPatch} onMove={onMove} onReopen={onReopen} onDelete={onDelete} onReview={onReview} onAttach={onAttach} onUpload={onUpload} />
          : <DialogPrimitive.Title className="tb-sr">Task</DialogPrimitive.Title>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

function SheetBody({ task, stage, stages, view, locked, attachments, loadingAttachments, fileBySourceId, onPatch, onMove, onReopen, onDelete, onReview, onAttach, onUpload }: Parameters<typeof TaskSheet>[0] & { task: Task; stage: BoardStage }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [save, setSave] = useState<SaveState>("idle");
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const project = task.project_id ? view.projects.find((item) => item.id === task.project_id) : null;
  const clientId = task.client_team_id ?? project?.client_team_id ?? null;
  const client = clientId ? view.clients.find((item) => item.id === clientId) : null;
  const overdue = dueState(task.due_at, stage.isDone) === "overdue";

  async function commit(payload: Record<string, unknown>) {
    setSave("saving");
    const ok = await onPatch(payload);
    setSave(ok ? "saved" : "error");
  }
  function flushText(nextTitle = title, nextDescription = description) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const payload: Record<string, unknown> = {};
    const cleanTitle = nextTitle.replace(/\s+/g, " ").trim();
    if (cleanTitle && cleanTitle !== task.title) payload.title = cleanTitle;
    if (nextDescription !== (task.description ?? "")) payload.description = nextDescription;
    if (Object.keys(payload).length) void commit(payload);
  }
  function schedule(nextTitle: string, nextDescription: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushText(nextTitle, nextDescription), 900);
  }

  return <>
    <header className="tb-sheet-head">
      <StagePill stage={stage} />
      <span className="tb-save" aria-live="polite">{save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Not saved" : ""}</span>
      <span className="tb-spacer" />
      <DialogPrimitive.Close asChild><button ref={closeRef} type="button" className="tb-icon-button" aria-label="Close task details"><X aria-hidden="true" /></button></DialogPrimitive.Close>
    </header>
    <div className="tb-sheet-scroll">
      {locked && <div className="tb-lock" role="status"><Lock aria-hidden="true" /><span><strong>Approved.</strong> Editing is locked so final work isn&apos;t changed by accident.</span><button type="button" className="tb-button is-sm" onClick={onReopen}>Reopen</button></div>}
      <DialogPrimitive.Title className="tb-sr">{task.title}</DialogPrimitive.Title>
      <textarea className="tb-sheet-title" aria-label="Task title" rows={1} value={title} disabled={locked} maxLength={255}
          onChange={(event) => { setTitle(event.target.value); schedule(event.target.value, description); }}
          onBlur={() => flushText()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); } }} />
      <p className="tb-sheet-context">{[client?.name ?? "No client", project?.name].filter(Boolean).join(" › ")}</p>

      <dl className="tb-props">
        <dt><label htmlFor="tb-sheet-stage">Stage</label></dt>
        <dd><select id="tb-sheet-stage" className="tb-input" value={stage.id} onChange={(event) => onMove(event.target.value)}>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></dd>
        <dt><label htmlFor="tb-sheet-assignee">Assignee</label></dt>
        <dd><select id="tb-sheet-assignee" className="tb-input" disabled={locked} value={task.assignees[0]?.id ?? ""} onChange={(event) => void commit({ assignee_id: event.target.value || null })}>
          <option value="">Unassigned</option>
          {view.members.filter((member) => member.user).map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}
          {task.assignees[0] && !view.members.some((member) => member.id === task.assignees[0].id) && <option value={task.assignees[0].id}>{task.assignees[0].name}</option>}
        </select></dd>
        <dt><label htmlFor="tb-sheet-priority">Priority</label></dt>
        <dd><select id="tb-sheet-priority" className="tb-input" disabled={locked} value={task.priority} onChange={(event) => void commit({ priority: event.target.value })}>
          {PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          {!PRIORITIES.some((item) => item.id === task.priority) && <option value={task.priority}>{task.priority}</option>}
        </select></dd>
        <dt><label htmlFor="tb-sheet-due">Due</label></dt>
        <dd className="tb-due-field">
          <input id="tb-sheet-due" className={`tb-input ${overdue ? "is-overdue" : ""}`} type="datetime-local" disabled={locked} value={toDateTimeLocal(task.due_at)}
            onChange={(event) => void commit({ due_at: event.target.value ? new Date(event.target.value).toISOString() : null })} aria-describedby="tb-sheet-due-note" />
          <small id="tb-sheet-due-note" className={overdue ? "is-overdue" : ""}>{overdue ? `Overdue · ${formatDueLong(task.due_at)}` : task.due_at ? formatDueLong(task.due_at) : "No due date"}</small>
        </dd>
      </dl>

      <label className="tb-field is-wide"><span>Description</span>
        <textarea className="tb-input" rows={5} value={description} disabled={locked} placeholder="Brief, notes, links…"
          onChange={(event) => { setDescription(event.target.value); schedule(title, event.target.value); }} onBlur={() => flushText()} />
      </label>

      {/* Re-keyed on stage and assignee so approval (which freezes pay) and reassignment refetch it. */}
      <TaskMoney key={`${task.task_stage_id}:${task.assignees.map((item) => item.id).join(",")}`} workspaceId={view.workspaceId} taskId={task.id} />

      <section className="tb-attachments" aria-labelledby="tb-attachments-title">
        <header><h3 id="tb-attachments-title"><Paperclip aria-hidden="true" />Attachments</h3><span className="tb-count">{attachments?.length ?? 0}</span><span className="tb-spacer" />
          {!locked && <button type="button" className="tb-button is-sm" aria-expanded={picking} onClick={() => setPicking((value) => !value)}><Link2 aria-hidden="true" />Attach from library</button>}
        </header>
        {picking && <LibraryPicker view={view} task={task} attached={new Set((attachments ?? []).map((item) => item.file.id))} onPick={async (file) => { if (await onAttach(file)) setPicking(false); }} />}
        {loadingAttachments ? <p className="tb-muted">Loading attachments…</p>
          : attachments?.length ? <ul className="tb-attachment-list">{attachments.map((attachment) => {
            const file = fileBySourceId.get(attachment.file.id);
            const kind = attachment.file.mime_type.split("/")[0];
            // Every attachment opens in review: the page resolves project cuts as well as
            // library files, and shows images, PDFs and other files in its viewer.
            const playable = kind === "video" || kind === "audio" || kind === "image";
            const poster = file?.poster ? `/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/` : null;
            return <li key={attachment.id}>
              <button type="button" onClick={() => onReview(attachment.file.id, attachment.file.name)} aria-label={`Open in review: ${attachment.file.name}`}>
                <span className="tb-attachment-thumb">{poster ? <NextImage src={poster} alt="" width={96} height={54} unoptimized /> : <KindIcon kind={kind} />}{playable && <i><Play aria-hidden="true" /></i>}</span>
                <span className="tb-attachment-copy"><strong>{attachment.file.name}</strong><small>{[file?.version_number ? `V${file.version_number}` : null, kind, formatBytes(attachment.file.size_bytes)].filter(Boolean).join(" · ")}</small></span>
              </button>
            </li>;
          })}</ul>
          : <div className="tb-link-prompt" role="note">
              <Clapperboard aria-hidden="true" />
              <div>
                <strong>Link a cut to review this task</strong>
                <p>Once a file is linked, clicking this task opens it in review with the task beside the player.</p>
                {!locked && <div className="tb-link-actions">
                  <button type="button" className="tb-button is-sm is-primary" onClick={() => setPicking(true)}><Link2 aria-hidden="true" />Attach from library</button>
                  {onUpload && <>
                    <button type="button" className="tb-button is-sm" disabled={uploading} onClick={() => uploadInput.current?.click()}><Upload aria-hidden="true" />{uploading ? "Uploading…" : "Upload a file"}</button>
                    <input ref={uploadInput} type="file" hidden aria-label="Upload a file to link" onChange={async (event) => {
                      const chosen = event.target.files?.[0]; event.target.value = "";
                      if (!chosen) return;
                      setUploading(true); await onUpload(chosen); setUploading(false);
                    }} />
                  </>}
                </div>}
              </div>
            </div>}
      </section>
    </div>
    <footer className="tb-sheet-foot">
      <span className="tb-muted">Updated {new Date(task.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      <span className="tb-spacer" />
      <button type="button" className="tb-button is-ghost is-danger-text" onClick={onDelete}><Trash2 aria-hidden="true" />Delete task</button>
    </footer>
  </>;
}

function LibraryPicker({ view, task, attached, onPick }: { view: TasksView; task: Task; attached: Set<string>; onPick: (file: ProjectFile) => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const files = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return view.files
      .filter((file) => !attached.has(file.file.id) && (!needle || file.file.name.toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.project_id === task.project_id) - Number(a.project_id === task.project_id) || a.file.name.localeCompare(b.file.name))
      .slice(0, 30);
  }, [view.files, attached, query, task.project_id]);
  return <div className="tb-picker">
    <label className="tb-search is-sm"><Search aria-hidden="true" /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the library…" aria-label="Search the library" /></label>
    {files.length ? <ul>{files.map((file) => <li key={file.id}><button type="button" onClick={() => onPick(file)}>
      <KindIcon kind={file.file.mime_type.split("/")[0]} /><span>{file.file.name}</span>
      {file.project_id && file.project_id === task.project_id && <small>This project</small>}
    </button></li>)}</ul> : <p className="tb-muted">No files match.</p>}
  </div>;
}

function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === "video" ? Clapperboard : kind === "audio" ? AudioLines : kind === "image" ? ImageIcon : FileIcon;
  return <Icon aria-hidden="true" className="tb-kind-icon" />;
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
