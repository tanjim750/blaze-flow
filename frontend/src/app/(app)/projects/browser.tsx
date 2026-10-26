"use client";

import Link from "next/link";
import { useDoParam } from "@/lib/do-param";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Archive, ArrowUpRight, Building2, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Ellipsis, FileText, Folder,
  FolderInput, FolderOpen, Gauge, MessagesSquare, Pencil, Plus, RotateCcw, Search, Share2, Sparkles, Trash2, TriangleAlert, UploadCloud, Users, Wallet, X,
} from "@/components/icons";
import type { ClientNode, ProjectsView } from "@/lib/projects-view";
import type { FilesView } from "@/lib/files-view";
import { AssetLibrary } from "@/components/asset-library";
import { ProjectBrief } from "@/components/project-brief";
import { ProjectPricing } from "@/components/money/project-pricing";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { UploadLinksPanel } from "@/components/client-uploads/upload-links-panel";
import { ChatPreview } from "@/components/chat/preview";
import { chatHref, fetchUnread, unreadLabel } from "@/lib/messages";
import "@/components/project-brief.css";
import { LinkPending } from "@/components/nav-progress";
import { TasksBoard } from "@/app/(app)/tasks/board";
import type { TasksView } from "@/lib/tasks-view";
import { filterClientTree } from "@/lib/client-filter";
import "../tasks/tasks.css";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { createCampaignAction, createClientAction, createFolderAction, deleteCampaignAction, deleteFolderAction, moveCampaignToClientAction, renameCampaignAction, renameFolderAction, type ActionState } from "./actions";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { planLabel, type PlanLimit } from "@/lib/plan-limit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { startUpload } from "@/lib/upload-store";
import { reviewHref } from "@/lib/open-in-review";
import { ProjectActionsMenu, StatusPill } from "@/components/projects/project-actions-menu";
import { ArchivePicker, ArchivedNotice, OpenProjectsContext, type OpenProject } from "@/components/projects/archive-picker";

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
  const formRef = useRef<HTMLFormElement>(null);
  const acknowledged = useRef(state.savedAt);

  useEffect(() => {
    if (state.savedAt && state.savedAt !== acknowledged.current) {
      acknowledged.current = state.savedAt;
      onClose();
    }
  }, [state.savedAt, onClose]);

  return (
    <form
      ref={formRef}
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
      {state.error && !state.planLimit && <small role="alert">{state.error}</small>}
      {state.planLimit && <PlanLimitDialog key={state.error} limit={state.planLimit} name={value.trim()} onClose={onClose} onRetry={() => formRef.current?.requestSubmit()} />}
    </form>
  );
}

/**
 * R2: hitting the plan's project limit is a decision, not a typo, so it gets a dialog that
 * says what happened and what to do (archive a finished project, or upgrade) instead of a
 * line of small print inside the sidebar form.
 */
