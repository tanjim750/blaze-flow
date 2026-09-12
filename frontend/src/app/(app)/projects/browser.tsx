"use client";

import Link from "next/link";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity, Building2, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Ellipsis, FileText, Folder,
  FolderOpen, Pencil, Plus, Search, Share2, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import type { ClientNode, ProjectsView } from "@/lib/projects-view";
import type { FilesView } from "@/lib/files-view";
import { AssetLibrary } from "@/components/asset-library";
import { LinkPending } from "@/components/nav-progress";
import { TasksBoard } from "@/app/(app)/tasks/board";
import type { TasksView } from "@/lib/tasks-view";
import "../tasks/tasks.css";
import { createCampaignAction, createClientAction, createFolderAction, type ActionState } from "./actions";

const initialState: ActionState = { error: null };
const TABS = ["Files", "Tasks", "Brief & Specs", "Activity Log"] as const;

export function ProjectsBrowser({ view, filesView, tasksView, initialTab }: { view: ProjectsView; filesView: FilesView; tasksView: TasksView; initialTab?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    () => TABS.find((value) => value.toLowerCase() === initialTab?.toLowerCase()) ?? "Files",
  );
  const [expanded, setExpanded] = useState<string[]>(view.selectedClient ? [view.selectedClient.id] : []);
  const [uploading, setUploading] = useState(false);
  const [railClosed, setRailClosed] = useState(false);

  return (
    <div className={railClosed ? "pb-layout is-rail-closed" : "pb-layout"}>
      <ClientRail view={view} expanded={expanded} setExpanded={setExpanded} closed={railClosed} onToggle={() => setRailClosed(!railClosed)} />

      <section className="pb-canvas">
        {view.notice && (
          <p className="pb-notice"><TriangleAlert size={14} /><span>{view.notice}</span></p>
        )}

        <div className="pb-canvas-head">
          <div className="pb-crumbs-row">
            <nav className="pb-crumbs" aria-label="Breadcrumb">
              <span>Projects</span><ChevronRight size={13} />
              <span>{view.selectedClient?.name ?? "—"}</span><ChevronRight size={13} />
              <b>{view.selectedCampaign?.name ?? "No campaign"}<Pencil size={11} /></b>
            </nav>
            {view.selectedCampaign ? (
              <Link className="pb-ghost-button" href={`/review?project=${view.selectedCampaign.id}&share=1`}>
                <Share2 size={14} />Client Review Link
              </Link>
            ) : (
              <button className="pb-ghost-button" type="button" disabled title="Select a campaign first"><Share2 size={14} />Client Review Link</button>
            )}
          </div>

          <div className="pb-title-row">
            <div className="pb-title">
              <span className="pb-monogram">{initials(view.selectedClient?.name ?? "Blaze Flow")}</span>
              <h1>{view.selectedCampaign?.name ?? "No campaign selected"}</h1>
            </div>
            <div className="pb-title-actions">
              <button className="pb-ghost-button pb-icon-only" type="button" aria-label="More actions"><Ellipsis size={15} /></button>
              <button className="pb-primary-button" type="button" disabled={!view.workspaceId || !view.selectedCampaign} onClick={() => setUploading(true)}><CloudUpload size={15} />+ Upload Asset</button>
            </div>
          </div>

          <div className="pb-tabs-row">
            <div className="pb-tabs" role="tablist">
              {TABS.map((value) => (
                <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "selected" : ""} onClick={() => setTab(value)}>
                  {value === "Files" && <FolderOpen size={14} />}
                  {value === "Brief & Specs" && <FileText size={14} />}
                  {value === "Activity Log" && <Activity size={14} />}
                  <span>{value}</span>
                </button>
              ))}
            </div>
            <small>{view.notice ? "Demo content" : "Synced just now"}</small>
          </div>
        </div>

        {tab === "Files" && view.selectedCampaign ? (
          <AssetLibrary compact view={filesView} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} clientId={view.selectedClient?.id ?? null} />
        ) : tab === "Tasks" && view.selectedCampaign ? (
          <TasksBoard compact view={tasksView} projectId={view.selectedCampaign.id} />
        ) : (
          <p className="pb-empty">The {tab} view is not built yet.</p>
        )}
      </section>
      {uploading && view.workspaceId && view.selectedCampaign && (
        <UploadDialog workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} onClose={() => setUploading(false)} onUploaded={() => { setUploading(false); router.refresh(); }} />
      )}
    </div>
  );
}

