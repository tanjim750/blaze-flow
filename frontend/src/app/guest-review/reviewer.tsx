"use client";

/* This component deliberately hydrates a browser-only bearer session, then refreshes
   remote review data when that session/version changes. Those effects are subscriptions
   to sessionStorage and the API, not derived-state effects. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, Check, CornerDownRight, Film, Loader, LogOut, MessageSquareText, Paperclip,
  RotateCcw, Send, SmilePlus, Trash2, TriangleAlert,
} from "@/components/icons";
import { nestNotes, type ReviewNote } from "@/lib/review-notes";
import {
  changeMessageProblem, decisionLine, guestBarActions, MESSAGE_MAX_LENGTH, openNotesWarning, overrideWarning,
} from "@/lib/review-decisions";
import { reviewSurface } from "@/lib/open-in-review";
import { timecode } from "@/lib/timecode";
import { RichBrief } from "@/components/brief/rich-brief";
import { briefIsEmpty, briefToPlainText } from "@/lib/rich-brief";
import { rangeLabel } from "@/lib/annotation-window";
import { ConfirmDialog } from "@/components/tasks/task-dialogs";
import { proxyNotice } from "@/app/(app)/review/player-state";
import { GuestFolders } from "./guest-folders";
import type { AnnotationElement } from "@/lib/api";
import { Player, type DrawnAnnotation, type PlayerHandle, type PlayerSource } from "@/app/(app)/review/player";
import { KrewsysLogo } from "@/components/brand/krewsys-logo";
import {
  clearGuestSession, createGuestComment, createGuestDecision, deleteGuestComment, downloadGuestAttachment,
  editGuestComment, exchangeGuestInvite, getGuestPlayback, listGuestAnnotations, createGuestAnnotation, deleteGuestAnnotation, listGuestComments, loadGuestReview,
  guestEmailProblem, readGuestSession, REMEMBER_DAYS, setGuestReaction, uploadGuestAttachment, writeGuestSession,
  type GuestMediaVersion, type GuestPlayback, type GuestReview, type GuestSession,
  isMissingGuestPermission,
} from "@/lib/guest-client";

const REACTIONS = ["👍", "🎉", "👀"];
const noop = () => {};

/**
 * The public review surface a client opens from a shared link.
 *
 * Everything here runs in the browser. A guest has no Django session — authentication is
 * the access key exchanged from the invite token — so no part of this page can be
 * rendered on the server with the reviewer's identity attached.
 */
const NO_ANNOTATIONS: DrawnAnnotation[] = [];

