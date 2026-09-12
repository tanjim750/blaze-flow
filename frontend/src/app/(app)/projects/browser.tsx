"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity, ArrowUpRight, Building2, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Ellipsis, FileText, Folder,
  FolderOpen, Pencil, Plus, Search, Share2, Trash2, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import type { ClientNode, ProjectsView } from "@/lib/projects-view";
import type { FilesView } from "@/lib/files-view";
import { AssetLibrary } from "@/components/asset-library";
import { LinkPending } from "@/components/nav-progress";
import { TasksBoard } from "@/app/(app)/tasks/board";
import type { TasksView } from "@/lib/tasks-view";
import "../tasks/tasks.css";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { createCampaignAction, createClientAction, createFolderAction, deleteCampaignAction, deleteFolderAction, renameCampaignAction, renameFolderAction, type ActionState } from "./actions";

const initialState: ActionState = { error: null, savedAt: null };

/**
 * An inline "name it and press Add" form.
 *
 * All three of these — client, subfolder, folder — were previously written out by hand and
 * shared the same defect: once opened there was no way back. No cancel control, no Escape,
 * no dismissal on clicking away, and not even a close on success, because the action
 * returned `{error: null}` both before and after saving. Opening one to see what it did
 * left it wedged on the tree.
 *
 * So: Escape and a cancel button always close it, clicking away closes it when nothing has
 * been typed (never discarding work), and a completed save closes it via `savedAt`.
 */