function csrfToken(): string {
  const match = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return match ? decodeURIComponent(match.slice("csrftoken=".length)) : "";
}

function UploadDialog({ workspaceId, projectId, projectName, onClose, onUploaded }: { workspaceId: string; projectId: string; projectName: string; onClose: () => void; onUploaded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/media-versions/`, {
        method: "POST", body: form, credentials: "include", headers: { "X-CSRFToken": csrfToken() },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        const detail = typeof body?.detail === "string" ? body.detail : Object.entries(body ?? {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" ") : String(value)}`).join(" ");
        setError(detail || `Upload failed (${response.status}).`); setBusy(false); return;
      }
      onUploaded();
    } catch { setError("The upload could not reach Blaze Flow. Try again."); setBusy(false); }
  }

  return <dialog ref={dialog} open className="pb-upload-dialog" onCancel={onClose} aria-labelledby="upload-title">
    <button type="button" className="pb-upload-backdrop" onClick={onClose} aria-label="Close upload dialog" />
    <form onSubmit={submit} className="pb-upload-panel">
      <header><div><p>New media version</p><h2 id="upload-title">Upload to {projectName}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <label className="pb-file-drop"><UploadCloud size={26} /><strong>Choose an asset</strong><span>PNG, JPEG, GIF, WebP, MP4, MOV, or WebM</span><input name="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm" required /></label>
      <label>Title<input name="title" placeholder="Spring campaign — hero cut" required /></label>
      <label>Notes<textarea name="note" rows={3} placeholder="What changed in this version?" /></label>
      <div className="pb-upload-options"><label>Priority<select name="priority" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label className="pb-check"><input name="allow_download" type="checkbox" value="true" />Allow downloads</label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}><CloudUpload size={15} />{busy ? "Uploading…" : "Upload asset"}</button></footer>
    </form>
  </dialog>;
}