function PlanLimitDialog({ limit, name, onClose, onRetry }: { limit: PlanLimit; name: string; onClose: () => void; onRetry?: () => void }) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState<"options" | "pick">("options");
  const [archived, setArchived] = useState<OpenProject | null>(null);
  const retry = () => { setOpen(false); onRetry?.(); };
  const close = () => { setOpen(false); onClose(); };
  const plan = planLabel(limit.plan);
  const noun = limit.limit === 1 ? "project" : "projects";
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="pb-limit-dialog">
      <header className="pb-limit-head">
        <span className="pb-limit-badge" aria-hidden><Gauge /></span>
        <div>
          <p className="pb-limit-eyebrow">{plan} plan</p>
          <DialogTitle className="pb-limit-title">You&rsquo;ve hit your plan&rsquo;s {limit.limit}-project limit</DialogTitle>
        </div>
      </header>
      <DialogDescription className="pb-limit-body">{name ? <>&ldquo;{name}&rdquo; wasn&rsquo;t created. </> : null}Free up a slot or move to a bigger plan to keep going.</DialogDescription>
      {!archived && <div className="pb-limit-meter" role="meter" aria-label="Projects used" aria-valuemin={0} aria-valuemax={limit.limit} aria-valuenow={limit.limit}>
        <div className="pb-limit-meter-row"><span>Open projects</span><strong>{limit.limit} of {limit.limit} {noun}</strong></div>
        <i><b /></i>
      </div>}
      {archived ? <ArchivedNotice project={archived} name={name} />
        : step === "pick" ? <ArchivePicker onArchived={setArchived} />
        : <>
      <div className="pb-limit-options">
        <button type="button" className="pb-limit-option" onClick={() => setStep("pick")}>
          <span aria-hidden><Archive /></span>
          <span><strong>Archive a project</strong><small>Archived projects keep their files and don&rsquo;t count towards the limit.</small></span>
          <ChevronRight aria-hidden className="pb-limit-chev" />
        </button>
        <Link href="/help" className="pb-limit-option" onClick={close}>
          <span aria-hidden><Sparkles /></span>
          <span><strong>Upgrade plan</strong><small>The workspace owner can move to a plan with more projects.</small></span>
          <ChevronRight aria-hidden className="pb-limit-chev" />
        </Link>
      </div>
        </>}
      <footer className="pb-limit-actions">
        {archived ? <>
          <button type="button" className="pb-limit-secondary" onClick={close}>Not now</button>
          {onRetry && name ? <button type="button" className="pb-limit-primary" onClick={retry}>Create &ldquo;{name}&rdquo;</button>
            : <button type="button" className="pb-limit-primary" onClick={close}>Done</button>}
        </> : step === "pick" ? <>
          <button type="button" className="pb-limit-secondary" onClick={() => setStep("options")}>Back</button>
          <Link href="/projects/archived" className="pb-limit-primary" onClick={close}>Archived projects</Link>
        </> : <>
          <Link href="/help" className="pb-limit-secondary" onClick={close}>Help &amp; upgrades</Link>
          <button type="button" className="pb-limit-primary" onClick={() => setStep("pick")}>Choose a project to archive</button>
        </>}
      </footer>
      <DialogClose />
    </DialogContent>
  </Dialog>;
}
const TABS = ["Files", "Tasks", "Chat", "Brief & Specs", "Activity Log", "Client uploads", "Pricing"] as const;
/** "Client uploads" also answers to `?tab=client-uploads` (what notifications and the feed link to). */
const tabSlug = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

