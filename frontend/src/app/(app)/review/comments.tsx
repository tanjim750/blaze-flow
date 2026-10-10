"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, AtSign, CornerDownRight, Eye, Lock, MessageSquareText, Paperclip, Pencil, PencilLine, Repeat, RotateCcw, Search, Send, SmilePlus, Timer, Trash2, Users, X } from "lucide-react";
import {
  DEFAULT_HOLD, HOLD_PRESETS_MS, displayWindow, drawingEndMs, holdLabel, noteEndMs, parseTime, rangeLabel, rememberHold, validChoice, type HoldChoice,
} from "@/lib/annotation-window";
import type { ReviewNote } from "@/lib/review-notes";
import { clientView, recordingOf, type NoteDrawing } from "@/lib/review-notes";
import { DEFAULT_FILTER, activeFilters, filterCounts, filterNotes, isMine, type FilterContext, type NoteFilter, type NoteSide, type NoteStatus } from "@/lib/review-filters";
import { DEFAULT_RANGE_MS, rangeOut, type MarkRange } from "@/lib/review-range";
import type { Mentionable, ReviewView } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import type { AnnotationElement, CommentVisibility } from "@/lib/api";
import { clearDraft, loadDraft, patchDraft } from "@/lib/review-drafts";
import { Recorder } from "./recorder";
import type { RecordedClip, ReviewWriter } from "./writer";

const noop = () => undefined;

/** What the composer holds that is not yet posted, reported up for the leave guard. */
export type ComposerState = { text: boolean; recording: boolean; startMs: number | null };

type Props = {
  view: ReviewView;
  writer: ReviewWriter;
  /** Writes against the comparison cut, so its notes resolve and react on the right version. */
  compareWriter: ReviewWriter;
  notes: ReviewNote[];
  positionMs: number;
  focusedId: string | null;
  pendingAnnotation: AnnotationElement | null;
  onClearAnnotation: () => void;
  /** How long the pending drawing stays on screen once posted. */
  hold?: HoldChoice;
  onHold?: (choice: HoldChoice) => void;
  /** The media's length, so a hold or out point never runs past the end. 0 while unknown. */
  durationMs?: number;
  /** Notes whose drawing or range covers the playhead right now. */
  liveNoteIds?: Set<string>;
  onSeek: (ms: number) => void;
  /** Seeks the compare pane showing `versionId`, since the single player is not mounted. */
  onCompareSeek: (versionId: string, ms: number) => void;
  /** Whether this user may write team-only notes: workspace teammates, not client members. */
  canWriteTeam: boolean;
  /** "See what the client sees": team notes are already filtered out of `notes`. */
  clientPreview: boolean;
  hiddenTeamNotes: number;
  onClientPreview: (on: boolean) => void;
  onComposerChange: (state: ComposerState) => void;
  /** False for stills and documents: there is no timeline, so the copy stops talking about moments. */
  timed?: boolean;
  /** The signed-in user, for "Mine" and for who may edit or delete a note. */
  viewerId?: string | null;
  /** In/out points the next note will cover (I/O keys, timeline drag or the Range button). */
  mark?: MarkRange | null;
  onMark?: (range: MarkRange | null) => void;
  /** Seeks to a range note and plays it on repeat until Esc. */
  onPlayRange?: (startMs: number, endMs: number) => void;
  /** Puts a drawing back on the frame when an optimistic post fails. */
  onRestoreAnnotation?: (annotation: AnnotationElement) => void;
};

/** What a note row needs beyond the note itself; shared by the feed and the compare feeds. */
type RowContext = {
  viewerId: string | null;
  durationMs: number;
  onPlayRange?: (startMs: number, endMs: number) => void;
};

/**
 * Which versions' notes to show while comparing.
 *
 * Two lists under two headings rather than one merged feed: the reason to compare is to see
 * what was said about which cut, and a single list would destroy exactly that.
 */
