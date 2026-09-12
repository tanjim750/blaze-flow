"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Link2, TriangleAlert, UserMinus, X } from "lucide-react";
import type { GuestInvite } from "@/lib/api";
import {
  createGuestInviteAction, emptyGuestInviteState, GUEST_PRESETS,
  revokeGuestAccessAction, revokeGuestInviteAction,
} from "./actions";

/** Stable regardless of the viewer's locale, so the server and client markup agree. */
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

type InviteStatus = { label: string; tone: "live" | "ended" };

function statusOf(invite: GuestInvite): InviteStatus {
  if (invite.revoked_at) return { label: "Revoked", tone: "ended" };
  if (new Date(invite.expires_at).getTime() < Date.now()) return { label: "Expired", tone: "ended" };
  return { label: `Expires ${day(invite.expires_at)}`, tone: "live" };
}

/**
 * Client review links for the open project.
 *
 * A link is a bearer credential: the token is returned exactly once, at creation, and the
 * API keeps only its hash. So the panel shows the full URL immediately after creating it
 * and never again — the list below can show that a link exists and revoke it, but cannot
 * reproduce it.
 */
export function SharePanel({ workspaceId, projectId, projectName, invites, canManage, onClose }: {
  workspaceId: string; projectId: string; projectName: string;
  invites: GuestInvite[]; canManage: boolean; onClose: () => void;
}) {
  const [state, submit, creating] = useActionState(createGuestInviteAction, emptyGuestInviteState);
  const [copied, setCopied] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [revoking, startRevoke] = useTransition();
  // The action only produces a token in the browser, so the guarded origin stays safe
  // during the server render while still making the copied link absolute.
  const shareUrl = state.token ? `${typeof window === "undefined" ? "" : window.location.origin}/guest-review?token=${state.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="rv-share" aria-label="Client review links">
      <header>
        <div><Link2 size={15} /><strong>Client review links</strong></div>
        <button type="button" onClick={onClose} aria-label="Close share panel"><X size={15} /></button>
      </header>

      {!canManage ? (
        <p className="rv-share-empty">You do not have permission to share this project.</p>
      ) : (
        <>
          <form action={submit} className="rv-share-form">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="projectId" value={projectId} />
            <label>
              <span>Label</span>
              <input name="label" maxLength={255} placeholder={`${projectName} client review`} />
            </label>
            <label>
              <span>Access</span>
              <select name="preset" defaultValue="comment">
                {Object.entries(GUEST_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label} — {preset.description}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Expires in (days)</span>
              <input name="expiresInDays" type="number" min={1} max={365} defaultValue={7} required />
            </label>
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
            <button className="button" disabled={creating}>{creating ? "Creating…" : "Create link"}</button>
          </form>

          {state.token && (
            <div className="rv-share-token" role="status">
              <p><TriangleAlert size={13} /> Copy this now — it is shown only once.</p>
              <div>
                <input readOnly value={shareUrl} aria-label="Client review link" onFocus={(event) => event.currentTarget.select()} />
                <button type="button" onClick={copy} aria-label="Copy link">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {revokeError && <p className="form-error" role="alert">{revokeError}</p>}

      <ul className="rv-share-list">
        {invites.length === 0 && canManage && <li className="rv-share-empty">No links yet.</li>}
        {invites.map((invite) => {
          const status = statusOf(invite);
          const active = invite.accesses.filter((access) => !access.revoked_at);
          return (
            <li key={invite.id}>
              <div className="rv-share-row">
                <div>
                  <strong>{invite.label || "Untitled link"}</strong>
                  <small className={status.tone === "live" ? "" : "is-ended"}>
                    {status.label} · {invite.permissions.length} permissions · {active.length} {active.length === 1 ? "reviewer" : "reviewers"}
                  </small>
                </div>
                {!invite.revoked_at && (
                  <button
                    type="button"
                    disabled={revoking}
                    onClick={() => startRevoke(async () => {
                      const result = await revokeGuestInviteAction(workspaceId, projectId, invite.id);
                      setRevokeError(result.error ?? "");
                    })}
                  >
                    Revoke link
                  </button>
                )}
              </div>
              {invite.accesses.length > 0 && (
                <ul className="rv-share-guests">
                  {invite.accesses.map((access) => (
                    <li key={access.id}>
                      <div>
                        <span>{access.name}</span>
                        <small>
                          {access.email}
                          {access.revoked_at
                            ? " · revoked"
                            : access.last_accessed_at ? ` · last seen ${day(access.last_accessed_at)}` : " · not opened yet"}
                        </small>
                      </div>
                      {!access.revoked_at && (
                        <button
                          type="button"
                          disabled={revoking}
                          aria-label={`Revoke access for ${access.name}`}
                          onClick={() => startRevoke(async () => {
                            const result = await revokeGuestAccessAction(workspaceId, projectId, access.id);
                            setRevokeError(result.error ?? "");
                          })}
                        >
                          <UserMinus size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