export function ProjectsBrowser({ view, filesView, tasksView, initialTab, initialQuery = "" }: { view: ProjectsView; filesView: FilesView; tasksView: TasksView; initialTab?: string; initialQuery?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    () => TABS.find((value) => value.toLowerCase() === initialTab?.toLowerCase() || (initialTab ? tabSlug(value) === tabSlug(initialTab) : false)) ?? "Files",
  );
  const [expanded, setExpanded] = useState<string[]>(view.selectedClient ? [view.selectedClient.id] : []);
  const [uploading, setUploading] = useState(false);
  const [railClosed, setRailClosed] = useState(false);
  // Phones: the client tree is a sheet over the page instead of a column beside it.
  const [sheetOpen, setSheetOpen] = useState(false);
  const campaignId = view.selectedCampaign?.id ?? null;
  const [unread, setUnread] = useState<{ project: string | null; count: number }>({ project: null, count: 0 });
  const messagesUnread = unread.project === campaignId ? unread.count : 0;
  const openProjects = useMemo<OpenProject[]>(
    () => (view.workspaceId ? view.clients.flatMap((client) => client.campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, client: client.name, status: campaign.status }))) : []),
    [view.workspaceId, view.clients],
  );

  // The tab's badge: this project's unread count from the workspace summary, refreshed every
  // half minute (the open thread reports its own count while it is on screen).
  useEffect(() => {
    if (!view.workspaceId || !campaignId) return;
    let alive = true;
    const load = () => void fetchUnread(view.workspaceId as string).then((result) => {
      if (!alive || !result.ok) return;
      const row = result.data.projects.find((project) => project.project_id === campaignId);
      setUnread({ project: campaignId, count: row?.total_unread ?? 0 });
    });
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [view.workspaceId, campaignId]);

  return (
    <OpenProjectsContext.Provider value={openProjects}>
    <div className={`pb-layout${railClosed ? " is-rail-closed" : ""}${sheetOpen ? " is-sheet-open" : ""}`}>
      {sheetOpen && <button type="button" className="pb-sheet-backdrop" aria-label="Close clients" onClick={() => setSheetOpen(false)} />}
      {/* Keyed on the query so a new sidebar search replaces the filter instead of being ignored. */}
      <ClientRail key={initialQuery} initialFilter={initialQuery} view={view} expanded={expanded} setExpanded={setExpanded} closed={railClosed} onToggle={() => setRailClosed(!railClosed)} onNavigate={() => setSheetOpen(false)} />

      <section className="pb-canvas">
        {view.notice && (
          <p className="pb-notice"><TriangleAlert size={14} /><span>{view.notice}</span></p>
        )}

        <div className="pb-canvas-head">
          <div className="pb-crumbs-row">
            <button type="button" className="pb-sheet-open" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}><Users size={14} aria-hidden="true" />Clients</button>
            <nav className="pb-crumbs" aria-label="Breadcrumb">
              <span>Projects</span><ChevronRight size={13} />
              <span>{view.selectedClient?.name ?? "—"}</span><ChevronRight size={13} />
              <b>{view.selectedCampaign?.name ?? "No campaign"}<Pencil size={11} /></b>
            </nav>
            {view.selectedCampaign ? (
              <Link className="pb-ghost-button" aria-label="Client review link" href={`/review?project=${view.selectedCampaign.id}&share=1`}>
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
              {view.workspaceId && view.selectedCampaign && <StatusPill status={view.selectedCampaign.project?.status ?? view.selectedCampaign.status ?? "DRAFT"} />}
            </div>
            <div className="pb-title-actions">
              {view.workspaceId && view.selectedCampaign
                ? <ProjectActionsMenu projectId={view.selectedCampaign.id} name={view.selectedCampaign.name} status={view.selectedCampaign.project?.status ?? view.selectedCampaign.status ?? "DRAFT"} />
                : <button className="pb-ghost-button pb-icon-only" type="button" aria-label="More actions" disabled><Ellipsis size={15} /></button>}
              {view.selectedCampaign && <ProjectMoreActions view={view} campaignId={view.selectedCampaign.id} />}
              {view.workspaceId && view.selectedCampaign && (
                <ChatHeaderButton workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} unread={messagesUnread} />
              )}
              <button className="pb-primary-button" type="button" disabled={!view.workspaceId || !view.selectedCampaign} onClick={() => setUploading(true)}><CloudUpload size={15} />Upload Asset</button>
            </div>
          </div>

          <div className="pb-tabs-row">
            <div className="pb-tabs" role="tablist">
              {TABS.filter((value) => value !== "Pricing" || view.canSeeBilling).map((value) => (
                <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "selected" : ""} onClick={() => setTab(value)}>
                  {value === "Files" && <FolderOpen size={14} />}
                  {value === "Chat" && <MessagesSquare size={14} />}
                  {value === "Brief & Specs" && <FileText size={14} />}
                  {value === "Activity Log" && <Activity size={14} />}
                  {value === "Client uploads" && <FolderInput size={14} />}
                  {value === "Pricing" && <Wallet size={14} />}
                  <span>{value}</span>
                  {value === "Chat" && messagesUnread > 0 && <b className="pb-tab-unread" aria-label={`${messagesUnread} unread`}>{unreadLabel(messagesUnread)}</b>}
                </button>
              ))}
            </div>
            {view.notice && <small>Demo content</small>}
          </div>
        </div>


        {tab === "Files" && view.selectedCampaign ? (
          <AssetLibrary compact view={filesView} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} clientId={view.selectedClient && view.selectedClient.id !== "unassigned" ? view.selectedClient.id : null} />
        ) : tab === "Chat" && view.selectedCampaign && view.workspaceId ? (
          <div className="pb-chat-preview"><ChatPreview workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} /></div>
        ) : tab === "Tasks" && view.selectedCampaign ? (
          <TasksBoard compact view={tasksView} projectId={view.selectedCampaign.id} />
        ) : tab === "Brief & Specs" && view.selectedCampaign && view.workspaceId && view.selectedCampaign.project ? (
          // Keyed on the project so switching campaigns never carries one brief's unsaved text into another.
          <ProjectBrief key={view.selectedCampaign.id} workspaceId={view.workspaceId} project={view.selectedCampaign.project} />
        ) : tab === "Activity Log" && view.selectedCampaign && view.workspaceId && view.selectedCampaign.project ? (
          // Keyed on the project so a campaign switch starts a fresh timeline and filter.
          <ActivityFeed key={view.selectedCampaign.id} workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} />
        ) : tab === "Client uploads" && view.selectedCampaign && view.workspaceId && view.selectedCampaign.project ? (
          <UploadLinksPanel key={view.selectedCampaign.id} workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} />
        ) : tab === "Pricing" && view.canSeeBilling && view.selectedCampaign && view.workspaceId ? (
          <ProjectPricing key={view.selectedCampaign.id} workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} />
        ) : tab === "Brief & Specs" && view.selectedCampaign?.briefError ? (
          <div className="pb-soon" role="alert">
            <TriangleAlert size={24} strokeWidth={1.75} aria-hidden="true" />
            <h2>The brief couldn&rsquo;t be loaded</h2>
            <p>{view.selectedCampaign.briefError}</p>
            <button type="button" className="pb-soon-link" onClick={() => router.refresh()}><RotateCcw size={14} />Retry</button>
          </div>
        ) : (
          <ComingSoon tab={tab} hasCampaign={Boolean(view.selectedCampaign)} briefFolder={view.selectedCampaign?.folders.find((folder) => /brief/i.test(folder.name))?.name ?? null} onOpenFiles={() => setTab("Files")} />
        )}
      </section>
      {uploading && view.workspaceId && view.selectedCampaign && (
        <UploadDialog workspaceId={view.workspaceId} projectId={view.selectedCampaign.id} projectName={view.selectedCampaign.name} onClose={() => setUploading(false)} onUploaded={() => setUploading(false)} onLanded={() => router.refresh()} />
      )}
    </div>
    </OpenProjectsContext.Provider>
  );
}