function ClientRail({ view, expanded, setExpanded, closed, onToggle }: { view: ProjectsView; expanded: string[]; setExpanded: (value: string[]) => void; closed: boolean; onToggle: () => void }) {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [clientState, submitClient] = useActionState(createClientAction, initialState);
  const reduceMotion = useReducedMotion();

  const clients = view.clients.filter((client) => client.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setExpanded(expanded.includes(id) ? expanded.filter((value) => value !== id) : [...expanded, id]);

  return (
    <aside className="pb-rail">
      {/* Same handle as the main rail, but centred on the edge: anchored to the top it
          landed on the shell's own toggle once this rail closed to nothing. The wrapper
          owns the positioning so `whileTap`'s scale does not fight a translate. */}
      <div className="pb-rail-handle">
      <motion.button
        type="button"
        className="pb-rail-toggle"
        onClick={onToggle}
        aria-label={closed ? "Show clients" : "Hide clients"}
        aria-expanded={!closed}
        whileTap={reduceMotion ? undefined : { scale: 0.82 }}
        transition={{ type: "spring", stiffness: 620, damping: 14 }}
      >
        <ChevronLeft size={14} />
      </motion.button>
      </div>
      <div className="pb-rail-top">
        <div className="pb-rail-head">
          <h2><Building2 size={16} />Clients</h2>
          <button type="button" className="pb-new-button" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            <Plus size={13} />NEW
          </button>
        </div>

        <div className="pb-rail-search">
          <Search size={14} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter clients... ⌘K" aria-label="Filter clients" />
        </div>

        {creating && (
          <form action={submitClient} className="pb-inline-form">
            <input name="name" placeholder="New client name" aria-label="New client name" autoFocus required />
            <button type="submit">Create</button>
            {clientState.error && <small role="alert">{clientState.error}</small>}
          </form>
        )}

        <div className="pb-tree">
          {clients.map((client) => (
            <ClientBranch key={client.id} client={client} view={view} open={expanded.includes(client.id)} onToggle={() => toggle(client.id)} />
          ))}
          {!clients.length && <p className="pb-rail-empty">No clients match.</p>}
        </div>
      </div>

      <div className="pb-storage">
        <div className="pb-storage-head"><span><FolderOpen size={13} />Client Storage</span><b>56% used</b></div>
        <div className="pb-storage-track"><i style={{ width: "56.1%" }} /></div>
        <div className="pb-storage-foot"><span>842 GB / 1.5 TB</span><Link href="/settings">Manage Access</Link></div>
      </div>
    </aside>
  );
}

function ClientBranch({ client, view, open, onToggle }: { client: ClientNode; view: ProjectsView; open: boolean; onToggle: () => void }) {
  const [adding, setAdding] = useState(false);
  const [campaignState, submitCampaign] = useActionState(createCampaignAction, initialState);
  const isSelected = view.selectedClient?.id === client.id;

  return (
    <div className={open || isSelected ? "pb-client open" : "pb-client"}>
      <button type="button" className="pb-client-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="pb-client-mark">{client.initial}</span>
        <strong>{client.name}</strong>
        <b>{client.assetCount ? `${client.assetCount} assets` : `${client.campaigns.length} subs`}</b>
      </button>

      {open && (
        <div className="pb-subtree">
          {client.campaigns.map((campaign) => {
            const active = view.selectedCampaign?.id === campaign.id;
            return (
              <Link key={campaign.id} href={`/projects?client=${client.id}&campaign=${campaign.id}`} className={active ? "pb-sub active" : "pb-sub"}>
                {active ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{campaign.name}</span>
                <b>{campaign.assetCount || ""}</b>
                <LinkPending />
              </Link>
            );
          })}

          {adding ? (
            <form action={submitCampaign} className="pb-inline-form nested">
              <input type="hidden" name="clientId" value={client.id} />
              <input name="name" placeholder="e.g. March 2026" aria-label="New subfolder name" autoFocus required />
              <button type="submit">Add</button>
              {campaignState.error && <small role="alert">{campaignState.error}</small>}
            </form>
          ) : (
            <button type="button" className="pb-add-sub" onClick={() => setAdding(true)}>
              <Plus size={13} />+ Add Subfolder <span>(e.g. March 2026)</span>
            </button>
          )}

          {view.selectedCampaign && isSelected && <NestedFolders view={view} />}
        </div>
      )}
    </div>
  );
}

/** Folders inside the selected campaign — the "and so on" level below a subfolder. */
function NestedFolders({ view }: { view: ProjectsView }) {
  const [adding, setAdding] = useState(false);
  const [folderState, submitFolder] = useActionState(createFolderAction, initialState);
  const campaign = view.selectedCampaign!;
  const roots = campaign.folders.filter((folder) => !folder.parentId);
  if (!roots.length && !adding) {
    return <button type="button" className="pb-add-sub subtle" onClick={() => setAdding(true)}><Plus size={12} />Add folder in {campaign.name}</button>;
  }
  return (
    <div className="pb-nested">
      {roots.map((folder) => (
        <span key={folder.id} className="pb-nested-row"><Folder size={12} />{folder.name}</span>
      ))}
      {adding ? (
        <form action={submitFolder} className="pb-inline-form nested">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input name="name" placeholder="Folder name" aria-label="New folder name" autoFocus required />
          <button type="submit">Add</button>
          {folderState.error && <small role="alert">{folderState.error}</small>}
        </form>
      ) : (
        <button type="button" className="pb-add-sub subtle" onClick={() => setAdding(true)}><Plus size={12} />Add folder</button>
      )}
    </div>
  );
}


const initials = (value: string) =>
  value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "BF";
