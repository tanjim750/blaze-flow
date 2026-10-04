"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, CheckCheck, CornerDownRight, Eye, Lock, MessageSquareText, Paperclip, RotateCcw, Send, SmilePlus, Trash2, Users, X } from "lucide-react";
import type { ReviewNote } from "@/lib/review-notes";
import { clientView, recordingOf } from "@/lib/review-notes";
import type { Mentionable, ReviewView } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import type { AnnotationElement, CommentVisibility } from "@/lib/api";
import { clearDraft, loadDraft, patchDraft } from "@/lib/review-drafts";
import { Recorder } from "./recorder";
import type { RecordedClip, ReviewWriter } from "./writer";

/** What the composer holds that is not yet posted, reported up for the leave guard. */
export type ComposerState = { text: boolean; recording: boolean };

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
};

/**
 * Which versions' notes to show while comparing.
 *
 * Two lists under two headings rather than one merged feed: the reason to compare is to see
 * what was said about which cut, and a single list would destroy exactly that.
 */
function CompareFeeds({ view, writer, compareWriter, clientPreview, onSeek }: {
  view: ReviewView; writer: ReviewWriter; compareWriter: ReviewWriter; clientPreview: boolean;
  onSeek: (versionId: string, ms: number) => void;
}) {
  const comparison = view.comparison!;
  const current = view.version!;
  const [showing, setShowing] = useState<Record<string, boolean>>({ [current.id]: true, [comparison.version.id]: true });
  const visible = (notes: ReviewNote[]) => clientPreview ? clientView(notes) : notes;
  // Each side resolves and reacts through a writer bound to its own cut; the current
  // writer would address the other version's notes on the wrong media version.
  const sides = [
    { version: current, notes: visible(view.notes), writer },
    { version: comparison.version, notes: visible(comparison.notes), writer: compareWriter },
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
                    onSeek={(ms) => onSeek(version.id, ms)}
                  />
                ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function Comments({
  view, writer, compareWriter, notes, positionMs, focusedId, pendingAnnotation, onClearAnnotation, onSeek, onCompareSeek,
  canWriteTeam, clientPreview, hiddenTeamNotes, onClientPreview, onComposerChange, timed = true,
}: Props) {
  const [replyTo, setReplyTo] = useState<ReviewNote | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  // A project cut the viewer can read but not comment on (a read-only role): show that,
  // instead of a composer whose every send would be refused.
  const viewOnly = Boolean(view.target) && !view.canComment;

  const open = notes.filter((note) => !note.resolved).length;
  const shown = showResolved ? notes : notes.filter((note) => !note.resolved);
  const ordered = useMemo(
    () => [...shown].sort((a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER)),
    [shown],
  );

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
        <CompareFeeds view={view} writer={writer} compareWriter={compareWriter} clientPreview={clientPreview} onSeek={onCompareSeek} />
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
          <span>{notes.length ? `${open} open` : "None yet"}</span>
          {notes.length > open && (
            <button type="button" onClick={() => setShowResolved(!showResolved)} aria-pressed={showResolved}>
              <CheckCheck size={12} />{showResolved ? "Hide resolved" : `${notes.length - open} resolved`}
            </button>
          )}
        </div>
      </header>

      <div className="rvc-feed" ref={feed}>
        {ordered.length === 0 && (
          <p className="rvc-empty">
            {timed ? "No comments on this cut yet. Scrub to a moment and leave the first note." : "No comments on this file yet. Leave the first note."}
          </p>
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
            onSeek={onSeek}
            onReply={clientPreview || viewOnly ? undefined : setReplyTo}
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
          onChange={onComposerChange}
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

function Note({ note, view, target, writer, focused, onSeek, onReply, timed = true }: {
  timed?: boolean; note: ReviewNote; view: ReviewView; target: ReviewView["target"]; writer: ReviewWriter; focused: boolean;
  onSeek: (ms: number) => void;
  /** Omitted where there is no composer to reply with, so no dead Reply button is drawn. */
  onReply?: (note: ReviewNote) => void;
}) {
  const base = attachmentBase(target, note.id);
  // Local (device-only) notes are always the viewer's own; project notes follow the API.
  const access = target && !note.local ? view.access : null;
  const canResolve = !access || access.resolve;
  const canReact = !access || access.react;
  const recording = note.recording ?? (base ? recordingOf(note, (id) => `${base}/${id}/`) : null);
  const files = note.attachments.filter((item) => !recording || !item.mimeType.startsWith(recording.mimeType.split("/")[0]));

  return (
    <article className={`rvc-note ${note.resolved ? "is-resolved" : ""} ${focused ? "is-focused" : ""} ${note.visibility === "team" ? "is-team" : ""}`} data-note={note.id}>
      <div className="rvc-meta">
        <span className="rvc-avatar">{note.initials}</span>
        <strong>{note.author}</strong>
        <small>{note.age}</small>
        {note.visibility === "team" && <TeamBadge />}
        {note.local && <em title="Kept on this device: this cut has no project review record yet.">Local</em>}
      </div>

      <p className="rvc-body">
        {timed && note.timecode && (
          <button type="button" className="rvc-stamp" onClick={() => note.startMs !== null && onSeek(note.startMs)}>
            {note.timecode}
          </button>
        )}
        <Mentioned text={note.text} mentions={note.mentions} />
      </p>

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

      {note.replies.map((reply) => (
        <div className="rvc-reply" key={reply.id}>
          <CornerDownRight size={12} />
          <div>
            <div className="rvc-meta"><strong>{reply.author}</strong><small>{reply.age}</small>{reply.visibility === "team" && note.visibility !== "team" && <TeamBadge />}</div>
            <p className="rvc-body"><Mentioned text={reply.text} mentions={reply.mentions} /></p>
          </div>
        </div>
      ))}

      <div className="rvc-actions">
        {onReply && <button type="button" onClick={() => onReply(note)}>Reply</button>}
        {canReact && <button type="button" onClick={() => writer.react(note, "👍")} aria-label="React with thumbs up"><SmilePlus size={12} /></button>}
        {canResolve && <button
          type="button"
          className={note.resolved ? "" : "rvc-resolve"}
          onClick={() => writer.setResolved(note, !note.resolved)}
        >
          {note.resolved ? "Reopen" : "Resolve"}
        </button>}
        {note.local && (
          <button type="button" className="rvc-delete" onClick={() => writer.removeNote(note)} aria-label="Delete note"><Trash2 size={12} /></button>
        )}
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

function Composer({ view, writer, positionMs, replyTo, onReplyTo, notes, canWriteTeam, onCancelReply, pendingAnnotation, onClearAnnotation, onChange: report, timed = true }: {
  timed?: boolean; view: ReviewView; writer: ReviewWriter; positionMs: number; replyTo: ReviewNote | null;
  onReplyTo: (note: ReviewNote) => void; notes: ReviewNote[]; canWriteTeam: boolean;
  onCancelReply: () => void; pendingAnnotation: AnnotationElement | null; onClearAnnotation: () => void;
  onChange: (state: ComposerState) => void;
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
  const startMs = replyTo ? null : pinned ? anchor ?? positionMs : null;
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
  useEffect(() => { report({ text: hasText, recording: Boolean(clip) }); }, [clip, hasText, report]);

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

  function reset() {
    if (clip) URL.revokeObjectURL(clip.url);
    setText(""); setMentions([]); setClip(null); setAnchor(null); setQuery(null); setRestoredAt(null);
    onClearAnnotation();
    onCancelReply();
    clearDraft(mediaId);
  }

  async function submit() {
    // Only mentions still written in the note are sent, so deleting the text un-notifies.
    const active = mentions.filter((member) => text.includes(`@${member.name}`));
    const posted = await writer.compose({
      text,
      startMs,
      parentId: replyTo?.id ?? null,
      mentions: active,
      recording: clip,
      annotation: pendingAnnotation,
      visibility: effectiveVisibility,
    });
    if (!posted) return;
    reset();
  }

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
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }}
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
          : (
            <label className="rvc-pin">
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
              {pinned ? `Pinned to ${timecode(startMs ?? positionMs)}` : "Not pinned to a time"}
            </label>
          )}
        <button type="submit" disabled={disabled || writer.busy} aria-label={team ? "Send team-only comment" : "Send comment"}>
          <Send size={14} />
        </button>
      </div>
    </form>
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
