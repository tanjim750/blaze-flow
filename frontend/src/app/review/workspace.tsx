"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  Check, ChevronLeft, Circle, CircleCheck, CornerDownRight, Crosshair, Film, Maximize2, MessageSquareText,
  MoveUpRight, Paperclip, Pause, PencilLine, Play, RotateCcw, Send, Share2, SmilePlus, Square, Trash2, TriangleAlert, Type,
} from "lucide-react";
import type { ReviewNote, ReviewView } from "@/lib/review-view";
import type { AnnotationElement } from "@/lib/api";
import { timecode } from "@/lib/timecode";
import { addAnnotationAction, addPointAnnotationAction, deleteAnnotationAction, postCommentAction, reactToCommentAction, recolorAnnotationAction, requestRevisionAction, resolveCommentAction, transitionVersionAction, updateAnnotationElementsAction, type ActionState } from "./actions";
import { SharePanel } from "./share-panel";

const initialState: ActionState = { error: null };

export function ReviewWorkspace({ view, currentUserId, initialShareOpen = false }: { view: ReviewView; currentUserId: string | null; initialShareOpen?: boolean }) {
  const [transitionState, transitionAction, transitioning] = useActionState(transitionVersionAction, initialState);
  const video = useRef<HTMLVideoElement>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replyTo, setReplyTo] = useState<ReviewNote | null>(null);
  /** The proxy 404s until the worker has transcoded it; the stage says so instead of failing silently. */
  const [mediaError, setMediaError] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionState, revisionAction, revising] = useActionState(requestRevisionAction, initialState);
  const [annotationTool, setAnnotationTool] = useState<"POINT" | "RECTANGLE" | "ELLIPSE" | "ARROW" | "PATH" | "TEXT" | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [pathPoints, setPathPoints] = useState<{ x: number; y: number }[]>([]);
  const [annotationError, setAnnotationError] = useState("");
  const [, startAnnotation] = useTransition();
  const [shareOpen, setShareOpen] = useState(initialShareOpen);

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
        {view.workspaceId && view.projectId && (
          <button type="button" className="button secondary rv-share-open" onClick={() => setShareOpen(!shareOpen)} aria-pressed={shareOpen}>
            <Share2 />Client review link
          </button>
        )}
        {view.version && view.workspaceId && view.projectId && view.stages.length > 0 && (
          <form action={transitionAction} className="rv-transition">
            <input type="hidden" name="workspaceId" value={view.workspaceId} />
            <input type="hidden" name="projectId" value={view.projectId} />
            <input type="hidden" name="versionId" value={view.version.id} />
            <select name="stageId" aria-label="Next workflow stage" defaultValue={view.stages.find((stage) => stage.isApproval)?.id ?? ""} required>
              <option value="" disabled>Move to…</option>
              {view.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
            <button className="button secondary" disabled={transitioning}><Check />{transitioning ? "Moving…" : "Apply stage"}</button>
          </form>
        )}
      </div>

      {shareOpen && view.workspaceId && view.projectId && (
        <SharePanel
          workspaceId={view.workspaceId}
          projectId={view.projectId}
          projectName={view.projectName}
          invites={view.guestInvites}
          canManage={view.canManageGuests}
          onClose={() => setShareOpen(false)}
        />
      )}

      {transitionState.error && <p className="form-error rv-transition-error" role="alert">{transitionState.error}</p>}
      {revisionOpen && view.workspaceId && view.projectId && view.version && <form action={revisionAction} className="rv-revision-form"><input type="hidden" name="workspaceId" value={view.workspaceId} /><input type="hidden" name="projectId" value={view.projectId} /><input type="hidden" name="versionId" value={view.version.id} /><input type="hidden" name="atMs" value={Math.round(positionMs)} /><textarea name="text" required autoFocus placeholder={`Describe the revision requested at ${timecode(positionMs)}…`} />{revisionState.error && <p className="form-error">{revisionState.error}</p>}<div><button type="button" onClick={() => setRevisionOpen(false)}>Cancel</button><button disabled={revising}><RotateCcw />{revising ? "Requesting…" : "Request revision"}</button></div></form>}

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
            <svg className="rv-annotation-canvas" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><marker id="rv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ffcf5a" /></marker></defs>{view.annotations.flatMap((annotation) => annotation.elements.map((element, index) => <AnnotationShape key={`${annotation.id}-${index}`} annotationId={annotation.id} element={element} canDelete={Boolean(view.workspaceId && view.projectId && view.version)} onDelete={() => startAnnotation(async () => { const result = await deleteAnnotationAction(view.workspaceId!, view.projectId!, view.version!.id, annotation.id); if (result.error) setAnnotationError(result.error); })} />))}</svg>
            {annotationTool && view.workspaceId && view.projectId && view.version && <div className="rv-annotation-layer" role="application" aria-label={`Draw ${annotationTool.toLowerCase()} annotation`} onPointerDown={(event) => { const point = normalizedPoint(event); setDrawStart(point); setPathPoints([point]); }} onPointerMove={(event) => { if (drawStart && annotationTool === "PATH" && event.buttons) setPathPoints((points) => [...points, normalizedPoint(event)]); }} onPointerUp={(event) => { if (!drawStart) return; const end = normalizedPoint(event); const tool = annotationTool; const geometry = annotationGeometry(tool, drawStart, end, pathPoints); setDrawStart(null); setPathPoints([]); if (!geometry) return; const text = tool === "TEXT" ? prompt("Annotation text")?.trim() : ""; if (tool === "TEXT" && !text) return; startAnnotation(async () => { const result = tool === "POINT" ? await addPointAnnotationAction(view.workspaceId!, view.projectId!, view.version!.id, end.x, end.y, positionMs) : await addAnnotationAction(view.workspaceId!, view.projectId!, view.version!.id, { element_type: tool, geometry, style: { color: "#ffcf5a", stroke_width: 2 }, payload: text ? { text } : {} }, positionMs); if (result.error) setAnnotationError(result.error); }); }} />}
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
            <div className="rv-toolset">{([['POINT', Crosshair], ['RECTANGLE', Square], ['ELLIPSE', Circle], ['ARROW', MoveUpRight], ['PATH', PencilLine], ['TEXT', Type]] as const).map(([tool, Icon]) => <button key={tool} type="button" className={annotationTool === tool ? "selected" : ""} onClick={() => setAnnotationTool(annotationTool === tool ? null : tool)} aria-pressed={annotationTool === tool} aria-label={`Draw ${tool.toLowerCase()}`}><Icon /></button>)}</div>
          </div>
          {annotationError && <p className="form-error">{annotationError}</p>}
          {view.annotations.length > 0 && <div className="rv-annotation-list">{view.annotations.map((annotation, index) => { const kind = annotation.elements[0]?.element_type; return <span key={annotation.id}><b>#{index + 1} {kind?.toLowerCase()}</b>{annotation.author_user_id === currentUserId && <><button title="Change color" onClick={() => startAnnotation(async () => { const colors = ["#ffcf5a", "#69d6ff", "#ff78b9"]; const current = String(annotation.elements[0]?.style.color ?? colors[0]); const result = await recolorAnnotationAction(view.workspaceId!, view.projectId!, view.version!.id, annotation.id, annotation.elements, colors[(colors.indexOf(current) + 1) % colors.length]); if (result.error) setAnnotationError(result.error); })}><PencilLine /></button>{(kind === "RECTANGLE" || kind === "ELLIPSE") && <button title="Resize geometry" onClick={() => startAnnotation(async () => { const elements = annotation.elements.map((element) => element.element_type === kind ? { ...element, geometry: { ...element.geometry, width: Math.min(1 - Number(element.geometry.x), Number(element.geometry.width) * 1.15), height: Math.min(1 - Number(element.geometry.y), Number(element.geometry.height) * 1.15) } } : element); const result = await updateAnnotationElementsAction(view.workspaceId!, view.projectId!, view.version!.id, annotation.id, elements); if (result.error) setAnnotationError(result.error); })}>↗</button>}</>}<button title="Delete annotation" onClick={() => startAnnotation(async () => { const result = await deleteAnnotationAction(view.workspaceId!, view.projectId!, view.version!.id, annotation.id); if (result.error) setAnnotationError(result.error); })}><Trash2 /></button></span>; })}</div>}
        </section>

        <aside className="comments">
          <div className="comments-title">
            <h2><MessageSquareText />Comments</h2>
            <div><span>{view.notes.length ? `${open} open · ${view.notes.length} total` : "None yet"}</span>{view.version && <button onClick={() => setRevisionOpen(!revisionOpen)}><RotateCcw />Revision</button>}</div>
          </div>

          <div className="comment-feed">
            {view.notes.length === 0 && <p className="rv-empty">No comments on this cut yet.</p>}
            {view.notes.map((note) => (
              <Note key={note.id} note={note} view={view} currentUserId={currentUserId} onSeek={seek} onReply={setReplyTo} />
            ))}
          </div>

          <Composer view={view} positionMs={positionMs} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
        </aside>
      </div>
    </>
  );
}

function normalizedPoint(event: React.PointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}

function annotationGeometry(tool: "POINT" | "RECTANGLE" | "ELLIPSE" | "ARROW" | "PATH" | "TEXT", start: { x: number; y: number }, end: { x: number; y: number }, path: { x: number; y: number }[]): Record<string, unknown> | null {
  if (tool === "POINT" || tool === "TEXT") return end;
  if (tool === "ARROW") return { start, end };
  if (tool === "PATH") return path.length > 1 ? { points: [...path, end].slice(0, 500) } : null;
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
  return width > .005 && height > .005 ? { x, y, width, height } : null;
}

function AnnotationShape({ element, onDelete, canDelete }: { annotationId: string; element: AnnotationElement; onDelete: () => void; canDelete: boolean }) {
  const g = element.geometry; const color = String(element.style.color ?? "#ffcf5a");
  const common = { fill: "none", stroke: color, strokeWidth: Number(element.style.stroke_width ?? 2), vectorEffect: "non-scaling-stroke" as const };
  let shape: React.ReactNode = null;
  if (element.element_type === "POINT") shape = <circle cx={Number(g.x) * 100} cy={Number(g.y) * 100} r="1.5" {...common} fill="#121216" />;
  if (element.element_type === "RECTANGLE") shape = <rect x={Number(g.x) * 100} y={Number(g.y) * 100} width={Number(g.width) * 100} height={Number(g.height) * 100} {...common} />;
  if (element.element_type === "ELLIPSE") shape = <ellipse cx={(Number(g.x) + Number(g.width) / 2) * 100} cy={(Number(g.y) + Number(g.height) / 2) * 100} rx={Number(g.width) * 50} ry={Number(g.height) * 50} {...common} />;
  if (element.element_type === "ARROW") { const start = g.start as Record<string, number>, end = g.end as Record<string, number>; shape = <line x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} markerEnd="url(#rv-arrow)" {...common} />; }
  if (element.element_type === "PATH") shape = <polyline points={(g.points as { x: number; y: number }[]).map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} {...common} />;
  if (element.element_type === "TEXT") shape = <text x={Number(g.x) * 100} y={Number(g.y) * 100} fill={color} stroke="none" fontSize="4">{String(element.payload.text ?? "")}</text>;
  return <g className="rv-shape" onDoubleClick={canDelete ? onDelete : undefined}>{shape}<title>{canDelete ? "Double-click to delete" : element.element_type}</title></g>;
}

function placeholderMessage(view: ReviewView, mediaError: boolean): string {
  if (mediaError) return "The review proxy for this cut is still being generated. Refresh in a moment.";
  if (!view.version) return "No media has been uploaded to this project yet.";
  return "This cut has no preview available.";
}

function csrfToken(): string {
  const match = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return match ? decodeURIComponent(match.slice("csrftoken=".length)) : "";
}

function Note({ note, view, currentUserId, onSeek, onReply }: {
  note: ReviewNote; view: ReviewView; currentUserId: string | null;
  onSeek: (ms: number) => void; onReply: (note: ReviewNote) => void;
}) {
  const [state, action, pending] = useActionState(resolveCommentAction, initialState);
  const [reactionError, setReactionError] = useState(""); const [reacting, startReaction] = useTransition();
  const [attachmentError, setAttachmentError] = useState("");
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const attachmentBase = view.workspaceId && view.projectId && view.version
    ? `/api/workspaces/${view.workspaceId}/projects/${view.projectId}/media-versions/${view.version.id}/comments/${note.id}/attachments`
    : null;

  async function uploadAttachment(file: File | undefined) {
    if (!file || !attachmentBase) return;
    setUploading(true); setAttachmentError("");
    const body = new FormData(); body.set("file", file);
    try {
      const response = await fetch(`${attachmentBase}/`, { method: "POST", body, credentials: "include", headers: { "X-CSRFToken": csrfToken() } });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        setAttachmentError(payload?.detail || `Upload failed (${response.status}).`);
      } else router.refresh();
    } catch { setAttachmentError("The attachment upload could not reach Blaze Flow."); }
    finally { setUploading(false); }
  }
  async function removeAttachment(id: string, name: string) {
    if (!attachmentBase || !confirm(`Delete ${name}?`)) return; setAttachmentError("");
    try { const response = await fetch(`${attachmentBase}/${id}/`, { method: "DELETE", credentials: "include", headers: { "X-CSRFToken": csrfToken() } }); if (!response.ok) { const payload = await response.json().catch(() => null) as { detail?: string } | null; setAttachmentError(payload?.detail || `Delete failed (${response.status}).`); } else router.refresh(); }
    catch { setAttachmentError("The attachment could not be deleted."); }
  }
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

      {note.attachments.length > 0 && <div className="rv-attachments">{note.attachments.map((attachment) => <span key={attachment.id}>{attachment.status === "READY" && attachmentBase ? <a href={`${attachmentBase}/${attachment.id}/`}><Paperclip />{attachment.name}</a> : <><Paperclip />{attachment.name} · {attachment.status.toLowerCase().replaceAll("_", " ")}</>}{attachmentBase && <button onClick={() => void removeAttachment(attachment.id, attachment.name)} aria-label={`Delete ${attachment.name}`}><Trash2 /></button>}</span>)}</div>}

      <div className="rv-note-actions">
        <button type="button" onClick={() => onReply(note)}>Reply</button>
        {note.authorId === currentUserId && attachmentBase && <label className="rv-attach"><Paperclip size={12} />{uploading ? "Uploading…" : "Attach"}<input type="file" disabled={uploading} onChange={(event) => void uploadAttachment(event.target.files?.[0])} /></label>}
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
      <div className="rv-reactions">{note.reactions.map((reaction) => <button key={reaction.emoji} disabled={reacting} onClick={() => view.workspaceId && view.projectId && view.version && startReaction(async () => { const result = await reactToCommentAction(view.workspaceId!, view.projectId!, view.version!.id, note.id, reaction.emoji); if (result.error) setReactionError(result.error); })}>{reaction.emoji} {reaction.count}</button>)}<button aria-label="React with thumbs up" disabled={reacting || !view.workspaceId} onClick={() => view.workspaceId && view.projectId && view.version && startReaction(async () => { const result = await reactToCommentAction(view.workspaceId!, view.projectId!, view.version!.id, note.id, "👍"); if (result.error) setReactionError(result.error); })}><SmilePlus />+</button></div>
      {reactionError && <p className="form-error">{reactionError}</p>}
      {attachmentError && <p className="form-error">{attachmentError}</p>}
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
