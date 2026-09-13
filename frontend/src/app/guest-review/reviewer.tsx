"use client";

/* This component deliberately hydrates a browser-only bearer session, then refreshes
   remote review data when that session/version changes. Those effects are subscriptions
   to sessionStorage and the API, not derived-state effects. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CornerDownRight, Film, Flame, Loader, LogOut, MessageSquareText, Paperclip,
  Send, SmilePlus, Trash2, TriangleAlert,
} from "lucide-react";
import { nestNotes, type ReviewNote } from "@/lib/review-notes";
import {
  clearGuestSession, createGuestComment, deleteGuestComment, downloadGuestAttachment,
  editGuestComment, exchangeGuestInvite, listGuestComments, loadGuestReview,
  readGuestSession, setGuestReaction, uploadGuestAttachment, writeGuestSession,
  type GuestReview, type GuestSession,
} from "@/lib/guest-client";

const REACTIONS = ["👍", "🎉", "👀"];

/**
 * The public review surface a client opens from a shared link.
 *
 * Everything here runs in the browser. A guest has no Django session — authentication is
 * the access key exchanged from the invite token — so no part of this page can be
 * rendered on the server with the reviewer's identity attached.
 */
export function GuestReviewer({ token }: { token: string }) {
  /** sessionStorage is browser-only, so the stored session is read after hydration. */
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [review, setReview] = useState<GuestReview | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSession(readGuestSession(token));
  }, [token]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    setLoading(true);
    void loadGuestReview(session.projectId, session.accessKey).then((result) => {
      if (!live) return;
      setLoading(false);
      if (!result.ok) {
        // A revoked or expired link fails here; sending the reviewer back to the form
        // would just loop, so the message stands on its own.
        setError(result.error);
        return;
      }
      setReview(result.data);
      setVersionId(result.data.media_versions.at(-1)?.id ?? null);
    });
    return () => { live = false; };
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session || !versionId) return;
    const result = await listGuestComments(session.projectId, versionId, session.accessKey);
    if (result.ok) setNotes(nestNotes(result.data));
    else setError(result.error);
  }, [session, versionId]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  return (
    <div className="gr-shell">
      <header className="gr-topbar">
        <div className="gr-brand"><span><Flame size={15} /></span><strong>Blaze Flow</strong></div>
        <div className="gr-project">
          <strong>{review?.project.name ?? "Loading…"}</strong>
          {review?.project.description && <small>{review.project.description}</small>}
        </div>
        <div className="gr-who">
          <span>{session.name}</span>
          <button
            type="button"
            onClick={() => { clearGuestSession(token); setSession(null); setReview(null); setNotes([]); }}
          >
            <LogOut size={13} />Leave
          </button>
        </div>
      </header>

      {error && <p className="gr-error" role="alert"><TriangleAlert size={14} />{error}</p>}

      <div className="gr-body">
        <section className="gr-viewer">
          {review && review.media_versions.length > 1 && (
            <div className="gr-versions" role="tablist" aria-label="Cuts">
              {review.media_versions.map((version) => (
                <button
                  key={version.id}
                  role="tab"
                  aria-selected={version.id === versionId}
                  className={version.id === versionId ? "selected" : ""}
                  onClick={() => { setVersionId(version.id); setNotes([]); }}
                >
                  V{version.version_number}
                </button>
              ))}
            </div>
          )}

          {/*
            Guest links carry `media.read`, but the API exposes no endpoint that streams
            media bytes to a guest — `media-versions/<id>/preview/` is session-authenticated.
            Saying so is better than an empty player that looks broken.
          */}
          <div className="gr-stage">
            {loading ? <Loader size={22} className="gr-spin" /> : <Film size={26} />}
            <strong>
              {review?.media_versions.find((version) => version.id === versionId)?.title ?? "No cut available"}
            </strong>
            <small>Playback is not yet available through a review link. Notes below are live.</small>
          </div>
        </section>

        <section className="gr-notes">
          <header>
            <h2><MessageSquareText size={16} />Notes</h2>
            <span>{notes.length} {notes.length === 1 ? "thread" : "threads"}</span>
          </header>

          <div className="gr-feed">
            {notes.length === 0 && <p className="gr-muted">No notes yet. Add the first one below.</p>}
            {notes.map((note) => (
              <Note
                key={note.id}
                note={note}
                session={session}
                versionId={versionId}
                onChanged={refresh}
                onError={setError}
              />
            ))}
          </div>

          {versionId && (
            <Composer
              session={session}
              versionId={versionId}
              parent={null}
              placeholder="Leave a note for the team…"
              onPosted={refresh}
              onError={setError}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** Name and email are recorded against every note the guest leaves, so both are required. */
function Identify({ token, onIdentified }: { token: string; onIdentified: (session: GuestSession) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
    };
    // Persist before rendering the review: the key is never returned again.
    writeGuestSession(session);
    onIdentified(session);
  };

  return (
    <Card title="Join the review">
      <p className="gr-muted">Tell the team who is reviewing. Your name appears on every note you leave.</p>
      <form onSubmit={submit} className="gr-form">
        <label>
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={150} autoComplete="name" />
        </label>
        <label>
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} required type="email" maxLength={255} autoComplete="email" />
        </label>
        {error && <p className="gr-error" role="alert"><TriangleAlert size={14} />{error}</p>}
        <button disabled={busy || !name.trim() || !email.trim()}>{busy ? "Opening…" : "Open review"}</button>
      </form>
    </Card>
  );
}

function Note({ note, session, versionId, onChanged, onError, depth = 0 }: {
  note: ReviewNote; session: GuestSession; versionId: string | null;
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
          <small>{note.timecode ? `${note.timecode} · ` : ""}{note.age}{note.resolved ? " · resolved" : ""}</small>
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
          return (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              aria-label={`React ${emoji}`}
              onClick={() => void run(() => setGuestReaction(session.projectId, versionId, session.accessKey, note.id, emoji))}
            >
              {emoji}{count > 0 && <b>{count}</b>}
            </button>
          );
        })}
        <button type="button" onClick={() => setReplying(!replying)} aria-expanded={replying}>
          <CornerDownRight size={12} />Reply
        </button>
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
        {!note.reactions.length && <SmilePlus size={12} className="gr-hint" aria-hidden />}
      </div>

      {replying && (
        <Composer
          session={session}
          versionId={versionId}
          parent={note.id}
          placeholder={`Reply to ${note.author}…`}
          onPosted={async () => { setReplying(false); await onChanged(); }}
          onError={onError}
        />
      )}

      {note.replies.map((reply) => (
        <Note key={reply.id} note={reply} session={session} versionId={versionId} onChanged={onChanged} onError={onError} depth={depth + 1} />
      ))}
    </article>
  );
}

function Composer({ session, versionId, parent, placeholder, onPosted, onError }: {
  session: GuestSession; versionId: string; parent: string | null; placeholder: string;
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
    });
    setBusy(false);
    if (!result.ok) { onError(result.error); return; }
    onError("");
    setText("");
    await onPosted();
  };

  return (
    <form className="gr-composer" onSubmit={submit}>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} rows={parent ? 2 : 3} />
      <button disabled={busy || !text.trim()} aria-label="Post note"><Send size={14} /></button>
    </form>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="gr-card-wrap">
      <div className="gr-card">
        <div className="gr-brand"><span><Flame size={15} /></span><strong>Blaze Flow</strong></div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
