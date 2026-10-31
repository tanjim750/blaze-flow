"use client";

/**
 * Frame-style share modal. What is real vs. not yet backed:
 *  - Private link (workspace members only): the in-app URL, copy only — always works.
 *  - Public link: creates a project guest invite (`createGuestInviteAction`), wiring
 *    Sharing one file (`assetFileId`) scopes the link to that file's review version: if the
 *    file is not published yet, the owner confirms and it is published first, and the link
 *    carries `&cut=<version>` so the guest lands on exactly that file.
 *    comments → "comment" preset, downloads → "review" preset (the only preset with
 *    `media.download`), and expiry → `expires_in_hours`. Needs a project to scope it to.
 *  - Email invite, passphrase and watermark have no backend yet, so they render disabled.
 */
import { useActionState, useState } from "react";
import { Check, Copy, Globe, Lock } from "@/components/icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { createGuestInviteAction } from "@/app/(app)/review/actions";
import { emptyGuestInviteState, type GuestPreset } from "@/app/(app)/review/guest-presets";
import { copyText } from "./frame-ui";
import { Select } from "@/components/ui/select";

/** Maps the toggles onto the backend's guest presets (downloads imply full review). */
export function presetFor(allowComments: boolean, allowDownloads: boolean): GuestPreset {
  if (allowDownloads) return "review";
  return allowComments ? "comment" : "view";
}

export function ShareModal({ open, onOpenChange, title, internalUrl, workspaceId, projectId, assetFileId, canCreateLinks }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; internalUrl: string;
  workspaceId?: string | null; projectId?: string | null; assetFileId?: string | null; canCreateLinks: boolean;
}) {
  const [access, setAccess] = useState<"private" | "public">("private");
  const [comments, setComments] = useState(true);
  const [downloads, setDownloads] = useState(false);
  const [expires, setExpires] = useState(false);
  const [days, setDays] = useState(7);
  const [copied, setCopied] = useState(false);
  const [state, create, pending] = useActionState(createGuestInviteAction, emptyGuestInviteState);
  const scoped = Boolean(workspaceId && projectId);
  const publicAllowed = canCreateLinks && scoped;
  const publicUrl = state.token && typeof window !== "undefined" ? `${window.location.origin}/guest-review?token=${state.token}${state.mediaVersionId ? `&cut=${state.mediaVersionId}` : ""}` : "";
  const link = access === "public" ? publicUrl : internalUrl;

  const copy = async () => { if (link && await copyText(link)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frm-share">
        <DialogClose />
        <DialogTitle>Share “{title}”</DialogTitle>
        <DialogDescription>{access === "private" ? "Only people in this workspace can open the link." : "Anyone with the link can open it as a guest."}</DialogDescription>

        <div className="frm-share-access" role="radiogroup" aria-label="Link access">
          <button type="button" role="radio" aria-checked={access === "private"} className={access === "private" ? "is-on" : ""} onClick={() => setAccess("private")}><Lock /> Private</button>
          <button type="button" role="radio" aria-checked={access === "public"} className={access === "public" ? "is-on" : ""} onClick={() => setAccess("public")} disabled={!publicAllowed} title={publicAllowed ? undefined : scoped ? "Only owners and editors can create public links" : "Open a project to create a public link"}><Globe /> Public</button>
        </div>

        <div className="frm-share-link">
          <input readOnly value={link || (access === "public" ? "Create a link below" : "")} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy} disabled={!link}>{copied ? <Check /> : <Copy />}<span>{copied ? "Copied" : "Copy"}</span></button>
        </div>

        {access === "public" && (
          <form action={create} className="frm-share-form">
            <input type="hidden" name="workspaceId" value={workspaceId ?? ""} />
            <input type="hidden" name="projectId" value={projectId ?? ""} />
            <input type="hidden" name="label" value={title} />
            <input type="hidden" name="preset" value={presetFor(comments, downloads)} />
            <input type="hidden" name="expiresInDays" value={expires ? days : 365} />
            {assetFileId && <input type="hidden" name="assetFileId" value={assetFileId} />}
            {state.needsPublish && <input type="hidden" name="publishFile" value="on" />}
            <ul className="frm-share-opts">
              <li><span>Allow comments</span><Switch checked={comments || downloads} onCheckedChange={setComments} label="Allow comments" /></li>
              <li><span>Allow downloads</span><Switch checked={downloads} onCheckedChange={setDownloads} label="Allow downloads" /></li>
              <li><span>Expires</span><span className="frm-share-exp">{expires && <Select aria-label="Expiry" value={String(days)} onValueChange={(next) => setDays(Number(next))} options={[1, 7, 30, 90].map((d) => ({ value: String(d), label: `${d} day${d === 1 ? "" : "s"}` }))} />}<Switch checked={expires} onCheckedChange={setExpires} label="Link expires" /></span></li>
              {/* TODO(backend): guest invites have no passphrase or watermark fields yet. */}
              <li className="is-todo" title="Not available yet"><span>Passphrase <small>Coming soon</small></span><Switch checked={false} onCheckedChange={() => {}} label="Passphrase (coming soon)" /></li>
              <li className="is-todo" title="Not available yet"><span>Watermark <small>Coming soon</small></span><Switch checked={false} onCheckedChange={() => {}} label="Watermark (coming soon)" /></li>
            </ul>
            {state.error && <p className="frm-share-err" role="alert">{state.error}</p>}
            {state.needsPublish && !publicUrl && (
              <p className="frm-share-warn" role="alert">
                <strong>“{title}” isn’t published yet.</strong> Guests only see review versions, so this link would open with nothing to watch. Publish it to the project as a review version and create the link?
              </p>
            )}
            <button type="submit" className="frm-share-create" disabled={pending}>{pending ? (state.needsPublish ? "Publishing…" : "Creating…") : publicUrl ? "Create another link" : state.needsPublish ? "Publish & create link" : "Create public link"}</button>
          </form>
        )}

        {/* TODO(backend): no endpoint sends share emails; invites are links only. */}
        <div className="frm-share-email" title="Not available yet">
          <input type="email" placeholder="Invite by email — coming soon" disabled aria-label="Invite by email (coming soon)" />
          <button type="button" disabled>Send</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