function ChatHeaderButton({ workspaceId, projectId, unread }: { workspaceId: string; projectId: string; unread: number }) {
  const [href, setHref] = useState(`/chat`);
  useEffect(() => {
    void fetchUnread(workspaceId).then((result) => {
      if (!result.ok) return;
      const row = result.data.projects.find((project) => project.project_id === projectId);
      if (row?.chat_channel_id) setHref(chatHref(row.chat_channel_id, "team", (row.unread?.team ?? 0) > 0 && !(row.unread?.client) ? "team" : "client"));
    });
  }, [workspaceId, projectId]);
  return <Link className="pb-ghost-button" href={href}><MessagesSquare size={14} />Chat{unread > 0 ? ` (${unreadLabel(unread)})` : ""}</Link>;
}

/**
 * The tab body when there is nothing real to show: no campaign yet, or a tab whose feature
 * has not shipped. It says so plainly instead of "not built yet", and offers the one useful
 * next step without dressing it up as a primary action.
 */
function ComingSoon({ tab, hasCampaign, briefFolder, onOpenFiles }: { tab: (typeof TABS)[number]; hasCampaign: boolean; briefFolder: string | null; onOpenFiles: () => void }) {
  if (!hasCampaign) {
    return (
      <div className="pb-soon" role="status">
        <FolderOpen size={24} strokeWidth={1.75} aria-hidden="true" />
        <h2>No campaign selected</h2>
        <p>Pick a campaign in the client list, or add one with “Add Subfolder”.</p>
      </div>
    );
  }
  const brief = tab === "Brief & Specs";
  const Icon = brief ? FileText : Activity;
  // Both tabs only land here for demo content, which has no real project behind it.
  return (
    <div className="pb-soon" role="status">
      <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      {brief && <span className="pb-soon-tag">Coming soon</span>}
      <h2>{brief ? "Brief & specs" : tab === "Client uploads" ? "Client uploads" : "Activity log"}</h2>
      <p>
        {brief
          ? `A place for the brief, deliverable specs and due dates is on the way. Until then, keep brief documents in ${briefFolder ? `the “${briefFolder}” folder` : "this campaign’s Files"}.`
          : tab === "Client uploads"
            ? "This is sample content. On a real campaign you can create upload links here so clients can send files without an account."
            : "This is sample content, so there is no history to show. Real campaigns list uploads, reviews, approvals, task moves and client link visits here."}
      </p>
      {brief && <button type="button" className="pb-soon-link" onClick={onOpenFiles}><FolderOpen size={14} />Open Files</button>}
    </div>
  );
}

