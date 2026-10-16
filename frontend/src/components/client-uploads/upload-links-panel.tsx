"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, Copy, ExternalLink, FolderInput, Link2, Loader2, Plus, Power, TriangleAlert, X } from "lucide-react";
import {
  UPLOAD_KINDS, createUploadLink, formatBytes, linkSummary, listClientUploads, listUploadLinks, localInputToIso,
  megabytesToBytes, revokeUploadLink, shortDateTime, type ClientUploadRow, type UploadKind, type UploadLink,
} from "@/lib/client-uploads";
import "./client-uploads.css";

const noopSubscribe = () => () => {};

type Load = { state: "loading" } | { state: "denied"; message: string } | { state: "error"; message: string } | { state: "ready" };

function CreateForm({ workspaceId, projectId, onCreated, onCancel }: { workspaceId: string; projectId: string; onCreated: (link: UploadLink) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("Send us your footage");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [closes, setCloses] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [kinds, setKinds] = useState<UploadKind[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await createUploadLink(workspaceId, projectId, {
      label: label.trim(), instructions: instructions.trim(), due_at: localInputToIso(due), expires_at: localInputToIso(closes),
      max_file_bytes: megabytesToBytes(maxMb), allowed_kinds: kinds,
    });
    setSaving(false);
    if (result.ok) onCreated(result.data);
    else setError(result.error);
  };

  const toggle = (kind: UploadKind) => setKinds((current) => (current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]));

  return (
    <form className="ulp-form" onSubmit={submit} aria-label="New upload link">
      <div className="ulp-form-grid">
        <label className="is-wide"><span className="ulp-l">Label</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={150} required /></label>
        <label className="is-wide"><span className="ulp-l">Instructions <em>optional</em></span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={2} maxLength={2000} placeholder="Raw camera files and your logo pack, please." /></label>
        <label><span className="ulp-l">Deadline <em>optional</em></span><input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label>
        <label><span className="ulp-l">Link closes <em>optional</em></span><input type="datetime-local" value={closes} onChange={(event) => setCloses(event.target.value)} /></label>
        <label><span className="ulp-l">Max file size <em>MB, optional</em></span><input inputMode="decimal" value={maxMb} onChange={(event) => setMaxMb(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="No extra limit" /></label>
        <fieldset>
          <legend><span className="ulp-l">Accepts <em>none ticked = everything</em></span></legend>
          <div className="ulp-kinds">
            {UPLOAD_KINDS.map((kind) => (
              <label key={kind.value} className={kinds.includes(kind.value) ? "is-on" : ""}>
                <input type="checkbox" checked={kinds.includes(kind.value)} onChange={() => toggle(kind.value)} />{kind.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {error && <p className="ulp-error" role="alert"><TriangleAlert size={13} aria-hidden="true" />{error}</p>}
      <div className="ulp-form-actions">
        <button type="button" className="ulp-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ulp-primary" disabled={saving || !label.trim()}>{saving ? <Loader2 size={14} className="ulp-spin" /> : <Link2 size={14} />}Create link</button>
      </div>
    </form>
  );
}

function LinkRow({ link, origin, onRevoke }: { link: UploadLink; origin: string; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${origin}${link.path}`;
  const live = link.status === "active";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked: the field is selectable */ }
  };
  const rules = [
    link.allowed_kinds.length ? link.allowed_kinds.map((kind) => UPLOAD_KINDS.find((entry) => entry.value === kind)?.label).join(", ") : "Any file",
    link.max_file_bytes ? `up to ${formatBytes(link.max_file_bytes)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className={`ulp-link is-${link.status}`}>
      <div className="ulp-link-head">
        <div className="ulp-link-title">
          <strong>{link.label}</strong>
          <span className={`ulp-pill is-${link.status}`}>{link.status === "revoked" ? "Off" : link.status === "expired" ? "Expired" : "Live"}</span>
        </div>
        <small>{linkSummary(link)}{link.last_upload_at ? ` · last ${shortDateTime(link.last_upload_at)}` : ""}</small>
        <small className="ulp-rules">{rules}</small>
      </div>
      {live && (
        <div className="ulp-url">
          <input readOnly value={url} aria-label={`Link for ${link.label}`} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="ulp-ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
          <a className="ulp-ghost is-icon" href={link.path} target="_blank" rel="noreferrer" aria-label="Open the upload page"><ExternalLink size={14} /></a>
          <button type="button" className="ulp-ghost is-danger" onClick={onRevoke}><Power size={14} />Turn off</button>
        </div>
      )}
    </li>
  );
}

/**
 * The "Client uploads" tab of a project: upload links (create, copy, turn off) and every
 * file clients have sent in, newest first. Needs project.update and project_file.create;
 * anyone else gets a plain explanation instead of a broken form.
 */
export function UploadLinksPanel({ workspaceId, projectId, projectName }: { workspaceId: string; projectId: string; projectName: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [links, setLinks] = useState<UploadLink[]>([]);
  const [uploads, setUploads] = useState<ClientUploadRow[]>([]);
  const [creating, setCreating] = useState(false);
  // The page's own origin, so a copied link works wherever this app is served from.
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listUploadLinks(workspaceId, projectId), listClientUploads(workspaceId, projectId)]).then(([linkResult, uploadResult]) => {
      if (cancelled) return;
      if (!linkResult.ok) {
        setLoad(linkResult.status === 403
          ? { state: "denied", message: "Only people who can edit this project can create upload links." }
          : { state: "error", message: linkResult.error });
        return;
      }
      setLinks(linkResult.data);
      setUploads(uploadResult.ok ? uploadResult.data : []);
      setLoad({ state: "ready" });
    });
    return () => { cancelled = true; };
  }, [workspaceId, projectId]);

  const revoke = async (link: UploadLink) => {
    if (!window.confirm(`Turn off "${link.label}"? Anyone with the link will no longer be able to send files.`)) return;
    const result = await revokeUploadLink(workspaceId, projectId, link.id);
    if (result.ok) setLinks((current) => current.map((entry) => (entry.id === link.id ? result.data : entry)));
    else setNotice(result.error);
  };

  const folderId = uploads.find((row) => row.folder_id)?.folder_id;
  const live = links.filter((link) => link.status === "active");
  const closed = links.filter((link) => link.status !== "active");

  return (
    <section className="ulp" aria-labelledby="ulp-title">
      <div className="ulp-head">
        <div>
          <h2 id="ulp-title"><FolderInput size={16} aria-hidden="true" />Client uploads</h2>
          <p>Share a link and clients can send footage, references and brand files to {projectName} without an account. Everything lands in the project&rsquo;s <b>From client</b> folder.</p>
        </div>
        {load.state === "ready" && !creating && <button type="button" className="ulp-primary" onClick={() => setCreating(true)}><Plus size={14} />New upload link</button>}
      </div>

      {load.state === "loading" && <p className="ulp-muted" role="status"><Loader2 size={14} className="ulp-spin" />Loading upload links…</p>}
      {(load.state === "denied" || load.state === "error") && <p className="ulp-error" role="alert"><TriangleAlert size={13} aria-hidden="true" />{load.message}</p>}
      {notice && <p className="ulp-error" role="alert"><TriangleAlert size={13} aria-hidden="true" />{notice}<button type="button" className="cu-icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={12} /></button></p>}

      {load.state === "ready" && (
        <div className="ulp-columns">
          <div className="ulp-col">
            <h3>Links <span>{live.length} live</span></h3>
            {creating && <CreateForm workspaceId={workspaceId} projectId={projectId} onCancel={() => setCreating(false)} onCreated={(link) => { setLinks((current) => [link, ...current]); setCreating(false); }} />}
            {links.length === 0 && !creating && (
              <div className="ulp-empty"><Link2 size={18} aria-hidden="true" /><strong>No upload links yet</strong><p>Create one and send it to your client: they pick files, add their name, and you get notified.</p></div>
            )}
            <ul className="ulp-links">
              {[...live, ...closed].map((link) => <LinkRow key={link.id} link={link} origin={origin} onRevoke={() => void revoke(link)} />)}
            </ul>
          </div>
          <div className="ulp-col">
            <h3>Received <span>{uploads.length}</span>{folderId && <Link className="ulp-folder-link" href={`/files?folder=${folderId}`}>Open folder</Link>}</h3>
            {uploads.length === 0
              ? <div className="ulp-empty"><FolderInput size={18} aria-hidden="true" /><strong>Nothing received yet</strong><p>Files clients send show up here with who sent them.</p></div>
              : <ul className="ulp-received">
                {uploads.map((row) => (
                  <li key={row.id} className={row.removed ? "is-removed" : ""}>
                    <div className="ulp-file"><strong title={row.file_name}>{row.file_name}</strong><small>{formatBytes(row.size_bytes)}</small></div>
                    <p className="ulp-sender">
                      <b>{row.uploader_name}</b> <span title={row.uploader_email}>{row.uploader_email}</span>
                      <span> · {row.via === "link" ? `via ${row.upload_link_label ?? "upload link"}` : "client portal"} · {shortDateTime(row.created_at)}</span>
                    </p>
                  </li>
                ))}
              </ul>}
          </div>
        </div>
      )}
    </section>
  );
}
