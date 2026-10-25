"use client";

import { ListChecks } from "@/components/icons";
import { useEffect, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { TaskStage } from "@/lib/api";
import { noteTasksApi, titleFromNote, type NoteTaskDefaults, type NoteTaskResult } from "@/lib/note-tasks";
import type { ReviewNote } from "@/lib/review-notes";
import "./note-tasks.css";

/**
 * "Make task" for one note, or "Create tasks" for several. One note: the server's prefill
 * (title from the note, a description linking back to its moment, the cut's editor as
 * assignee) is editable. Several: each task is titled from its own note and shares the
 * assignee, due date and stage chosen here.
 */
export function NoteTaskDialog({ workspaceId, notes, stages, assignees, versionLabel, onClose, onCreated }: {
  workspaceId: string; notes: Pick<ReviewNote, "id" | "text" | "timecode">[]; stages: TaskStage[]; assignees: { id: string; name: string }[];
  versionLabel: string; onClose: () => void; onCreated: (results: NoteTaskResult[]) => void;
}) {
  const single = notes.length === 1 ? notes[0] : null;
  const [prefill, setPrefill] = useState<NoteTaskDefaults | null>(null);
  const [title, setTitle] = useState(single ? titleFromNote(single.text) : "");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [due, setDue] = useState("");
  const [sync, setSync] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first note's defaults set the shared fields (assignee, stage) for a bulk create too.
  const firstId = notes[0]?.id;
  useEffect(() => {
    if (!firstId) return;
    let alive = true;
    void noteTasksApi.defaults(workspaceId, firstId).then((result) => {
      if (!alive) return;
      if (!result.ok) { setError(result.detail); return; }
      setPrefill(result.data);
      if (single) { setTitle(result.data.title); setDescription(result.data.description); }
      setAssignee(result.data.assignee_id ?? "");
      setStage(result.data.task_stage_id ?? "");
    });
    return () => { alive = false; };
  }, [firstId, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const result = await noteTasksApi.create(workspaceId, {
      comment_ids: notes.map((note) => note.id),
      ...(single ? { title: title.trim(), description } : {}),
      assignee_id: assignee || null, task_stage_id: stage || null,
      due_at: due ? new Date(`${due}T17:00:00`).toISOString() : null, sync_note_resolution: sync,
    });
    setBusy(false);
    if (!result.ok) { setError(result.detail); return; }
    onCreated(result.data.results);
  }

  const source = prefill?.source;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="ntd">
        <form onSubmit={submit}>
          <header className="ntd-head">
            <ListChecks aria-hidden="true" />
            <div>
              <DialogTitle>{single ? "Make a task from this note" : `Create ${notes.length} tasks`}</DialogTitle>
              <DialogDescription>
                {single ? `From ${versionLabel}${single.timecode ? ` at ${single.timecode}` : ""}. The task links back to the note.` : "One task per note, each titled from its note and linked back to it."}
              </DialogDescription>
            </div>
            <DialogClose />
          </header>

          {single && source && (
            <figure className="ntd-source">
              {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API poster, not an optimisable asset */}
              <img src={source.poster} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              <figcaption><b>{source.timecode ?? "Note"}</b> · v{source.version_number}<span>{source.text}</span></figcaption>
            </figure>
          )}
          {!single && (
            <ul className="ntd-list">{notes.map((note) => <li key={note.id}><b>{note.timecode || "—"}</b>{titleFromNote(note.text)}</li>)}</ul>
          )}

          {single && <label className="ntd-field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} /></label>}
          {single && <label className="ntd-field"><span>Description</span><textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label>}
          <div className="ntd-row">
            <label className="ntd-field"><span>Assignee</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="ntd-field"><span>Stage</span>
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="ntd-field"><span>Due</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <label className="ntd-check">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            <span>Finishing the task resolves the note, and resolving the note finishes the task</span>
          </label>
          {prefill?.existing && single && <p className="ntd-note" role="status">This note already has a task: {prefill.existing.title}. Creating again opens that one instead.</p>}
          {error && <p className="ntd-error" role="alert">{error}</p>}
          <footer className="ntd-foot">
            <button type="button" className="ui-button ui-button-ghost ui-button-md" onClick={onClose}>Cancel</button>
            <button type="submit" className="ui-button ui-button-primary ui-button-md" disabled={busy || (single !== null && !title.trim())}>
              {single ? "Create task" : `Create ${notes.length} tasks`}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