function UploadDialog({ workspaceId, projectId, projectName, onClose, onUploaded, onLanded }: { workspaceId: string; projectId: string; projectName: string; onClose: () => void; onUploaded: () => void; onLanded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Hands the cut to the global upload queue and closes: the tray shows progress, then the
   * scan and proxy, and keeps going if you leave this page. Failures stay there with Retry.
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("Choose a file to upload."); return; }
    const fields: Record<string, string> = {};
    form.forEach((value, key) => { if (key !== "file" && typeof value === "string") fields[key] = value; });
    setBusy(true); setError("");
    startUpload({
      url: `/api/workspaces/${workspaceId}/projects/${projectId}/media-versions/`, file, fields, source: "project", destination: `${projectName} · new version`,
      describe: (data) => {
        const version = data as { id: string; file?: { id?: string } | null };
        const fileId = version.file?.id ?? null;
        return { workspaceId, fileId, href: fileId ? reviewHref({ mediaId: fileId }) : null };
      },
      onSuccess: () => onLanded(),
    });
    onUploaded();
  }

  return <dialog ref={dialog} open className="pb-upload-dialog" onCancel={onClose} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }} aria-modal="true" aria-labelledby="upload-title">
    <button type="button" className="pb-upload-backdrop" onClick={onClose} tabIndex={-1} aria-hidden="true" />
    <form onSubmit={submit} className="pb-upload-panel">
      <header><div><p>New media version</p><h2 id="upload-title">Upload to {projectName}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
      <label className="pb-file-drop"><UploadCloud size={26} /><strong>Choose an asset</strong><span>PNG, JPEG, GIF, WebP, MP4, MOV, or WebM</span><input name="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm" required /></label>
      <label>Title<input name="title" placeholder="Spring campaign — hero cut" required /></label>
      <label>Notes<textarea name="note" rows={3} placeholder="What changed in this version?" /></label>
      <div className="pb-upload-options"><label>Priority<select name="priority" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label className="pb-check"><input name="allow_download" type="checkbox" value="true" />Allow downloads</label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}><CloudUpload size={15} />{busy ? "Uploading…" : "Upload asset"}</button></footer>
    </form>
  </dialog>;
}