export function GuestReviewer({ token, cut = null }: { token: string; cut?: string | null }) {
  /** sessionStorage is browser-only, so the stored session is read after hydration. */
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [review, setReview] = useState<GuestReview | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playback, setPlayback] = useState<{ versionId: string; data: GuestPlayback | null; error: string } | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [briefOpen, setBriefOpen] = useState(false);
  const player = useRef<PlayerHandle>(null);

  useEffect(() => {
    setMounted(true);
    setSession(readGuestSession(token));
  }, [token]);

  /** Reloads the project, its cuts and each cut's decision; keeps the cut on screen. */
  const reload = useCallback(async (keepVersion: boolean) => {
    if (!session) return;
    const result = await loadGuestReview(session.projectId, session.accessKey);
    if (!result.ok) {
      // A revoked or expired link fails here; sending the reviewer back to the form
      // would just loop, so the message stands on its own.
      setError(result.error);
      return;
    }
    setReview(result.data);
    if (!keepVersion) {
      const versions = result.data.media_versions;
      const target = cut ?? session.cut ?? null;
      setVersionId((target && versions.some((item) => item.id === target) ? target : versions.at(-1)?.id) ?? null);
    }
  }, [session, cut]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    void reload(false).finally(() => setLoading(false));
  }, [session, reload]);

  // Wait for the review so we know what the link may read: a view-only link without
  // note access must not ask for notes (that 403 used to show as a pink banner).
  const canReadComments = review ? review.viewer?.can_read_comments !== false : null;
  const canReadAnnotations = review ? review.viewer?.can_read_annotations !== false : null;
  const refresh = useCallback(async () => {
    if (!session || !versionId || !canReadComments) return;
    const result = await listGuestComments(session.projectId, versionId, session.accessKey);
    if (result.ok) setNotes(nestNotes(result.data));
    else if (isMissingGuestPermission(result.error)) setNotes([]);
    else setError(result.error);
  }, [session, versionId, canReadComments]);

  useEffect(() => { void refresh(); }, [refresh]);

  // B4: drawings are part of the notes, so a guest sees them on every link, view-only included.
  const [drawings, setDrawings] = useState<{ versionId: string; items: DrawnAnnotation[] } | null>(null);
  useEffect(() => {
    if (!session || !versionId || !canReadAnnotations) return;
    let live = true;
    void listGuestAnnotations(session.projectId, versionId, session.accessKey).then((result) => {
      if (!live || !result.ok) return;
      setDrawings({ versionId, items: result.data.map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms, endMs: item.end_time_ms, noteId: item.review_comment_id })) });
    });
    return () => { live = false; };
  }, [session, versionId, notes, canReadAnnotations]);
  const annotations = drawings && drawings.versionId === versionId ? drawings.items : NO_ANNOTATIONS;

  // A drawing waits here until the note it belongs to is posted (same as internal review).
  const [pending, setPending] = useState<AnnotationElement[] | null>(null);
  const [pendingAt, setPendingAt] = useState<number | null>(null);
  const drawPending = useCallback((elements: AnnotationElement[] | null) => {
    const next = elements && elements.length ? elements : null;
    setPendingAt((at) => (next ? at ?? Math.round(player.current?.position() ?? 0) : null));
    setPending(next);
  }, []);
  const removeDrawing = useCallback(async (id: string) => {
    if (!session || !versionId) return;
    const result = await deleteGuestAnnotation(session.projectId, versionId, session.accessKey, id);
    if (!result.ok) setError(result.error);
    else setDrawings((current) => current && { ...current, items: current.items.filter((item) => item.id !== id) });
  }, [session, versionId]);

  // The player source is a signed URL for this guest and this cut, fetched per cut.
  useEffect(() => {
    if (!session || !versionId) return;
    let live = true;
    void getGuestPlayback(session.projectId, versionId, session.accessKey).then((result) => {
      if (!live) return;
      setPlayback({ versionId, data: result.ok ? result.data : null, error: result.ok ? "" : result.error });
    });
    return () => { live = false; };
  }, [session, versionId]);

  const version = review?.media_versions.find((item) => item.id === versionId) ?? null;
  const sources = useMemo<PlayerSource[]>(
    () => (playback?.data && playback.versionId === versionId ? [{ id: "preview", label: "Preview", src: playback.data.url }] : []),
    [playback, versionId],
  );

  if (!token) {
    return (
      <Card title="This review link is incomplete">
        <p>The address is missing its token. Mail clients sometimes cut long links in half — open the
          original link again, or ask for a new one.</p>
      </Card>
    );
  }

  if (!mounted) return <Card title="Opening review…"><p className="gr-muted">One moment.</p></Card>;

  if (!session) {
    return <Identify token={token} onIdentified={setSession} />;
  }

  const canComment = review?.viewer?.can_comment ?? true;
  // Drawing rides on a note, so it needs both: tools hide on links with comments off.
  const canAnnotate = canComment && Boolean(review?.viewer?.can_annotate);
  // A project can hold several cuts; name them when "V2" alone would be ambiguous.
  const manyTitles = new Set(review?.media_versions.map((item) => item.title)).size > 1;
  const pendingPlayback = !playback || playback.versionId !== versionId;

  return (
    <div className="gr-shell">
      <header className="gr-topbar">
        <div className="gr-brand"><KrewsysLogo height={28} /></div>
        <div className="gr-project">
          <strong>{review?.project.name ?? "Loading…"}</strong>
          {review?.project.description && !briefIsEmpty(review.project.description) && (
            <button type="button" className="gr-brief-toggle" aria-expanded={briefOpen} aria-controls="gr-brief" onClick={() => setBriefOpen((open) => !open)}>
              <small>{briefToPlainText(review.project.description)}</small><span>{briefOpen ? "Hide brief" : "Read brief"}</span>
            </button>
          )}
        </div>
        <div className="gr-who">
          {review?.viewer?.can_download_folders && review.folders && review.folders.length > 0 && (
            <GuestFolders projectId={session.projectId} accessKey={session.accessKey} folders={review.folders} />
          )}
          <span>{session.name}</span>
          <button
            type="button"
            onClick={() => { clearGuestSession(token); setSession(null); setReview(null); setNotes([]); setPlayback(null); }}
          >
            <LogOut size={13} />Leave
          </button>
        </div>
      </header>

      {briefOpen && review?.project.description && (
        <section id="gr-brief" className="gr-brief" aria-label="Project brief"><RichBrief value={review.project.description} /></section>
      )}

      {error && <p className="gr-error" role="alert"><TriangleAlert size={14} />{error}</p>}

      <div className="gr-body">
        <section className="gr-viewer">
          <div className="gr-viewer-bar">
            {review && review.media_versions.length > 1 && (
              <div className="gr-versions" role="tablist" aria-label="Cuts">
                {review.media_versions.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={item.id === versionId}
                    className={item.id === versionId ? "selected" : ""}
                    onClick={() => { setVersionId(item.id); setNotes([]); setPositionMs(0); drawPending(null); }}
                  >
                    {manyTitles && <span className="gr-version-title">{item.title}</span>}
                    V{item.version_number}
                    {item.decision?.decision === "approved" && <Check size={11} aria-label="approved" />}
                  </button>
                ))}
              </div>
            )}
            {version && session && review && (
              <DecisionBar
                key={version.id}
                session={session}
                version={version}
                canDecide={Boolean(review.viewer?.can_decide)}
                positionMs={positionMs}
                onDecided={async () => { setError(""); await Promise.all([reload(true), refresh()]); }}
                onError={setError}
              />
            )}
          </div>

          {sources.length > 0 && version ? (
            <div className="gr-player rv">
              <Player
                key={version.id}
                handle={player}
                sources={sources}
                surface={reviewSurface(playback?.data?.mime_type ?? "video/mp4", version.title)}
                title={version.title}
                notes={notes}
                annotations={annotations}
                pending={pending}
                pendingWindow={pending && pendingAt !== null ? { startMs: pendingAt, endMs: pendingAt } : null}
                canDraw={canAnnotate}
                onTime={setPositionMs}
                onMeta={noop}
                onDraw={drawPending}
                onDeleteAnnotation={(id) => void removeDrawing(id)}
                onFocusNote={noop}
              />
            </div>
          ) : (
            <div className="gr-stage">
              {loading || (versionId && pendingPlayback) ? <Loader size={22} className="gr-spin" /> : <Film size={26} />}
              <strong>{version?.title ?? (loading ? "Loading…" : review && review.media_versions.length === 0 ? "Nothing has been shared for review yet" : "No cut available")}</strong>
              {!loading && review && review.media_versions.length === 0 && (
                <small className="gr-empty-hint">Nothing has been uploaded to {review.project.name} for review yet. Ask the person who sent this link to upload the file, then reload this page.</small>
              )}
              {(() => {
                // A failed proxy is said plainly, not left as "still being prepared".
                const notice = !loading && version && !(versionId && pendingPlayback) ? proxyNotice(version.preview_status) : null;
                return notice && <small className={`gr-proxy is-${notice.tone}`} role="status">{notice.title.replace(" — re-render", "")}. {notice.detail}</small>;
              })()}
              {playback?.error && playback.versionId === versionId && !proxyNotice(version?.preview_status) && <small>{playback.error}</small>}
            </div>
          )}
        </section>

        <section className="gr-notes">
          <header>
            <h2><MessageSquareText size={16} />Notes</h2>
            <span>{notes.length} {notes.length === 1 ? "thread" : "threads"}</span>
          </header>

          <div className="gr-feed">
            {notes.length === 0 && <p className="gr-muted">{canComment ? "No notes yet. Add the first one below." : "No notes yet."}</p>}
            {notes.map((note) => (
              <Note
                key={note.id}
                note={note}
                session={session}
                versionId={versionId}
                canComment={canComment}
                onSeek={(ms) => player.current?.seek(ms)}
                onChanged={refresh}
                onError={setError}
              />
            ))}
          </div>

          {versionId && !canComment && (
            <p className="gr-readonly-note" data-testid="guest-view-only">This link is view-only, so you can watch and read notes but not add or reply to them.</p>
          )}
          {versionId && canComment && (
            <Composer
              session={session}
              versionId={versionId}
              parent={null}
              positionMs={sources.length > 0 ? (pendingAt ?? positionMs) : null}
              drawing={canAnnotate ? pending : null}
              onClearDrawing={() => drawPending(null)}
              placeholder={sources.length > 0 ? `Note at ${timecode(pendingAt ?? positionMs)}…` : "Leave a note for the team…"}
              onPosted={async () => { drawPending(null); await refresh(); }}
              onError={setError}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Approve / Request changes on exactly the cut on screen, and what was decided.
 *
 * Shown only when the link allows decisions; the server checks again (revoked and expired
 * links fail there). A decision belongs to this version: a newer cut starts undecided.
 */
function DecisionBar({ session, version, canDecide, positionMs, onDecided, onError }: {
  session: GuestSession; version: GuestMediaVersion; canDecide: boolean; positionMs: number;
  onDecided: () => Promise<void>; onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const latest = version.decision ?? null;
  const actions = guestBarActions(canDecide, latest);
  const label = `V${version.version_number}`;
  const warning = openNotesWarning(version.open_notes ?? 0, label);

  const decide = async (decision: "approved" | "changes_requested") => {
    setBusy(true);
    // A reversal was shown its warning first (overrideWarning), so it goes out confirmed.
    const confirm = latest && latest.decision !== decision ? { confirm_override: true } : {};
    const result = await createGuestDecision(session.projectId, version.id, session.accessKey,
      decision === "approved" ? { decision, ...confirm } : { decision, ...(message.trim() ? { message: message.trim() } : {}), start_time_ms: Math.max(0, Math.round(positionMs)), ...confirm });
    setBusy(false);
    if (!result.ok) {
      if (decision === "approved") setConfirming(false);
      onError(result.error);
      return;
    }
    setConfirming(false); setRequesting(false); setMessage(""); setProblem("");
    await onDecided();
  };

  if (!latest && !actions.approve && !actions.requestChanges) return null;

  return (
    <div className="gr-decision">
      {latest && (
        <p className={`gr-decision-state is-${latest.decision}`} role="status" data-testid="guest-decision-state">
          {latest.decision === "approved" ? <BadgeCheck size={14} /> : <RotateCcw size={13} />}
          {decisionLine(latest)}
        </p>
      )}
      {actions.requestChanges && (
        <button type="button" className="gr-decide" onClick={() => setRequesting(!requesting)} aria-expanded={requesting} disabled={busy}>
          <RotateCcw size={13} />Request changes
        </button>
      )}
      {actions.approve && (
        <button type="button" className="gr-decide is-approve" onClick={() => { onError(""); setConfirming(true); }} disabled={busy}>
          <Check size={13} />Approve {label}
        </button>
      )}

      {requesting && (
        <form
          className="gr-request"
          onSubmit={(event) => {
            event.preventDefault();
            const why = changeMessageProblem(message);
            setProblem(why ?? "");
            if (!why) void decide("changes_requested");
          }}
        >
          {overrideWarning(latest, "changes_requested") && <p className="rv-confirm-warn" role="alert"><TriangleAlert size={14} /><span>{overrideWarning(latest, "changes_requested")}</span></p>}
          <label htmlFor="gr-request-text">What should change in {label}? <small>Optional · pinned at {timecode(positionMs)}</small></label>
          <textarea
            id="gr-request-text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={MESSAGE_MAX_LENGTH}
            rows={3}
            autoFocus
            placeholder="e.g. The logo sting runs long — trim it by a second."
          />
          {problem && <p className="gr-request-problem" role="alert">{problem}</p>}
          <div>
            <button type="button" onClick={() => { setRequesting(false); setProblem(""); }}>Cancel</button>
            <button disabled={busy}>{busy ? "Sending…" : "Send change request"}</button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Approve ${label} of “${version.title}”?`}
        body={<>Your approval is recorded against <strong>{label}</strong> only, and the team is notified. If they upload a newer version, it will need its own approval.</>}
        confirmLabel={busy ? "Approving…" : `Approve ${label}`}
        busy={busy}
        onConfirm={() => void decide("approved")}
        onCancel={() => setConfirming(false)}
      >
        {warning && (
          <p className="rv-confirm-warn" role="alert"><TriangleAlert size={14} /><span>{warning}</span></p>
        )}
        {overrideWarning(latest, "approved") && (
          <p className="rv-confirm-warn" role="alert"><TriangleAlert size={14} /><span>{overrideWarning(latest, "approved")}</span></p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** Name and email are recorded against every note the guest leaves, so both are required. */
function Identify({ token, onIdentified }: { token: string; onIdentified: (session: GuestSession) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = guestEmailProblem(email);
    setEmailError(problem ?? "");
    if (problem) return;
    setBusy(true);
    setError("");
    const result = await exchangeGuestInvite(token, name.trim(), email.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const session: GuestSession = {
      token,
      projectId: result.data.project_id,
      guestSessionId: result.data.guest_session_id,
      accessKey: result.data.access_key,
      name: name.trim(),
      cut: result.data.media_version_id ?? null,
    };
    // Persist before rendering the review: the key is never returned again.
    writeGuestSession(session, { remember });
    onIdentified(session);
  };

  return (
    <Card title="Join the review">
      <p className="gr-muted">Tell the team who is reviewing. Your name appears on every note you leave.</p>
      <form onSubmit={submit} className="gr-form" noValidate>
        <label>
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={150} autoComplete="name" />
        </label>
        <label>
          <span>Email</span>
          <input value={email} onChange={(event) => { setEmail(event.target.value); if (emailError) setEmailError(guestEmailProblem(event.target.value) ?? ""); }}
            onBlur={() => { if (email.trim()) setEmailError(guestEmailProblem(email) ?? ""); }}
            required type="email" maxLength={255} autoComplete="email" inputMode="email"
            aria-invalid={Boolean(emailError)} aria-describedby={emailError ? "gr-email-error" : undefined} />
          {emailError && <small id="gr-email-error" className="gr-field-error" role="alert">{emailError}</small>}
        </label>
        <label className="gr-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>Remember me on this device for {REMEMBER_DAYS} days <small>Untick on a shared computer.</small></span>
        </label>
        {error && <p className="gr-error" role="alert"><TriangleAlert size={14} />{error}</p>}
        <button disabled={busy || !name.trim() || !email.trim()}>{busy ? "Opening…" : "Open review"}</button>
      </form>
    </Card>
  );
}

function Note({ note, session, versionId, canComment, onSeek, onChanged, onError, depth = 0 }: {
  /** B4: reply and react only when the link grants comments; counts still show read-only. */
  canComment: boolean;
  note: ReviewNote; session: GuestSession; versionId: string | null; onSeek: (ms: number) => void;
  onChanged: () => Promise<void>; onError: (message: string) => void; depth?: number;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** The backend scopes edit and delete to the guest's own session; the UI matches it. */
  const mine = note.guestSessionId !== null && note.guestSessionId === session.guestSessionId;

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.ok) onError(result.error ?? "That did not work.");
    else { onError(""); await onChanged(); }
  };

  if (!versionId) return null;

  return (
    <article className={depth ? "gr-note is-reply" : "gr-note"}>
      <div className="gr-note-head">
        <span className="gr-avatar">{note.initials}</span>
        <div>
          <strong>{note.author}</strong>
          <small>
            {note.timecode && note.startMs !== null
              ? <button type="button" className="gr-timecode" onClick={() => onSeek(note.startMs ?? 0)}>{note.endMs ? rangeLabel(note.startMs, note.endMs) : note.timecode}</button>
              : null}
            {note.timecode ? " · " : ""}{note.age}{note.resolved ? " · resolved" : ""}
          </small>
        </div>
      </div>

      {editing ? (
        <form
          className="gr-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await editGuestComment(session.projectId, versionId, session.accessKey, note.id, draft.trim());
              if (result.ok) setEditing(false);
              return result;
            });
          }}
        >
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} required />
          <div>
            <button type="button" onClick={() => { setEditing(false); setDraft(note.text); }}>Cancel</button>
            <button disabled={busy || !draft.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <p>{note.text}</p>
      )}

      {note.attachments.length > 0 && (
        <ul className="gr-attachments">
          {note.attachments.map((attachment) => (
            <li key={attachment.id}>
              <button
                type="button"
                disabled={attachment.status !== "READY"}
                onClick={() => void downloadGuestAttachment(session.projectId, attachment.id, session.accessKey, attachment.name)}
              >
                <Paperclip size={12} />{attachment.name}
                {attachment.status !== "READY" && <em> · processing</em>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="gr-note-actions">
        {REACTIONS.map((emoji) => {
          const count = note.reactions.find((reaction) => reaction.emoji === emoji)?.count ?? 0;
          if (!canComment && count === 0) return null;
          return (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              aria-disabled={!canComment || undefined}
              className={canComment ? undefined : "is-readonly"}
              aria-label={canComment ? `React ${emoji}` : `${count} ${emoji}`}
              onClick={() => canComment && void run(() => setGuestReaction(session.projectId, versionId, session.accessKey, note.id, emoji))}
            >
              {emoji}{count > 0 && <b>{count}</b>}
            </button>
          );
        })}
        {canComment && (
          <button type="button" onClick={() => setReplying(!replying)} aria-expanded={replying}>
            <CornerDownRight size={12} />Reply
          </button>
        )}
        {mine && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach a file">
              <Paperclip size={12} />
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label="Delete note"
              onClick={() => void run(() => deleteGuestComment(session.projectId, versionId, session.accessKey, note.id))}
            >
              <Trash2 size={12} />
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void run(() => uploadGuestAttachment(session.projectId, versionId, session.accessKey, note.id, file));
              }}
            />
          </>
        )}
        {canComment && !note.reactions.length && <SmilePlus size={12} className="gr-hint" aria-hidden />}
      </div>

      {canComment && replying && (
        <Composer
          session={session}
          versionId={versionId}
          parent={note.id}
          positionMs={null}
          placeholder={`Reply to ${note.author}…`}
          onPosted={async () => { setReplying(false); await onChanged(); }}
          onError={onError}
        />
      )}

      {note.replies.map((reply) => (
        <Note key={reply.id} note={reply} session={session} versionId={versionId} canComment={canComment} onSeek={onSeek} onChanged={onChanged} onError={onError} depth={depth + 1} />
      ))}
    </article>
  );
}

function Composer({ session, versionId, parent, positionMs, placeholder, onPosted, onError, drawing = null, onClearDrawing }: {
  session: GuestSession; versionId: string; parent: string | null;
  /** The drawing waiting on the player; posted with this note and attached to it. */
  drawing?: AnnotationElement[] | null; onClearDrawing?: () => void;
  /** Where a new top-level note is pinned; null for replies and when nothing is playing. */
  positionMs: number | null; placeholder: string;
  onPosted: () => Promise<void>; onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const result = await createGuestComment(session.projectId, versionId, session.accessKey, {
      text: body,
      ...(parent ? { parent_comment_id: parent } : {}),
      ...(!parent && positionMs !== null ? { start_time_ms: Math.max(0, Math.round(positionMs)) } : {}),
    });
    if (!result.ok) { setBusy(false); onError(result.error); return; }
    if (drawing && drawing.length) {
      const drawn = await createGuestAnnotation(session.projectId, versionId, session.accessKey, {
        review_comment_id: result.data.id, start_time_ms: Math.max(0, Math.round(positionMs ?? 0)),
        elements: drawing.map((element) => { const { id: _id, ...rest } = element; void _id; return rest; }),
      });
      if (!drawn.ok) { setBusy(false); onError(`Note posted, but the drawing was not saved: ${drawn.error}`); await onPosted(); return; }
    }
    setBusy(false);
    onError("");
    setText("");
    await onPosted();
  };

  return (
    <form className="gr-composer" onSubmit={submit}>
      {drawing && drawing.length > 0 && (
        <p className="gr-drawing-chip" data-testid="guest-pending-drawing">
          Drawing attached · {drawing.length} {drawing.length === 1 ? "mark" : "marks"}
          {onClearDrawing && <button type="button" onClick={onClearDrawing}>Clear drawing</button>}
        </p>
      )}
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} rows={parent ? 2 : 3} />
      <button disabled={busy || !text.trim()} aria-label="Post note"><Send size={14} /></button>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="gr-card-wrap">
      <div className="gr-card">
        <div className="gr-brand"><KrewsysLogo height={28} /></div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
