"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  Check, ChevronLeft, CircleCheck, CornerDownRight, Film, Maximize2, MessageSquareText,
  Pause, Play, Send, TriangleAlert,
} from "lucide-react";
import type { ReviewNote, ReviewView } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import { postCommentAction, resolveCommentAction, type ActionState } from "./actions";

const initialState: ActionState = { error: null };

export function ReviewWorkspace({ view }: { view: ReviewView }) {
  const video = useRef<HTMLVideoElement>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replyTo, setReplyTo] = useState<ReviewNote | null>(null);
  /** The proxy 404s until the worker has transcoded it; the stage says so instead of failing silently. */
  const [mediaError, setMediaError] = useState(false);

  const seek = (ms: number) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = ms / 1000;
    setPositionMs(ms);
  };

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const scrub = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!durationMs) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
  };

  const progress = durationMs ? (positionMs / durationMs) * 100 : 0;
  const open = view.notes.filter((note) => !note.resolved).length;

  return (
    <>
      <div className="review-header">
        <Link href="/projects"><ChevronLeft />Projects</Link>
        <div>
          <strong>{view.projectName || "No project"}</strong>
          <span>/</span>
          <span>{view.version ? `${view.version.title} · V${view.version.version_number}` : "No cut selected"}</span>
        </div>
        {view.version?.current_stage && <span className="rv-stage">{view.version.current_stage.name}</span>}
        <button className="button secondary" type="button"><Check />Approve</button>
      </div>

      {view.notice && (
        <p className="rv-notice"><TriangleAlert size={14} /><span>{view.notice}</span></p>
      )}

      {view.versions.length > 1 && (
        <nav className="rv-versions" aria-label="Versions">
          {view.versions.map((option) => (
            <Link
              key={option.id}
              href={`/review?project=${view.projectId}&version=${option.id}`}
              className={option.selected ? "selected" : ""}
              aria-current={option.selected ? "true" : undefined}
            >
              {option.label}<small>{option.stage}</small>
            </Link>
          ))}
        </nav>
      )}

      <div className="review-workspace">
        <section className="viewer">
          <div className="video-stage">
            {view.previewSrc && !mediaError ? (
              <video
                ref={video}
                src={view.previewSrc}
                playsInline
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setMediaError(true)}
                onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
                onLoadedMetadata={(event) => setDurationMs(event.currentTarget.duration * 1000)}
              />
            ) : (
              <div className="rv-placeholder">
                <Film size={30} />
                <p>{placeholderMessage(view, mediaError)}</p>
              </div>
            )}
            {view.version && <span>{view.version.file?.name ?? view.version.title}</span>}
          </div>

          <div className="player-controls">
            <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!view.previewSrc || mediaError}>
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            <strong>{timecode(positionMs)}</strong>
            <div className="scrub" onClick={scrub} role="presentation">
              <i style={{ width: `${progress}%` }} />
              {view.notes.map((note) =>
                note.startMs !== null && durationMs ? (
                  <button
                    key={note.id}
                    type="button"
                    className="rv-marker"
                    style={{ left: `${(note.startMs / durationMs) * 100}%` }}
                    title={`${note.timecode} — ${note.author}`}
                    aria-label={`Jump to ${note.timecode}`}
                    onClick={(event) => { event.stopPropagation(); seek(note.startMs!); }}
                  />
                ) : null,
              )}
            </div>
            <span>{timecode(durationMs)}</span>
            <button type="button" onClick={() => video.current?.requestFullscreen()} aria-label="Fullscreen"><Maximize2 /></button>
          </div>
        </section>

        <aside className="comments">
          <div className="comments-title">
            <h2><MessageSquareText />Comments</h2>
            <span>{view.notes.length ? `${open} open · ${view.notes.length} total` : "None yet"}</span>
          </div>

          <div className="comment-feed">
            {view.notes.length === 0 && <p className="rv-empty">No comments on this cut yet.</p>}
            {view.notes.map((note) => (
              <Note key={note.id} note={note} view={view} onSeek={seek} onReply={setReplyTo} />
            ))}
          </div>

          <Composer view={view} positionMs={positionMs} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
        </aside>
      </div>
    </>
  );
}