function CompareFeeds({ view, writer, compareWriter, clientPreview, onSeek, row }: {
  view: ReviewView; writer: ReviewWriter; compareWriter: ReviewWriter; clientPreview: boolean;
  onSeek: (versionId: string, ms: number) => void; row: RowContext;
}) {
  const comparison = view.comparison!;
  const current = view.version!;
  const [showing, setShowing] = useState<Record<string, boolean>>({ [current.id]: true, [comparison.version.id]: true });
  const visible = (notes: ReviewNote[], side: ReviewWriter) => {
    const shown = side.apply ? side.apply(notes) : notes;
    return clientPreview ? clientView(shown) : shown;
  };
  // Each side resolves and reacts through a writer bound to its own cut; the current
  // writer would address the other version's notes on the wrong media version.
  const sides = [
    { version: current, notes: visible(view.notes, writer), writer },
    { version: comparison.version, notes: visible(comparison.notes, compareWriter), writer: compareWriter },
  ];

  return (
    <div className="rvc">
      <header className="rvc-head">
        <h2><MessageSquareText size={15} />Comments</h2>
      </header>
      <div className="rvc-toggles">
        {sides.map(({ version, notes }) => (
          <label key={version.id}>
            <input
              type="checkbox"
              checked={showing[version.id] ?? true}
              onChange={(event) => setShowing((current) => ({ ...current, [version.id]: event.target.checked }))}
            />
            {version.label}<small>{notes.length}</small>
          </label>
        ))}
      </div>
      <div className="rvc-feed">
        {sides.map(({ version, notes, writer: sideWriter }) => (showing[version.id] ?? true) && (
          <section key={version.id} className="rvc-side">
            <h3>{version.label}</h3>
            {notes.length === 0
              ? <p className="rvc-empty">No comments on {version.label}.</p>
              : notes.map((note) => (
                  // No Reply while comparing: there is no composer here to reply with.
                  <Note
                    key={note.id} note={note} view={view} target={version.target} writer={sideWriter} focused={false}
                    onSeek={(ms) => onSeek(version.id, ms)} row={{ ...row, onPlayRange: undefined }}
                  />
                ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function Comments({
  view, writer, compareWriter, notes, positionMs, focusedId, pendingAnnotation, onClearAnnotation, hold = DEFAULT_HOLD, onHold = noop, durationMs = 0, liveNoteIds,
  onSeek, onCompareSeek, canWriteTeam, clientPreview, hiddenTeamNotes, onClientPreview, onComposerChange, timed = true,
  viewerId = null, mark = null, onMark, onPlayRange, onRestoreAnnotation,
}: Props) {
  const [replyTo, setReplyTo] = useState<ReviewNote | null>(null);
  const [filter, setFilter] = useState<NoteFilter>(DEFAULT_FILTER);
  const feed = useRef<HTMLDivElement>(null);
  const row: RowContext = { viewerId, durationMs, onPlayRange };
  // A project cut the viewer can read but not comment on (a read-only role): show that,
  // instead of a composer whose every send would be refused.
  const viewOnly = Boolean(view.target) && !view.canComment;

  const open = notes.filter((note) => !note.resolved).length;
  const context: FilterContext = useMemo(() => ({ viewerId, teamIds: new Set(view.members.map((member) => member.id)) }), [view.members, viewerId]);
  const counts = useMemo(() => filterCounts(notes, filter, context), [context, filter, notes]);
  const ordered = useMemo(
    () => filterNotes(notes, filter, context).sort((a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER)),
    [context, filter, notes],
  );
  const filtering = activeFilters(filter) > 0;
  // "Client" and "Team" only mean something on a project cut whose members are known.
  const sides = Boolean(view.target) && view.members.length > 0;

  // Clicking a marker on the timeline should bring its note into view, not just seek.
  useEffect(() => {
    if (!focusedId) return;
    feed.current?.querySelector(`[data-note="${focusedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedId]);

  // Comparing is a reading mode: two labelled feeds, and no composer, because a note
  // written here would have to guess which cut it was about. Branching after the hooks
  // above so this component calls the same ones on every render.
  const previewToggle = view.target && canWriteTeam && (
    <button
      type="button"
      className={`rvc-preview ${clientPreview ? "is-on" : ""}`}
      aria-pressed={clientPreview}
      onClick={() => onClientPreview(!clientPreview)}
      title="Show only the notes a client or guest reviewer can see"
    >
      <Eye size={12} />{clientPreview ? "Client view on" : "See what the client sees"}
    </button>
  );

  if (view.comparison) {
    return (
      <>
        {previewToggle && <div className="rvc-preview-bar">{previewToggle}</div>}
        <CompareFeeds view={view} writer={writer} compareWriter={compareWriter} clientPreview={clientPreview} onSeek={onCompareSeek} row={row} />
      </>
    );
  }

  return (
    <div className="rvc">
      {previewToggle && (
        <div className="rvc-preview-bar">
          {previewToggle}
          {clientPreview && (
            <span role="status">
              {hiddenTeamNotes ? `${hiddenTeamNotes} team ${hiddenTeamNotes === 1 ? "note" : "notes"} hidden` : "No team notes on this cut"}
            </span>
          )}
        </div>
      )}
      <header className="rvc-head">
        <h2><MessageSquareText size={15} />Comments</h2>
        <div>
          <span>{notes.length ? `${open} open · ${notes.length - open} resolved` : "None yet"}</span>
        </div>
      </header>

      {notes.length > 0 && (
        <FilterBar filter={filter} onChange={setFilter} counts={counts} sides={sides} filtering={filtering} />
      )}

      <div className="rvc-feed" ref={feed}>
        {notes.length === 0 && (
          <p className="rvc-empty">
            {timed ? "No comments on this cut yet. Scrub to a moment and leave the first note." : "No comments on this file yet. Leave the first note."}
          </p>
        )}
        {notes.length > 0 && ordered.length === 0 && (
          <div className="rvc-empty" role="status">
            <p>No comments match {filter.query.trim() ? <>&ldquo;{filter.query.trim()}&rdquo;</> : "these filters"}.</p>
            <button type="button" className="rvc-clear" onClick={() => setFilter(DEFAULT_FILTER)}>Clear filters</button>
          </div>
        )}
        {ordered.map((note) => (
          <Note
            timed={timed}
            key={note.id}
            note={note}
            view={view}
            target={view.target}
            writer={writer}
            focused={note.id === focusedId}
            live={liveNoteIds?.has(note.id) ?? false}
            onSeek={onSeek}
            onReply={clientPreview || viewOnly ? undefined : setReplyTo}
            row={row}
          />
        ))}
      </div>

      {viewOnly ? (
        <p className="rvc-viewonly" role="note">
          <Eye size={13} aria-hidden="true" />
          <span><strong>You have view-only access.</strong> You can watch this cut and read the notes, but not comment.</span>
        </p>
      ) : clientPreview ? (
        <p className="rvc-preview-note">
          You&rsquo;re seeing this cut as a client would. Turn off the client view to comment.
        </p>
      ) : (
        <Composer
          timed={timed}
          view={view}
          writer={writer}
          positionMs={positionMs}
          replyTo={replyTo}
          onReplyTo={setReplyTo}
          notes={notes}
          canWriteTeam={canWriteTeam}
          onCancelReply={() => setReplyTo(null)}
          pendingAnnotation={pendingAnnotation}
          onClearAnnotation={onClearAnnotation}
          hold={hold}
          onHold={onHold}
          durationMs={durationMs}
          onChange={onComposerChange}
          mark={mark}
          onMark={onMark}
          onPlayRange={onPlayRange}
          onRestoreAnnotation={onRestoreAnnotation}
        />
      )}
    </div>
  );
}

function attachmentBase(target: ReviewView["target"], noteId: string): string | null {
  if (!target) return null;
  const { workspaceId, projectId, versionId } = target;
  return `/api/workspaces/${workspaceId}/projects/${projectId}/media-versions/${versionId}/comments/${noteId}/attachments`;
}

function TeamBadge() {
  return (
    <em className="rvc-team" title="Team only: guests and client members never see this note.">
      <Lock size={9} />Team only
    </em>
  );
}

/** Status, author and drawing filters plus a search, over the comment feed. */
function FilterBar({ filter, onChange, counts, sides, filtering }: {
  filter: NoteFilter; onChange: (filter: NoteFilter) => void;
  counts: ReturnType<typeof filterCounts>; sides: boolean; filtering: boolean;
}) {
  const set = (change: Partial<NoteFilter>) => onChange({ ...filter, ...change });
  const statuses: { value: NoteStatus; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "open", label: "Open", count: counts.open },
    { value: "resolved", label: "Resolved", count: counts.resolved },
  ];
  const side = (value: Exclude<NoteSide, "all">, label: string, count: number, title: string) => (
    <button
      type="button" aria-pressed={filter.side === value} className={filter.side === value ? "is-on" : ""}
      onClick={() => set({ side: filter.side === value ? "all" : value })} title={title}
    >
      {label}<small>{count}</small>
    </button>
  );
  return (
    <div className="rvc-filters">
      <label className="rvc-search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          value={filter.query}
          onChange={(event) => set({ query: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Escape" && filter.query) { event.stopPropagation(); set({ query: "" }); } }}
          placeholder="Search comments"
          aria-label="Search comments"
        />
      </label>
      <div className="rvc-filter-row">
        <div className="rvc-status" role="radiogroup" aria-label="Show comments">
          {statuses.map((item) => (
            <button
              key={item.value} type="button" role="radio" aria-checked={filter.status === item.value}
              className={filter.status === item.value ? "is-on" : ""} onClick={() => set({ status: item.value })}
            >
              {item.label}<small>{item.count}</small>
            </button>
          ))}
        </div>
        <div className="rvc-chips" role="group" aria-label="Filter comments">
          <button type="button" aria-pressed={filter.mine} className={filter.mine ? "is-on" : ""} onClick={() => set({ mine: !filter.mine })} title="Notes you wrote or replied to">
            Mine<small>{counts.mine}</small>
          </button>
          <button type="button" aria-pressed={filter.drawings} className={filter.drawings ? "is-on" : ""} onClick={() => set({ drawings: !filter.drawings })} title="Notes with a drawing on the frame">
            <PencilLine size={11} aria-hidden="true" />Drawings<small>{counts.drawings}</small>
          </button>
          {sides && side("client", "Client", counts.client, "Written by client members and guest reviewers")}
          {sides && side("team", "Team", counts.team, "Written by members of this workspace")}
          {filtering && <button type="button" className="rvc-clear" onClick={() => onChange(DEFAULT_FILTER)}>Clear</button>}
        </div>
      </div>
    </div>
  );
}

/** Edit-in-place for the viewer's own note or reply. */
function EditBox({ initial, original, onSave, onCancel }: { initial: string; original: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.setSelectionRange(initial.length, initial.length); }, [initial.length]);
  const unchanged = !text.trim() || text.trim() === original.trim();
  const save = () => { if (!unchanged) onSave(text); };
  return (
    <form className="rvc-edit" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <textarea
        ref={field}
        id="rv-comment-field"
        value={text}
        aria-label="Edit note"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
        }}
      />
      <div>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="is-primary" disabled={unchanged}>Save</button>
      </div>
    </form>
  );
}

/** Edit and delete for one note or reply, with permission checks and an inline confirm. */
function OwnActions({ note, writer, canEdit, canDelete, deleteBlocked, editing, onEdit }: {
  note: ReviewNote; writer: ReviewWriter; canEdit: boolean; canDelete: boolean;
  /** Why delete is refused (others replied and the viewer cannot manage), shown on the button. */
  deleteBlocked: string | null;
  editing: boolean; onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (note.pending || editing || (!canEdit && !canDelete)) return null;
  const replies = note.replies.length;
  if (confirming) {
    return (
      <span className="rvc-confirm" role="group" aria-label="Confirm delete">
        <span>{replies ? `Delete with ${replies} ${replies === 1 ? "reply" : "replies"}?` : "Delete?"}</span>
        <button type="button" className="rvc-delete is-danger" onClick={() => { setConfirming(false); void writer.deleteNote(note); }}>Delete</button>
        <button type="button" onClick={() => setConfirming(false)}>Keep</button>
      </span>
    );
  }
  return (
    <>
      {canEdit && <button type="button" onClick={onEdit} aria-label={`Edit ${note.text ? "note" : "comment"}`} title="Edit"><Pencil size={11} />Edit</button>}
      {canDelete && (
        <button
          type="button" className="rvc-delete" aria-label="Delete note"
          disabled={Boolean(deleteBlocked)} title={deleteBlocked ?? "Delete"}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={12} />
        </button>
      )}
    </>
  );
}

/** Changes how long a posted drawing stays on screen: its frame only, a preset, or the note's range. */
function DrawingDuration({ drawing, noteEndMs, durationMs, writer, onDone }: {
  drawing: NoteDrawing & { startMs: number }; noteEndMs: number | null; durationMs: number; writer: ReviewWriter; onDone: () => void;
}) {
  const current = drawing.endMs ?? drawing.startMs + 5000;
  const span = current - drawing.startMs;
  const cap = (ms: number) => (durationMs > 0 ? Math.min(ms, durationMs) : ms);
  const choose = (endMs: number) => { void writer.setDrawingWindow(drawing, endMs); onDone(); };
  const option = (key: string, label: string, endMs: number, active: boolean) => (
    <button key={key} type="button" role="radio" aria-checked={active} className={active ? "is-on" : ""} onClick={() => choose(endMs)}>{label}</button>
  );
  return (
    <div className="rvc-hold is-inline" role="group" aria-label="Change how long the drawing stays on screen">
      <div className="rvc-hold-row">
        <span className="rvc-hold-label"><Timer size={12} aria-hidden="true" />Show drawing</span>
        <div className="rvc-hold-options" role="radiogroup" aria-label="Drawing duration">
          {option("frame", "Frame", drawing.startMs, span === 0)}
          {HOLD_PRESETS_MS.map((ms) => option(`h${ms}`, `${ms / 1000}s`, cap(drawing.startMs + ms), span === ms || (drawing.endMs === null && ms === 5000)))}
          {noteEndMs !== null && option("range", "Range", noteEndMs, current === noteEndMs && span !== 0)}
        </div>
        <button type="button" className="rvc-hold-close" onClick={onDone} aria-label="Close duration options"><X size={12} /></button>
      </div>
    </div>
  );
}

function Note({ note, view, target, writer, focused, live = false, onSeek, onReply, timed = true, row }: {
  timed?: boolean; note: ReviewNote; view: ReviewView; target: ReviewView["target"]; writer: ReviewWriter; focused: boolean;
  /** Its drawing or range covers the playhead: lit while the cut plays through it. */
  live?: boolean;
  onSeek: (ms: number) => void;
  /** Omitted where there is no composer to reply with, so no dead Reply button is drawn. */
  onReply?: (note: ReviewNote) => void;
  row?: RowContext;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The text of a refused edit, put back in the box so nothing typed is lost. */
  const [retryText, setRetryText] = useState<string | null>(null);
  const [durationOpen, setDurationOpen] = useState(false);
  // Optimistic: the row shows the new text at once and the box closes; if the API refuses,
  // the box reopens holding what was typed.
  const saveEdit = (item: ReviewNote) => async (text: string) => {
    setEditingId(null);
    setRetryText(null);
    const saved = await writer.editNote(item, text);
    if (!saved) { setRetryText(text); setEditingId(item.id); }
  };
  const stopEditing = () => { setEditingId(null); setRetryText(null); };
  const viewerId = row?.viewerId ?? null;
  const base = attachmentBase(target, note.id);
  // Local (device-only) notes are always the viewer's own; project notes follow the API.
  const access = target && !note.local ? view.access : null;
  const canResolve = (!access || access.resolve) && !note.pending;
  const canReact = (!access || access.react) && !note.pending;
  /*
   * Edit: only the author, with comment rights (the API's rule). Delete: the author too, or
   * anyone who can manage comments; an author without manage cannot delete a thread other
   * people replied to, because deleting a note deletes its replies.
   */
  const rights = (item: ReviewNote) => {
    const own = isMine(item, viewerId);
    const canEdit = own && (!access || access.comment);
    const manage = !access || access.resolve;
    const othersReplied = item.replies.some((reply) => !isMine(reply, viewerId));
    const canDelete = (own && (!access || access.comment)) || Boolean(access?.resolve);
    const deleteBlocked = own && !manage && othersReplied ? "Others have replied, so only someone who can manage comments can delete this note." : null;
    return { canEdit, canDelete, deleteBlocked };
  };
  const mine = rights(note);
  const recording = note.recording ?? (base ? recordingOf(note, (id) => `${base}/${id}/`) : null);
  const files = note.attachments.filter((item) => !recording || !item.mimeType.startsWith(recording.mimeType.split("/")[0]));
  // The span the row shows: a range note's in/out, else how long its drawing stays up.
  const drawing = note.drawingWindow ?? null;
  const rangeEnd = note.endMs ?? (drawing && !drawing.frameOnly ? drawing.endMs : null);
  const stampLabel = note.startMs !== null ? rangeLabel(note.startMs, rangeEnd) : note.timecode;
  const stampTitle = note.startMs === null ? undefined
    : note.endMs ? `Range note ${rangeLabel(note.startMs, note.endMs)}. Click to jump to its start.`
    : drawing ? (drawing.frameOnly ? `Drawing shows on ${stampLabel} only, while paused there` : `Drawing stays on screen ${stampLabel} (${holdLabel(drawing)})`)
    : `Jump to ${stampLabel}`;
  // A posted drawing's duration can be changed by whoever drew it (the API's rule for annotations).
  const ownDrawing = note.drawing && note.drawing.startMs !== null && timed && !note.pending
    && (note.drawing.annotationId.startsWith("local-") || (viewerId !== null && note.drawing.authorId === viewerId))
    && (!access || access.annotate)
    ? { ...note.drawing, startMs: note.drawing.startMs } : null;
  const loopable = timed && note.startMs !== null && rangeEnd !== null && row?.onPlayRange;

  return (
    <article className={`rvc-note ${note.resolved ? "is-resolved" : ""} ${focused ? "is-focused" : ""} ${live ? "is-live" : ""} ${note.visibility === "team" ? "is-team" : ""} ${note.pending ? "is-pending" : ""}`} data-note={note.id}>
      <div className="rvc-meta">
        <span className="rvc-avatar">{note.initials}</span>
        <strong>{note.author}</strong>
        <small>{note.pending ? "Sending…" : note.age}</small>
        {note.edited && <small className="rvc-edited" title="This note was edited after it was posted">· edited</small>}
        {note.visibility === "team" && <TeamBadge />}
        {note.local && <em title="Kept on this device: this cut has no project review record yet.">Local</em>}
      </div>

      {editingId === note.id ? (
        <EditBox initial={retryText ?? note.text} original={note.text} onSave={(text) => void saveEdit(note)(text)} onCancel={stopEditing} />
      ) : (
        <p className="rvc-body">
          {timed && note.timecode && (
            <button
              type="button"
              className={`rvc-stamp ${rangeEnd ? "is-range" : ""}`}
              title={stampTitle}
              onClick={() => note.startMs !== null && onSeek(note.startMs)}
            >
              {drawing && <PencilLine aria-hidden="true" />}
              {stampLabel}
              {drawing?.frameOnly && <small>1 frame</small>}
            </button>
          )}
          {loopable && (
            <button
              type="button" className="rvc-loop"
              onClick={() => row?.onPlayRange?.(note.startMs!, rangeEnd!)}
              aria-label={`Loop ${rangeLabel(note.startMs!, rangeEnd)}`}
              title="Play this range on repeat (Esc stops)"
            >
              <Repeat aria-hidden="true" />
            </button>
          )}
          <Mentioned text={note.text} mentions={note.mentions} />
        </p>
      )}

      {durationOpen && ownDrawing && (
        <DrawingDuration drawing={ownDrawing} noteEndMs={note.endMs ?? null} durationMs={row?.durationMs ?? 0} writer={writer} onDone={() => setDurationOpen(false)} />
      )}

      {recording && (
        <div className="rvc-recording">
          {recording.kind === "voice"
            ? <audio src={recording.url} controls preload="none" />
            : <video src={recording.url} controls playsInline preload="none" />}
        </div>
      )}

      {files.length > 0 && (
        <div className="rvc-attachments">
          {files.map((item) => (
            <span key={item.id}>
              {item.status === "READY" && base
                ? <a href={`${base}/${item.id}/`}><Paperclip />{item.name}</a>
                : <><Paperclip />{item.name} · {item.status.toLowerCase().replaceAll("_", " ")}</>}
            </span>
          ))}
        </div>
      )}

      {note.replies.map((reply) => {
        const own = rights(reply);
        return (
          <div className={`rvc-reply ${reply.pending ? "is-pending" : ""}`} key={reply.id} data-note={reply.id}>
            <CornerDownRight size={12} />
            <div>
              <div className="rvc-meta">
                <strong>{reply.author}</strong><small>{reply.pending ? "Sending…" : reply.age}</small>
                {reply.edited && <small className="rvc-edited" title="This reply was edited after it was posted">· edited</small>}
                {reply.visibility === "team" && note.visibility !== "team" && <TeamBadge />}
              </div>
              {editingId === reply.id
                ? <EditBox initial={retryText ?? reply.text} original={reply.text} onSave={(text) => void saveEdit(reply)(text)} onCancel={stopEditing} />
                : <p className="rvc-body"><Mentioned text={reply.text} mentions={reply.mentions} /></p>}
              {(own.canEdit || own.canDelete) && editingId !== reply.id && !reply.pending && (
                <div className="rvc-actions is-reply">
                  <OwnActions note={reply} writer={writer} {...own} editing={false} onEdit={() => setEditingId(reply.id)} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {editingId !== note.id && (
        <div className="rvc-actions">
          {onReply && !note.pending && <button type="button" onClick={() => onReply(note)}>Reply</button>}
          {canReact && <button type="button" onClick={() => writer.react(note, "👍")} aria-label="React with thumbs up"><SmilePlus size={12} /></button>}
          {canResolve && <button
            type="button"
            className={note.resolved ? "" : "rvc-resolve"}
            onClick={() => writer.setResolved(note, !note.resolved)}
          >
            {note.resolved ? "Reopen" : "Resolve"}
          </button>}
          {ownDrawing && (
            <button type="button" onClick={() => setDurationOpen(!durationOpen)} aria-expanded={durationOpen} aria-label="Change drawing duration" title="Change how long the drawing stays on screen">
              <Timer size={12} />
            </button>
          )}
          <OwnActions note={note} writer={writer} {...mine} editing={false} onEdit={() => setEditingId(note.id)} />
          {note.reactions.length > 0 && (
            <span className="rvc-reactions">
              {note.reactions.map((reaction) => (
                <button key={reaction.emoji} type="button" onClick={() => writer.react(note, reaction.emoji)}>
                  {reaction.emoji} {reaction.count}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

/** Renders `@Name` as a mention chip when the API confirmed it notified that person. */
function Mentioned({ text, mentions }: { text: string; mentions: { id: string; name: string }[] }) {
  if (!mentions.length || !text) return <>{text}</>;
  const names = mentions.map((mention) => mention.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const pattern = new RegExp(`@(?:${names.map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(pattern);
  const found = text.match(pattern) ?? [];
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {found[index] && <b className="rvc-mention">{found[index]}</b>}
        </span>
      ))}
    </>
  );
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Composer({ view, writer, positionMs, replyTo, onReplyTo, notes, canWriteTeam, onCancelReply, pendingAnnotation, onClearAnnotation, hold, onHold, durationMs, onChange: report, timed = true, mark = null, onMark, onPlayRange, onRestoreAnnotation }: {
  timed?: boolean; view: ReviewView; writer: ReviewWriter; positionMs: number; replyTo: ReviewNote | null;
  onReplyTo: (note: ReviewNote) => void; notes: ReviewNote[]; canWriteTeam: boolean;
  onCancelReply: () => void; pendingAnnotation: AnnotationElement | null; onClearAnnotation: () => void;
  hold: HoldChoice; onHold: (choice: HoldChoice) => void; durationMs: number;
  onChange: (state: ComposerState) => void;
  mark?: MarkRange | null; onMark?: (range: MarkRange | null) => void;
  onPlayRange?: (startMs: number, endMs: number) => void;
  onRestoreAnnotation?: (annotation: AnnotationElement) => void;
}) {
  const mediaId = view.version?.id ?? null;
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(true);
  const [mentions, setMentions] = useState<Mentionable[]>([]);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<CommentVisibility>("client");
  // `ready` holds saving off until the stored draft has been read back, so the empty first
  // render cannot overwrite it. `restoredAt` drives the "Draft restored" chip.
  const [ready, setReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // The position is captured when composing starts, so a note does not drift as the video
  // keeps playing while it is being typed.
  const [anchor, setAnchor] = useState<number | null>(null);
  // A marked range wins over the pin: the note starts at its in point and ends at its out.
  const ranged = Boolean(mark && timed && !replyTo);
  const markOut = ranged ? rangeOut(mark) : null;
  const startMs = replyTo ? null : ranged && mark ? mark.inMs : pinned ? anchor ?? positionMs : null;
  // A reply in a team thread is team-only whatever the toggle says; the API enforces the same.
  const teamThread = replyTo?.visibility === "team";
  const effectiveVisibility: CommentVisibility = !view.target ? "client" : teamThread ? "team" : canWriteTeam ? visibility : "client";

  // Reads the stored draft once, after hydration: `localStorage` does not exist on the
  // server, so reading it during render would make the first client render disagree.
  const findNote = useRef((id: string) => notes.find((note) => note.id === id) ?? null);
  useEffect(() => { findNote.current = (id: string) => notes.find((note) => note.id === id) ?? null; }, [notes]);
  const restoreReply = useRef(onReplyTo);
  useEffect(() => { restoreReply.current = onReplyTo; }, [onReplyTo]);
  useEffect(() => {
    const draft = loadDraft(mediaId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore from localStorage after mount (not available during SSR)
    setReady(true);
    if (!draft || !draft.text.trim()) return;
    setText(draft.text);
    setPinned(draft.pinned);
    setAnchor(draft.anchorMs);
    setMentions(draft.mentions);
    setVisibility(draft.visibility);
    setRestoredAt(draft.savedAt);
    const parent = draft.replyToId ? findNote.current(draft.replyToId) : null;
    if (parent) restoreReply.current(parent);
  }, [mediaId]);

  useEffect(() => {
    if (!ready) return;
    patchDraft(mediaId, { text, pinned, anchorMs: anchor, replyToId: replyTo?.id ?? null, visibility, mentions });
  }, [anchor, mediaId, mentions, pinned, ready, replyTo?.id, text, visibility]);

  const hasText = Boolean(text.trim());
  useEffect(() => { report({ text: hasText, recording: Boolean(clip), startMs }); }, [clip, hasText, report, startMs]);
  // A drawing on a timed, pinned note gets a display duration; a reply or unpinned note has
  // no moment to hold from, so its drawing simply shows throughout.
  // With a marked out point the drawing simply covers the range, so there is no hold to pick.
  const holdable = Boolean(pendingAnnotation && timed && startMs !== null && markOut === null);

  const candidates = query === null
    ? []
    : view.members.filter((member) => member.name.toLowerCase().includes(query.toLowerCase()) || member.email.toLowerCase().includes(query.toLowerCase())).slice(0, 5);

  function onChange(value: string) {
    if (!text && value) setAnchor(positionMs);
    setText(value);
    const caret = field.current?.selectionStart ?? value.length;
    const match = value.slice(0, caret).match(/@([\w.\- ]{0,30})$/);
    setQuery(match ? match[1] : null);
  }

  function insertMention(member: Mentionable) {
    const caret = field.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\w.\- ]{0,30})$/, `@${member.name} `);
    setText(before + text.slice(caret));
    setMentions((current) => current.some((item) => item.id === member.id) ? current : [...current, member]);
    setQuery(null);
    field.current?.focus();
  }

  /** Empties the composer. `revoke` frees the recording's blob URL, once nothing needs it. */
  function clear(revoke: boolean) {
    if (revoke && clip) URL.revokeObjectURL(clip.url);
    setText(""); setMentions([]); setClip(null); setAnchor(null); setQuery(null); setRestoredAt(null);
    onClearAnnotation();
    onCancelReply();
    if (!replyTo) onMark?.(null);
    clearDraft(mediaId);
  }
  const reset = () => clear(true);

  async function submit() {
    if (holdable && startMs !== null && !validChoice(startMs, hold)) {
      writer.setError(`Set an out point after ${timecode(startMs)}, or pick a preset.`);
      return;
    }
    // Only mentions still written in the note are sent, so deleting the text un-notifies.
    const active = mentions.filter((member) => text.includes(`@${member.name}`));
    const input = {
      text,
      startMs,
      parentId: replyTo?.id ?? null,
      mentions: active,
      recording: clip,
      annotation: pendingAnnotation,
      annotationEndMs: markOut ?? (holdable && startMs !== null ? drawingEndMs(startMs, hold, durationMs) : null),
      endMs: markOut ?? (holdable ? noteEndMs(startMs, hold) : null),
      visibility: effectiveVisibility,
    };
    /*
     * Optimistic on a project cut: the note appears in the feed and the box empties at once.
     * If the post is refused, everything comes back — text, mentions, reply, drawing, range
     * and recording — so nothing typed is lost.
     */
    const optimistic = Boolean(view.target) && Boolean(text.trim() || clip);
    const snapshot = { text, mentions, clip, anchor, pinned, replyTo, annotation: pendingAnnotation, mark };
    if (optimistic) clear(false);
    const posted = await writer.compose(input);
    if (!posted) {
      if (!optimistic) return;
      setText(snapshot.text); setMentions(snapshot.mentions); setClip(snapshot.clip); setAnchor(snapshot.anchor); setPinned(snapshot.pinned);
      if (snapshot.replyTo) onReplyTo(snapshot.replyTo);
      if (snapshot.annotation) onRestoreAnnotation?.(snapshot.annotation);
      if (snapshot.mark) onMark?.(snapshot.mark);
      return;
    }
    rememberHold(hold);
    if (optimistic) { if (snapshot.clip) URL.revokeObjectURL(snapshot.clip.url); } else reset();
  }

  /** The Range button: a range from the pinned time, for touch screens with no I/O keys. */
  const startMark = () => {
    const inMs = Math.round(anchor ?? positionMs);
    const outMs = Math.round(durationMs > 0 ? Math.min(durationMs, inMs + DEFAULT_RANGE_MS) : inMs + DEFAULT_RANGE_MS);
    onMark?.({ inMs, outMs: outMs > inMs ? outMs : null });
  };

  const disabled = view.target ? !view.canComment : !view.version;
  const team = effectiveVisibility === "team";

  return (
    <form
      className={`rvc-composer ${team ? "is-team" : ""}`}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      {restoredAt && hasText && (
        <div className="rvc-chip is-restored" role="status">
          <span>Draft restored from {new Date(restoredAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
          <button type="button" onClick={reset} aria-label="Discard draft" title="Discard draft"><Trash2 size={12} /></button>
        </div>
      )}

      {replyTo && (
        <div className="rvc-replying">
          <span>Replying to {replyTo.author}</span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply"><X size={12} /></button>
        </div>
      )}

      {pendingAnnotation && (
        <div className="rvc-chip">
          <span>Drawing attached · {pendingAnnotation.element_type.toLowerCase()}</span>
          <button type="button" onClick={onClearAnnotation} aria-label="Remove drawing"><X size={12} /></button>
        </div>
      )}

      {ranged && mark && (
        <div className="rvc-chip is-range" role="status">
          <span>
            <ArrowLeftRight size={12} aria-hidden="true" />
            {markOut !== null
              ? <>Range <b>{rangeLabel(mark.inMs, markOut)}</b>{pendingAnnotation ? " · drawing shows for the whole range" : ""}</>
              : <>In <b>{timecode(mark.inMs)}</b> · press O or drag the handle for an out point</>}
          </span>
          {markOut !== null && onPlayRange && (
            <button type="button" onClick={() => onPlayRange(mark.inMs, markOut)} aria-label="Loop the marked range" title="Loop the marked range (Esc stops)"><Repeat size={12} /></button>
          )}
          <button type="button" onClick={() => onMark?.(null)} aria-label="Clear range" title="Clear range (Esc)"><X size={12} /></button>
        </div>
      )}

      {holdable && startMs !== null && (
        <HoldPicker startMs={startMs} positionMs={positionMs} durationMs={durationMs} value={hold} onChange={onHold} />
      )}

      {clip && (
        <div className="rvc-chip">
          <span>{clip.kind === "voice" ? "Voice comment" : "Screen recording"} attached</span>
          <button type="button" onClick={() => { URL.revokeObjectURL(clip.url); setClip(null); }} aria-label="Remove recording"><X size={12} /></button>
        </div>
      )}

      {candidates.length > 0 && (
        <ul className="rvc-mentions" role="listbox" aria-label="Mention a team member">
          {candidates.map((member) => (
            <li key={member.id}>
              <button type="button" onClick={() => insertMention(member)}>
                <AtSign size={12} />{member.name}<small>{member.email}</small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view.target && canWriteTeam && !disabled && (
        teamThread ? (
          <p className="rvc-visibility-locked"><Lock size={11} />Team thread: your reply stays team-only</p>
        ) : (
          <div className="rvc-visibility" role="radiogroup" aria-label="Who can see this comment">
            <button type="button" role="radio" aria-checked={!team} className={!team ? "is-on" : ""} onClick={() => setVisibility("client")}>
              <Users size={12} />Client can see
            </button>
            <button type="button" role="radio" aria-checked={team} className={team ? "is-on is-team" : ""} onClick={() => setVisibility("team")}>
              <Lock size={12} />Team only
            </button>
          </div>
        )
      )}

      <textarea
        ref={field}
        value={text}
        disabled={disabled}
        aria-label="Comment"
        placeholder={disabled
          ? "Comments are unavailable for this cut."
          : `${team ? "Team-only note" : "Leave a comment"}${timed && startMs !== null ? ` at ${timecode(startMs)}` : ""}… use @ to mention`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
          // Esc hands the keyboard back to the player; the draft stays.
          if (event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); }
        }}
      />

      {!replyTo && (
        <Recorder onClip={setClip} disabled={disabled} />
      )}

      {writer.error && <p className="form-error">{writer.error}</p>}

      <div className="rvc-send">
        {!timed
          ? <small>{replyTo ? "Replying in the thread" : "Comments apply to the whole file"}</small>
          : replyTo
          ? <small>Replies inherit their parent&rsquo;s timecode</small>
          : ranged && mark ? (
            <small className="rvc-pin">{markOut !== null ? `Covers ${rangeLabel(mark.inMs, markOut)}` : `Pinned to ${timecode(mark.inMs)}`}</small>
          ) : (
            <span className="rvc-pin-row">
              <label className="rvc-pin">
                <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                {pinned ? `Pinned to ${timecode(startMs ?? positionMs)}` : "Not pinned to a time"}
              </label>
              {onMark && pinned && (
                <button type="button" className="rvc-range-btn" onClick={startMark} title="Make this note cover a range (I / O keys, or shift-drag on the timeline)">
                  <ArrowLeftRight size={11} aria-hidden="true" />Range
                </button>
              )}
            </span>
          )}
        <button type="submit" disabled={disabled || writer.busy} aria-label={team ? "Send team-only comment" : "Send comment"}>
          <Send size={14} />
        </button>
      </div>
    </form>
  );
}

/**
 * How long the drawing on this note stays on screen during playback.
 *
 * Frame.io only ever shows a drawing on its own frame, when paused or when its comment is
 * clicked. That suits a still-frame note, so it stays an option ("Frame"), but a circle
 * around something moving reads better if it stays up while the shot plays — hence the
 * presets. "Range" sets an out point (typed, or taken from the playhead) and makes the note
 * itself a range note covering the same span.
 */
function HoldPicker({ startMs, positionMs, durationMs, value, onChange }: {
  startMs: number; positionMs: number; durationMs: number; value: HoldChoice; onChange: (choice: HoldChoice) => void;
}) {
  const [outText, setOutText] = useState<string | null>(null);
  const endMs = drawingEndMs(startMs, value, durationMs);
  const window = displayWindow(startMs, endMs);
  const valid = validChoice(startMs, value);
  const pick = (choice: HoldChoice) => { setOutText(null); onChange(choice); };
  const startRange = () => pick({ kind: "range", endMs: positionMs > startMs + 250 ? positionMs : startMs + 5000 });
  const commitOut = () => {
    if (outText === null) return;
    const parsed = parseTime(outText);
    if (parsed !== null) onChange({ kind: "range", endMs: durationMs > 0 ? Math.min(parsed, durationMs) : parsed });
    setOutText(null);
  };
  const option = (key: string, label: string, active: boolean, choose: () => void, title: string) => (
    <button key={key} type="button" role="radio" aria-checked={active} className={active ? "is-on" : ""} onClick={choose} title={title}>{label}</button>
  );

  return (
    <div className="rvc-hold" role="group" aria-label="How long the drawing stays on screen">
      <div className="rvc-hold-row">
        <span className="rvc-hold-label"><Timer size={12} aria-hidden="true" />Show drawing</span>
        <div className="rvc-hold-options" role="radiogroup" aria-label="Drawing duration">
          {option("frame", "Frame", value.kind === "frame", () => pick({ kind: "frame" }), "Only on this frame, while paused (like Frame.io)")}
          {HOLD_PRESETS_MS.map((ms) => option(`h${ms}`, `${ms / 1000}s`, value.kind === "hold" && value.ms === ms, () => pick({ kind: "hold", ms }), `Stays on screen for ${ms / 1000} seconds of playback`))}
          {option("range", "Range", value.kind === "range", startRange, "Set an out point: the drawing and the note cover that whole range")}
        </div>
      </div>
      {value.kind === "range" && (
        <div className="rvc-hold-range">
          <span>In <b>{timecode(startMs)}</b></span>
          <label>
            Out
            <input
              type="text"
              inputMode="decimal"
              value={outText ?? (value.endMs / 1000).toFixed(1)}
              aria-label="Out point in seconds"
              aria-invalid={!valid}
              onChange={(event) => setOutText(event.target.value)}
              onBlur={commitOut}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitOut(); } }}
            />
            <small>s</small>
          </label>
          <button type="button" onClick={() => pick({ kind: "range", endMs: positionMs })} disabled={positionMs <= startMs} title="Use the current playhead as the out point">
            Out at playhead · {timecode(positionMs)}
          </button>
        </div>
      )}
      <small className={`rvc-hold-summary ${valid ? "" : "is-error"}`} role={valid ? undefined : "alert"}>
        {!valid
          ? `The out point has to come after ${timecode(startMs)}.`
          : window?.frameOnly
            ? `Shows on ${timecode(startMs)} only, while paused there.`
            : `Visible ${rangeLabel(startMs, endMs)} during playback${value.kind === "range" ? " · range note" : ""}.`}
      </small>
    </div>
  );
}

export function RevisionForm({ writer, positionMs, approved = false, asClient = false, versionLabel, onDone, onDirtyChange }: {
  writer: ReviewWriter; positionMs: number; approved?: boolean;
  /** A client-team member: recorded as a client decision on this exact version. */
  asClient?: boolean; versionLabel?: string;
  onDone: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const dirty = Boolean(text.trim());
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  return (
    <form
      className="rvc-revision"
      onSubmit={async (event) => {
        event.preventDefault();
        const sent = asClient
          ? await writer.decideAsClient("changes_requested", text, positionMs)
          : await writer.requestChanges(text, positionMs);
        if (sent) onDone();
      }}
    >
      <label htmlFor="rv-revision">What needs to change?</label>
      {approved && <p className="rvc-revision-note">This cut is approved. Requesting changes reopens it and moves it back to Revision.</p>}
      {asClient && <p className="rvc-revision-note">Your message is posted as a note on {versionLabel ?? "this version"} and the team is notified.</p>}
      <textarea
        id="rv-revision"
        value={text}
        autoFocus
        required
        onChange={(event) => setText(event.target.value)}
        placeholder={`Describe the revision requested at ${timecode(positionMs)}…`}
      />
      {writer.error && <p className="form-error">{writer.error}</p>}
      <div>
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" disabled={writer.busy}><RotateCcw size={13} />{writer.busy ? "Requesting…" : "Request changes"}</button>
      </div>
    </form>
  );
}
