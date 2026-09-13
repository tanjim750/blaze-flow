"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, CheckCheck, CornerDownRight, MessageSquareText, Paperclip, RotateCcw, Send, SmilePlus, Trash2, X } from "lucide-react";
import type { ReviewNote } from "@/lib/review-notes";
import { recordingOf } from "@/lib/review-notes";
import type { Mentionable, ReviewView } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import type { AnnotationElement } from "@/lib/api";
import { Recorder } from "./recorder";
import type { RecordedClip, ReviewWriter } from "./writer";

type Props = {
  view: ReviewView;
  writer: ReviewWriter;
  notes: ReviewNote[];
  positionMs: number;
  focusedId: string | null;
  pendingAnnotation: AnnotationElement | null;
  onClearAnnotation: () => void;
  onSeek: (ms: number) => void;
};

/**
 * Which versions' notes to show while comparing.
 *
 * Two lists under two headings rather than one merged feed: the reason to compare is to see
 * what was said about which cut, and a single list would destroy exactly that.
 */
function CompareFeeds({ view, writer, onSeek }: { view: ReviewView; writer: ReviewWriter; onSeek: (ms: number) => void }) {
  const comparison = view.comparison!;
  const current = view.version!;
  const [showing, setShowing] = useState<Record<string, boolean>>({ [current.id]: true, [comparison.version.id]: true });
  const sides = [
    { version: current, notes: view.notes },
    { version: comparison.version, notes: comparison.notes },
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
        {sides.map(({ version, notes }) => (showing[version.id] ?? true) && (
          <section key={version.id} className="rvc-side">
            <h3>{version.label}</h3>
            {notes.length === 0
              ? <p className="rvc-empty">No comments on {version.label}.</p>
              : notes.map((note) => (
                  <Note key={note.id} note={note} view={view} writer={writer} focused={false} onSeek={onSeek} onReply={() => undefined} />
                ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function Comments({ view, writer, notes, positionMs, focusedId, pendingAnnotation, onClearAnnotation, onSeek }: Props) {
  const [replyTo, setReplyTo] = useState<ReviewNote | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const feed = useRef<HTMLDivElement>(null);

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
  if (view.comparison) return <CompareFeeds view={view} writer={writer} onSeek={onSeek} />;

  return (
    <div className="rvc">
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
            No comments on this cut yet. Scrub to a moment and leave the first note.
          </p>
        )}
        {ordered.map((note) => (
          <Note
            key={note.id}
            note={note}
            view={view}
            writer={writer}
            focused={note.id === focusedId}
            onSeek={onSeek}
            onReply={setReplyTo}
          />
        ))}
      </div>

      <Composer
        view={view}
        writer={writer}
        positionMs={positionMs}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        pendingAnnotation={pendingAnnotation}
        onClearAnnotation={onClearAnnotation}
      />
    </div>
  );
}

function attachmentBase(view: ReviewView, noteId: string): string | null {
  if (!view.target) return null;
  const { workspaceId, projectId, versionId } = view.target;
  return `/api/workspaces/${workspaceId}/projects/${projectId}/media-versions/${versionId}/comments/${noteId}/attachments`;
}

function Note({ note, view, writer, focused, onSeek, onReply }: {
  note: ReviewNote; view: ReviewView; writer: ReviewWriter; focused: boolean;
  onSeek: (ms: number) => void; onReply: (note: ReviewNote) => void;
}) {
  const base = attachmentBase(view, note.id);
  const recording = note.recording ?? (base ? recordingOf(note, (id) => `${base}/${id}/`) : null);
  const files = note.attachments.filter((item) => !recording || !item.mimeType.startsWith(recording.mimeType.split("/")[0]));

  return (
    <article className={`rvc-note ${note.resolved ? "is-resolved" : ""} ${focused ? "is-focused" : ""}`} data-note={note.id}>
      <div className="rvc-meta">
        <span className="rvc-avatar">{note.initials}</span>
        <strong>{note.author}</strong>
        <small>{note.age}</small>
        {note.local && <em title="Kept on this device: this cut has no project review record yet.">Local</em>}
      </div>

      <p className="rvc-body">
        {note.timecode && (
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
            <div className="rvc-meta"><strong>{reply.author}</strong><small>{reply.age}</small></div>
            <p className="rvc-body"><Mentioned text={reply.text} mentions={reply.mentions} /></p>
          </div>
        </div>
      ))}

      <div className="rvc-actions">
        <button type="button" onClick={() => onReply(note)}>Reply</button>
        <button type="button" onClick={() => writer.react(note, "👍")} aria-label="React with thumbs up"><SmilePlus size={12} /></button>
        <button
          type="button"
          className={note.resolved ? "" : "rvc-resolve"}
          onClick={() => writer.setResolved(note, !note.resolved)}
        >
          {note.resolved ? "Reopen" : "Resolve"}
        </button>
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

function Composer({ view, writer, positionMs, replyTo, onCancelReply, pendingAnnotation, onClearAnnotation }: {
  view: ReviewView; writer: ReviewWriter; positionMs: number; replyTo: ReviewNote | null;
  onCancelReply: () => void; pendingAnnotation: AnnotationElement | null; onClearAnnotation: () => void;
}) {
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(true);
  const [mentions, setMentions] = useState<Mentionable[]>([]);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // The position is captured when composing starts, so a note does not drift as the video
  // keeps playing while it is being typed.
  const [anchor, setAnchor] = useState<number | null>(null);
  const startMs = replyTo ? null : pinned ? anchor ?? positionMs : null;

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
    });
    if (!posted) return;
    if (clip) URL.revokeObjectURL(clip.url);
    setText(""); setMentions([]); setClip(null); setAnchor(null); setQuery(null);
    onClearAnnotation();
    onCancelReply();
  }

  const disabled = view.target ? !view.canComment : !view.version;

  return (
    <form
      className="rvc-composer"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
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

      <textarea
        ref={field}
        value={text}
        disabled={disabled}
        aria-label="Comment"
        placeholder={disabled ? "Comments are unavailable for this cut." : `Leave a comment${startMs !== null ? ` at ${timecode(startMs)}` : ""}… use @ to mention`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }}
      />

      {!replyTo && (
        <Recorder onClip={setClip} disabled={disabled} />
      )}

      {writer.error && <p className="form-error">{writer.error}</p>}

      <div className="rvc-send">
        {replyTo
          ? <small>Replies inherit their parent&rsquo;s timecode</small>
          : (
            <label className="rvc-pin">
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
              {pinned ? `Pinned to ${timecode(startMs ?? positionMs)}` : "Not pinned to a time"}
            </label>
          )}
        <button type="submit" disabled={disabled || writer.busy} aria-label="Send comment">
          <Send size={14} />
        </button>
      </div>
    </form>
  );
}

export function RevisionForm({ writer, positionMs, onDone }: { writer: ReviewWriter; positionMs: number; onDone: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="rvc-revision"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await writer.requestChanges(text, positionMs)) onDone();
      }}
    >
      <label htmlFor="rv-revision">What needs to change?</label>
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