function ClientRail({ view, initialFilter, expanded, setExpanded, closed, onToggle, onNavigate }: { view: ProjectsView; initialFilter: string; expanded: string[]; setExpanded: (value: string[]) => void; closed: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const [filter, setFilter] = useState(initialFilter);
  const [creating, setCreating] = useState(false);
  useDoParam("new", () => setCreating(true));
  const rows = filterClientTree(view.clients, filter);
  const toggle = (id: string) => setExpanded(expanded.includes(id) ? expanded.filter((value) => value !== id) : [...expanded, id]);

  return (
    <aside className="pb-rail" aria-label="Clients and projects" onClick={(event) => { if ((event.target as HTMLElement).closest("a[href]")) onNavigate?.(); }}>
      {/* Same handle as the main rail, but centred on the edge: anchored to the top it
          landed on the shell's own toggle once this rail closed to nothing. The wrapper
          owns the positioning so the :active scale (CSS) does not fight a translate. */}
      <div className="pb-rail-handle">
      <button
        type="button"
        className="pb-rail-toggle"
        onClick={onToggle}
        aria-label={closed ? "Show clients" : "Hide clients"}
        aria-expanded={!closed}
      >
        <ChevronLeft size={14} strokeWidth={2.25} />
      </button>
      </div>
      <div className="pb-rail-top">
        <div className="pb-rail-head">
          <h2><Building2 size={16} />Clients</h2>
          <button type="button" className="pb-new-button" data-mobile-primary="New" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            <Plus size={13} />NEW
          </button>
        </div>

        <div className="pb-rail-search">
          <Search size={14} />
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter clients & projects" aria-label="Filter clients and projects" />
          {filter && <button type="button" className="pb-rail-clear" onClick={() => setFilter("")} aria-label="Clear filter"><X size={12} /></button>}
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
          {rows.map(({ client, campaigns, matchedCampaign }) => (
            <ClientBranch key={client.id} client={client} campaigns={campaigns} view={view} open={matchedCampaign || expanded.includes(client.id)} onToggle={() => toggle(client.id)} />
          ))}
          {!rows.length && (
            <p className="pb-rail-empty" role="status">
              No matches for “{filter.trim()}”.{" "}
              <button type="button" className="pb-rail-empty-clear" onClick={() => setFilter("")}>Clear</button>
            </p>
          )}
        </div>
        {view.workspaceId && <Link className="pb-archived-link" href="/projects/archived"><Archive size={13} />Archived projects</Link>}
      </div>
    </aside>
  );
}

function ClientBranch({ client, campaigns = client.campaigns, view, open, onToggle }: { client: ClientNode; campaigns?: ClientNode["campaigns"]; view: ProjectsView; open: boolean; onToggle: () => void }) {
  const [adding, setAdding] = useState(false);
  const { renaming, setRenaming, error, setError, remove } = useRowActions();
  const isSelected = view.selectedClient?.id === client.id;
  const mover = useMoveToClient();
  const clientTargets = view.clients.filter((item) => item.id !== "unassigned").map((item) => ({ id: item.id, name: item.name }));

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
          {campaigns.map((campaign) => {
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
                move={view.workspaceId ? { clients: clientTargets, current: client.id === "unassigned" ? null : client.id, onMove: (clientId) => mover.move(campaign.id, clientId) } : undefined}
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
              <Plus size={13} />Add Subfolder <span>(e.g. March 2026)</span>
            </button>
          )}

          {error && <p className="pb-row-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={11} /></button></p>}
          {mover.error && <p className="pb-row-error" role="alert">{mover.error}</p>}

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
type MoveTargets = { clients: { id: string; name: string }[]; current: string | null; onMove: (clientId: string | null) => void };

function RowMenu({ label, onRename, onDelete, move, children }: {
  label: string; onRename: () => void; onDelete: () => void; move?: MoveTargets; children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="pb-context-menu">
        <ContextMenuItem onSelect={onRename}><Pencil />Rename</ContextMenuItem>
        {move && <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInput />Move to client</ContextMenuSubTrigger>
          <ContextMenuSubContent className="pb-context-menu">
            {move.clients.map((client) => (
              <ContextMenuItem key={client.id} disabled={client.id === move.current} onSelect={() => move.onMove(client.id)}>
                {client.name}{client.id === move.current ? " (current)" : ""}
              </ContextMenuItem>
            ))}
            {!move.clients.length && <ContextMenuItem disabled>No clients yet</ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!move.current} onSelect={() => move.onMove(null)}>No client (unassigned)</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>}
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

/**
 * The project header's "…" menu: link the project to a client (or unlink it). Linking is
 * what puts a project in that client's portal.
 */
function useMoveToClient() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (campaignId: string, clientId: string | null) => start(async () => {
    setError(null);
    const result = await moveCampaignToClientAction(campaignId, clientId);
    if (result.error) { setError(result.error); return; }
    router.push(`/projects?client=${clientId ?? "unassigned"}&campaign=${campaignId}`);
    router.refresh();
  });
  return { move, pending, error };
}

function ProjectMoreActions({ view, campaignId }: { view: ProjectsView; campaignId: string }) {
  const { move: moveTo, pending, error } = useMoveToClient();
  const clients = view.clients.filter((client) => client.id !== "unassigned");
  const current = view.selectedClient && view.selectedClient.id !== "unassigned" ? view.selectedClient.id : null;
  const currentName = current ? view.selectedClient?.name : null;
  const move = (clientId: string | null) => moveTo(campaignId, clientId);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Labelled, not icon-only: linking a project to a client is how it reaches their portal (R1). */}
          <button className="pb-ghost-button pb-client-link" type="button" aria-label={currentName ? `Client: ${currentName}. Change client` : "Link to a client"} title={currentName ? "Change client" : "Link to a client"} disabled={pending}>
            <FolderInput size={15} /><span>{pending ? "Moving…" : currentName ?? "Link to client"}</span><ChevronDown size={13} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="pb-more-menu">
          <DropdownMenuLabel>{current ? "Move to client" : "Link to client"}</DropdownMenuLabel>
          {clients.map((client) => (
            <DropdownMenuItem key={client.id} disabled={client.id === current} onSelect={() => move(client.id)}>
              {client.name}{client.id === current ? " (current)" : ""}
            </DropdownMenuItem>
          ))}
          {!clients.length && <DropdownMenuItem disabled>No clients yet. Create one in Clients</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!current} onSelect={() => move(null)}>No client (unassigned)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="pb-inline-error" role="alert">{error}</span>}
    </>
  );
}