function InlineCreate({ action, hidden, placeholder, label, onClose, nested = false }: {
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  placeholder: string;
  label: string;
  onClose: () => void;
  nested?: boolean;
}) {
  const [state, submit, pending] = useActionState(action, initialState);
  const [value, setValue] = useState("");
  const acknowledged = useRef(state.savedAt);

  useEffect(() => {
    if (state.savedAt && state.savedAt !== acknowledged.current) {
      acknowledged.current = state.savedAt;
      onClose();
    }
  }, [state.savedAt, onClose]);

  return (
    <form
      action={submit}
      className={nested ? "pb-inline-form nested" : "pb-inline-form"}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      onBlur={(event) => {
        // Only when it is still empty, so a half-typed name is never thrown away.
        if (!value.trim() && !event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
      }}
    >
      {Object.entries(hidden ?? {}).map(([name, fieldValue]) => <input key={name} type="hidden" name={name} value={fieldValue} />)}
      <input
        name="name"
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
      <button type="button" className="pb-inline-cancel" onClick={onClose} aria-label="Cancel"><X size={13} /></button>
      {state.error && <small role="alert">{state.error}</small>}
    </form>
  );
}
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
        <ChevronLeft size={14} strokeWidth={2.25} />
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
          <InlineCreate
            action={createClientAction}
            placeholder="New client name"
            label="New client name"
            onClose={() => setCreating(false)}
          />
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
  const { renaming, setRenaming, error, setError, remove } = useRowActions();
  const isSelected = view.selectedClient?.id === client.id;

  return (
    <div className={open || isSelected ? "pb-client open" : "pb-client"}>
      {/* A row, not one big button: the Details link cannot live inside a <button>. */}
      <div className="pb-client-head">
        <button type="button" className="pb-client-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="pb-client-mark">{client.initial}</span>
          <strong>{client.name}</strong>
        </button>
        <Link className="pb-client-details" href={`/clients?client=${client.id}`} aria-label={`Details for ${client.name}`}>
          <span>Details</span>
          <ArrowUpRight size={11} strokeWidth={2.5} />
          <LinkPending />
        </Link>
      </div>

      {open && (
        <div className="pb-subtree">
          {client.campaigns.map((campaign) => {
            const active = view.selectedCampaign?.id === campaign.id;
            if (renaming === campaign.id) {
              return (
                <InlineRename
                  key={campaign.id}
                  nested
                  initial={campaign.name}
                  onSave={(name) => renameCampaignAction(campaign.id, name)}
                  onClose={() => setRenaming(null)}
                />
              );
            }
            return (
              <RowMenu
                key={campaign.id}
                label={campaign.name}
                onRename={() => setRenaming(campaign.id)}
                onDelete={() => remove(() => deleteCampaignAction(campaign.id))}
              >
                <Link href={`/projects?client=${client.id}&campaign=${campaign.id}`} className={active ? "pb-sub active" : "pb-sub"}>
                  {active ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{campaign.name}</span>
                  <b>{campaign.assetCount || ""}</b>
                  <LinkPending />
                </Link>
              </RowMenu>
            );
          })}

          {adding ? (
            <InlineCreate
              nested
              action={createCampaignAction}
              hidden={{ clientId: client.id }}
              placeholder="e.g. March 2026"
              label="New subfolder name"
              onClose={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="pb-add-sub" onClick={() => setAdding(true)}>
              <Plus size={13} />+ Add Subfolder <span>(e.g. March 2026)</span>
            </button>
          )}

          {error && <p className="pb-row-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={11} /></button></p>}

          {view.selectedCampaign && isSelected && <NestedFolders view={view} />}
        </div>
      )}
    </div>
  );
}

/** Row-level rename/delete state, shared by the campaign and folder levels. */
function useRowActions() {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const remove = (run: () => Promise<ActionState>) => start(async () => {
    setError(null);
    const result = await run();
    if (result.error) setError(result.error);
  });
  return { renaming, setRenaming, error, setError, remove };
}

/**
 * Right-click a row for Rename and Delete.
 *
 * Radix's ContextMenu rather than a hand-rolled one: it already handles the things a
 * context menu is easy to get wrong — opening at the pointer, closing on Escape or an
 * outside click, keyboard navigation, and the Shift+F10 / menu-key route for anyone not
 * using a mouse.
 */
function RowMenu({ label, onRename, onDelete, children }: {
  label: string; onRename: () => void; onDelete: () => void; children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="pb-context-menu">
        <ContextMenuItem onSelect={onRename}><Pencil />Rename</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => { if (confirm(`Delete ${label}?`)) onDelete(); }}>
          <Trash2 />Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Renames in place. Enter commits, Escape abandons, and leaving the field unchanged is
 * treated as abandoning rather than as a no-op write.
 */
function InlineRename({ initial, onSave, onClose, nested = false }: {
  initial: string;
  onSave: (name: string) => Promise<ActionState>;
  onClose: () => void;
  nested?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = () => {
    const name = value.trim();
    if (!name || name === initial) return onClose();
    start(async () => {
      const result = await onSave(name);
      if (result.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <form
      className={nested ? "pb-inline-form nested" : "pb-inline-form"}
      onSubmit={(event) => { event.preventDefault(); commit(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      // Committing on the input's own blur would save on the way to the cancel button,
      // which pressed Cancel and renamed anyway. Only leaving the form entirely commits.
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(); }}
    >
      <input
        aria-label={`Rename ${initial}`}
        autoFocus
        value={value}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      <button type="button" className="pb-inline-cancel" onClick={onClose} aria-label="Cancel"><X size={13} /></button>
      {error && <small role="alert">{error}</small>}
    </form>
  );
}

/** Folders inside the selected campaign — the "and so on" level below a subfolder. */
function NestedFolders({ view }: { view: ProjectsView }) {
  const [adding, setAdding] = useState(false);
  const { renaming, setRenaming, error, setError, remove } = useRowActions();
  const campaign = view.selectedCampaign!;
  const roots = campaign.folders.filter((folder) => !folder.parentId);
  if (!roots.length && !adding) {
    return <button type="button" className="pb-add-sub subtle" onClick={() => setAdding(true)}><Plus size={12} />Add folder in {campaign.name}</button>;
  }
  return (
    <div className="pb-nested">
      {roots.map((folder) => renaming === folder.id ? (
        <InlineRename
          key={folder.id}
          nested
          initial={folder.name}
          onSave={(name) => renameFolderAction(campaign.id, folder.id, name)}
          onClose={() => setRenaming(null)}
        />
      ) : (
        <RowMenu
          key={folder.id}
          label={folder.name}
          onRename={() => setRenaming(folder.id)}
          onDelete={() => remove(() => deleteFolderAction(campaign.id, folder.id))}
        >
          <span className="pb-nested-row"><Folder size={12} />{folder.name}</span>
        </RowMenu>
      ))}
      {adding ? (
        <InlineCreate
          nested
          action={createFolderAction}
          hidden={{ campaignId: campaign.id }}
          placeholder="Folder name"
          label="New folder name"
          onClose={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="pb-add-sub subtle" onClick={() => setAdding(true)}><Plus size={12} />Add folder</button>
      )}
      {error && <p className="pb-row-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={11} /></button></p>}
    </div>
  );
}


const initials = (value: string) =>
  value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "BF";