function placeholderMessage(view: ReviewView, mediaError: boolean): string {
  if (mediaError) return "The review proxy for this cut is still being generated. Refresh in a moment.";
  if (!view.version) return "No media has been uploaded to this project yet.";
  return "This cut has no preview available.";
}

function Note({ note, view, onSeek, onReply }: {
  note: ReviewNote; view: ReviewView;
  onSeek: (ms: number) => void; onReply: (note: ReviewNote) => void;
}) {
  const [state, action, pending] = useActionState(resolveCommentAction, initialState);
  return (
    <article className={note.resolved ? "rv-resolved" : undefined}>
      <div className="comment-meta">
        <span>{note.initials}</span>
        <strong>{note.author}</strong>
        <small>{note.age}</small>
      </div>
      <p>
        {note.timecode && (
          <b onClick={() => note.startMs !== null && onSeek(note.startMs)} role="button" tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && note.startMs !== null && onSeek(note.startMs)}>
            {note.timecode}
          </b>
        )}
        {note.text}
      </p>

      {note.replies.map((reply) => (
        <div className="rv-reply" key={reply.id}>
          <CornerDownRight size={12} />
          <div>
            <div className="comment-meta"><strong>{reply.author}</strong><small>{reply.age}</small></div>
            <p>{reply.text}</p>
          </div>
        </div>
      ))}

      <div className="rv-note-actions">
        <button type="button" onClick={() => onReply(note)}>Reply</button>
        {view.projectId && (
          <form action={action}>
            <input type="hidden" name="workspaceId" value={view.workspaceId ?? ""} />
            <input type="hidden" name="projectId" value={view.projectId} />
            <input type="hidden" name="versionId" value={view.version?.id ?? ""} />
            <input type="hidden" name="commentId" value={note.id} />
            <input type="hidden" name="resolved" value={String(!note.resolved)} />
            <button type="submit" disabled={pending} className={note.resolved ? "rv-reopen" : "rv-resolve"}>
              <CircleCheck size={12} />{note.resolved ? "Reopen" : "Resolve"}
            </button>
          </form>
        )}
      </div>
      {state.error && <p className="form-error">{state.error}</p>}
    </article>
  );
}

function Composer({ view, positionMs, replyTo, onCancelReply }: {
  view: ReviewView; positionMs: number; replyTo: ReviewNote | null; onCancelReply: () => void;
}) {
  const [state, action, pending] = useActionState(postCommentAction, initialState);
  const form = useRef<HTMLFormElement>(null);

  // The action revalidates the page rather than returning the new note, so the textarea
  // is cleared once a submit lands without an error.
  useEffect(() => {
    if (!pending && !state.error) form.current?.reset();
  }, [pending, state.error]);

  const disabled = !view.canComment || !view.projectId;

  return (
    <form className="comment-box" action={action} ref={form}>
      <input type="hidden" name="workspaceId" value={view.workspaceId ?? ""} />
      <input type="hidden" name="projectId" value={view.projectId ?? ""} />
      <input type="hidden" name="versionId" value={view.version?.id ?? ""} />
      <input type="hidden" name="parentCommentId" value={replyTo?.id ?? ""} />
      <input type="hidden" name="atMs" value={Math.round(positionMs)} />

      {replyTo && (
        <div className="rv-replying">
          Replying to {replyTo.author}
          <button type="button" onClick={onCancelReply}>Cancel</button>
        </div>
      )}
      <textarea
        name="text"
        aria-label="Comment"
        disabled={disabled}
        placeholder={disabled ? "Comments are unavailable for this cut." : `Leave a comment at ${timecode(positionMs)}…`}
      />
      {state.error && <p className="form-error">{state.error}</p>}
      <div>
        <small>{replyTo ? "Replies inherit their parent's timecode" : `Pinned to ${timecode(positionMs)}`}</small>
        <button type="submit" aria-label="Send comment" disabled={disabled || pending}><Send /></button>
      </div>
    </form>
  );
}
