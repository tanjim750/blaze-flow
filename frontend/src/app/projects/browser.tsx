"use client";

import Link from "next/link";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Building2, ChevronDown, ChevronRight, ChevronsUpDown, CloudUpload, Download, Ellipsis,
  EyeOff, FileText, Folder, FolderOpen, Grid2X2, LayoutList, ListFilter, MessageSquare, Pencil,
  Plus, Search, Share2, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import type { AssetCard, BoardCard, ClientNode, ProjectsView } from "@/lib/projects-view";
import type { FilesView } from "@/lib/files-view";
import { AssetLibrary } from "@/components/asset-library";
import { createCampaignAction, createClientAction, createFolderAction, type ActionState } from "./actions";

const initialState: ActionState = { error: null };
const TABS = ["Assets", "Files", "Status", "Brief & Specs", "Activity Log"] as const;

export function ProjectsBrowser({ view, filesView, initialTab, initialDense = false }: { view: ProjectsView; filesView: FilesView; initialTab?: string; initialDense?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    () => TABS.find((value) => value.toLowerCase() === initialTab?.toLowerCase()) ?? "Assets",
  );
  const [dense, setDense] = useState(initialDense);
  const [expanded, setExpanded] = useState<string[]>(view.selectedClient ? [view.selectedClient.id] : []);
  const [uploading, setUploading] = useState(false);

  const assets = view.assets.filter((asset) =>
    (asset.title + asset.note + asset.stage).toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="pb-layout">
      <ClientRail view={view} expanded={expanded} setExpanded={setExpanded} />

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
                  {value === "Assets" && <Grid2X2 size={14} />}
                  {value === "Files" && <FolderOpen size={14} />}
                  {value === "Status" && <i className="pb-status-dot" />}
                  {value === "Brief & Specs" && <FileText size={14} />}
                  {value === "Activity Log" && <Activity size={14} />}
                  <span>{value}</span>
                  {value === "Assets" && <b>{view.selectedCampaign?.assetCount ?? assets.length}</b>}
                </button>
              ))}
            </div>
            <small>{view.notice ? "Demo content" : "Synced just now"}</small>
          </div>
        </div>

        {tab === "Assets" ? (
          <>
            <div className="pb-toolbar">
              <div className="pb-asset-search">
                <Search size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos, cuts, audio, prores..." aria-label="Search assets" />
              </div>
              <div className="pb-filters">
                <button type="button"><span>Format:</span><b>All Media</b><ChevronDown size={13} /></button>
                <button type="button"><span>Status:</span><b>All Stages</b><ChevronDown size={13} /></button>
                <button type="button"><ChevronsUpDown size={13} /><b>Latest Updated</b><ChevronDown size={13} /></button>
                <ViewToggle dense={dense} setDense={setDense} />
              </div>
            </div>

            {assets.length ? (
              <div className={dense ? "pb-grid list" : "pb-grid"}>
                {assets.map((asset) => <AssetTile key={asset.id} asset={asset} />)}
              </div>
            ) : (
              <p className="pb-empty">
                {view.selectedCampaign ? "No assets in this campaign yet. Upload a cut to get started." : "Create a client and a campaign to start adding assets."}
              </p>
            )}
          </>
        ) : tab === "Files" && view.selectedCampaign ? (
          <AssetLibrary compact view={filesView} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} clientId={view.selectedClient?.id ?? null} />
        ) : tab === "Status" ? (
          <StatusBoard view={view} dense={dense} setDense={setDense} />
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

function AssetTile({ asset }: { asset: AssetCard }) {
  return (
    <article className="pb-card">
      <div className={`pb-thumb tone-${asset.tone}`}>
        {/* Plain <img>: fixed-size stills, and next/image's optimizer misbehaves on this volume. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {asset.thumb && <img src={asset.thumb} alt="" className="pb-thumb-image" />}
        <div className="pb-thumb-top">
          <span className={`pb-stage tone-${asset.tone}`}><i />{asset.stage}</span>
          <span className="pb-version">{asset.version}</span>
        </div>
        <div className="pb-thumb-bottom">
          {asset.comments === null ? <span /> : <span className="pb-comments"><MessageSquare size={11} />{asset.comments}</span>}
          {asset.duration && <span className="pb-duration">{asset.duration}</span>}
        </div>
      </div>
      <div className="pb-card-body">
        <div className="pb-card-title">
          <h3 title={asset.title}>{asset.title}</h3>
          <button type="button" aria-label={`Actions for ${asset.title}`}><Ellipsis size={14} /></button>
        </div>
        <p>{asset.note}</p>
        <footer><span>{asset.format ?? "—"}</span><span>{asset.date}</span></footer>
      </div>
    </article>
  );
}

function ClientRail({ view, expanded, setExpanded }: { view: ProjectsView; expanded: string[]; setExpanded: (value: string[]) => void }) {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [clientState, submitClient] = useActionState(createClientAction, initialState);

  const clients = view.clients.filter((client) => client.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setExpanded(expanded.includes(id) ? expanded.filter((value) => value !== id) : [...expanded, id]);

  return (
    <aside className="pb-rail">
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

function ViewToggle({ dense, setDense }: { dense: boolean; setDense: (value: boolean) => void }) {
  return (
    <div className="pb-view-toggle">
      <button type="button" aria-label="Grid view" aria-pressed={!dense} className={dense ? "" : "selected"} onClick={() => setDense(false)}><Grid2X2 size={14} /></button>
      <button type="button" aria-label="List view" aria-pressed={dense} className={dense ? "selected" : ""} onClick={() => setDense(true)}><LayoutList size={14} /></button>
    </div>
  );
}

/** Status Overview: media versions grouped into their workflow stage, as a board or a flat list. */
function StatusBoard({ view, dense, setDense }: { view: ProjectsView; dense: boolean; setDense: (value: boolean) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const columns = view.board
    .map((column) => ({ ...column, cards: column.cards.filter((card) => card.title.toLowerCase().includes(needle)) }))
    .filter((column) => !needle || column.cards.length);
  const total = view.board.reduce((sum, column) => sum + column.cards.length, 0);

  return (
    <>
      <div className="pb-toolbar">
        <div className="pb-asset-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, videos, editors..." aria-label="Search board" />
        </div>
        <div className="pb-filters">
          <button type="button"><ListFilter size={13} /><b>Filter</b></button>
          <button type="button"><ChevronsUpDown size={13} /><b>Sort</b></button>
          <button type="button"><EyeOff size={13} /><b>Hide</b></button>
          <span className="pb-total-chip"><i />{total} {total === 1 ? "Task" : "Tasks"} Total</span>
          <ViewToggle dense={dense} setDense={setDense} />
        </div>
      </div>

      {!columns.length ? (
        <p className="pb-empty">
          {view.board.length ? "No cards match that search." : "No workflow stages are configured for this campaign yet."}
        </p>
      ) : dense ? (
        <div className="pb-board-list">
          {columns.map((column) => (
            <section key={column.id} className={`pb-board-group tone-${column.tone}`}>
              <h3><i className={`pb-col-dot tone-${column.tone}`} />{column.name}<b>{column.cards.length}</b></h3>
              {column.cards.map((card) => <BoardRow key={card.id} card={card} />)}
              <AddCardButton />
            </section>
          ))}
        </div>
      ) : (
        <div className="pb-board">
          {columns.map((column) => (
            <section key={column.id} className={`pb-column tone-${column.tone}`}>
              <header>
                <h3><i className={`pb-col-dot tone-${column.tone}`} />{column.name}<b>{column.cards.length}</b></h3>
                <div>
                  <button type="button" aria-label={`Add to ${column.name}`}><Plus size={14} /></button>
                  <button type="button" aria-label={`${column.name} options`}><Ellipsis size={14} /></button>
                </div>
              </header>
              {column.cards.map((card) => <BoardTile key={card.id} card={card} />)}
              <AddCardButton />
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Adding a board card means uploading a new media version, which needs a file — there is
 * no metadata-only create endpoint — so this routes to the same upload affordance.
 */
function AddCardButton() {
  return <button type="button" className="pb-add-card"><Plus size={13} />+ Add New</button>;
}

function CardMedia({ card }: { card: BoardCard }) {
  return (
    <div className={`pb-card-media tone-${card.tone}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {card.thumb && <img src={card.thumb} alt="" className="pb-thumb-image" />}
      <div className="pb-card-media-top">
        {card.badge && <span className="pb-media-badge">{card.badge}</span>}
        {card.version && <span className="pb-media-version">{card.version}</span>}
        {card.duration && <span className="pb-media-duration">{card.duration}</span>}
      </div>
      {card.placeholder && (
        <div className="pb-card-placeholder"><UploadCloud size={22} /><span>{card.placeholder}</span></div>
      )}
    </div>
  );
}

function CardMeta({ card }: { card: BoardCard }) {
  return (
    <>
      <h4 title={card.title}>{card.title}</h4>
      <div className="pb-card-owner">
        {card.owner && <><span className="pb-owner-dot" />{card.owner}</>}
        <time className={card.overdue ? "overdue" : undefined}>{card.date}</time>
      </div>
      {(card.ownerInitials.length > 0 || card.comments !== null || card.downloads !== null) && (
        <footer>
          <span className="pb-avatars">
            {card.ownerInitials.map((initials) => <i key={initials}>{initials}</i>)}
          </span>
          <span className="pb-card-counts">
            {card.comments !== null && <b><MessageSquare size={11} />{card.comments}</b>}
            {card.downloads !== null && <b><Download size={11} />{card.downloads}</b>}
          </span>
        </footer>
      )}
    </>
  );
}

function BoardTile({ card }: { card: BoardCard }) {
  return (
    <article className={`pb-board-card tone-${card.tone}`}>
      <CardMedia card={card} />
      <div className="pb-board-card-body"><CardMeta card={card} /></div>
    </article>
  );
}

function BoardRow({ card }: { card: BoardCard }) {
  return (
    <article className={`pb-board-card row tone-${card.tone}`}>
      <CardMedia card={card} />
      <div className="pb-board-card-body"><CardMeta card={card} /></div>
    </article>
  );
}

const initials = (value: string) =>
  value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "BF";
