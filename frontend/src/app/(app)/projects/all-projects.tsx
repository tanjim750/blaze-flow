"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, ChevronRight, Ellipsis, FolderInput, Pencil, Share2, Trash2 } from "@/components/icons";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ShareModal } from "@/components/frame/share-modal";
import { timeAgo } from "@/lib/activity";
import { FULL_TREE_ACCESS } from "@/lib/permissions";
import { NO_CLIENT_ID, NO_CLIENT_LABEL } from "@/lib/no-client";
import type { CampaignNode, ClientNode, ProjectsView } from "@/lib/projects-view";
import {
  archiveClientAction, deleteCampaignAction, moveCampaignToClientAction, renameCampaignAction, renameClientAction, setProjectStatusAction, type ActionState,
} from "./actions";

/* All clients → a client's projects → the existing project page. Covers are a collage of the
   newest poster per project, falling back to a gradient picked from the id. There is no cover
   API, so there is no "Change cover". Clients only archive: the API has no hard delete for them. */
const COVERS = [
  "linear-gradient(135deg,#6d5efc,#c86dd7)", "linear-gradient(135deg,#0f9b8e,#7ad3a8)", "linear-gradient(135deg,#f2994a,#f2c94c)",
  "linear-gradient(135deg,#2d3a8c,#56ccf2)", "linear-gradient(135deg,#eb5757,#f2994a)", "linear-gradient(135deg,#27313f,#6b7a90)",
];
const hash = (id: string) => [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
const gradient = (id: string) => ({ background: COVERS[hash(id) % COVERS.length] });
const updated = (iso?: string | null) => (iso ? `Updated ${timeAgo(iso)}` : "No activity yet");
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/* eslint-disable @next/next/no-img-element -- posters are auth-proxied, same-origin and already sized */
function Tile({ project }: { project: CampaignNode }) {
  return project.poster
    ? <i className="has-poster"><img src={project.poster} alt="" loading="lazy" decoding="async" draggable={false} /></i>
    : <i style={gradient(project.id)}>{project.name.slice(0, 1).toUpperCase()}</i>;
}
export function Cover({ id, letter, projects }: { id: string; letter: string; projects: CampaignNode[] }) {
  if (projects.length > 1) return <span className="ap-collage" data-count={Math.min(projects.length, 4)}>{projects.slice(0, 4).map((project) => <Tile key={project.id} project={project} />)}</span>;
  if (projects[0]?.poster) return <span className="ap-solid has-poster"><img src={projects[0].poster} alt="" loading="lazy" decoding="async" draggable={false} /></span>;
  return <span className="ap-solid" style={gradient(id)}>{letter}</span>;
}
/* eslint-enable @next/next/no-img-element */

type Confirm = { title: string; body: string; action: string; run: () => Promise<ActionState> } | null;

export function AllProjects({ view }: { view: ProjectsView }) {
  const router = useRouter();
  const clientId = useSearchParams()?.get("client");
  const access = view.access ?? FULL_TREE_ACCESS;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [share, setShare] = useState<CampaignNode | null>(null);
  const [pending, start] = useTransition();
  const client = clientId ? view.clients.find((item) => item.id === clientId) : undefined;
  const teams = view.clients.filter((item) => item.id !== NO_CLIENT_ID);

  const run = (work: () => Promise<ActionState>, done: string) => start(async () => {
    const result = await work();
    if (result.error) toast.error(result.error);
    else { toast(done); router.refresh(); }
  });

  const rename = (id: string, kind: "client" | "project", current: string, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (!name || name === current) return;
    run(() => (kind === "client" ? renameClientAction(id, name) : renameCampaignAction(id, name)), `Renamed to ${name}`);
  };

  const card = (item: { id: string; name: string }, kind: "client" | "project", href: string, sub: string, cover: React.ReactNode, menu: React.ReactNode) => (
    <article className="ap-card" key={item.id} aria-busy={pending || undefined}>
      <Link href={href} className="ap-cover" aria-label={`Open ${item.name}`}>{cover}</Link>
      <div className="ap-meta">
        {renaming === item.id
          ? <form onSubmit={(event) => { event.preventDefault(); rename(item.id, kind, item.name, String(new FormData(event.currentTarget).get("name") ?? "")); }}>
              <input name="name" aria-label={`Rename ${item.name}`} defaultValue={item.name} autoFocus onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
            </form>
          : <Link href={href} className="ap-name">{item.name}</Link>}
        <small>{sub}</small>
      </div>
      {menu && <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="ap-more" aria-label={`More for ${item.name}`}><Ellipsis size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>{menu}</DropdownMenuContent>
      </DropdownMenu>}
    </article>
  );

  const clientMenu = (item: ClientNode) => {
    if (item.id === NO_CLIENT_ID || !access.renameClient) return null;
    return <>
      <DropdownMenuItem onSelect={() => window.setTimeout(() => setRenaming(item.id), 0)}><Pencil size={14} />Rename</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setConfirm({ title: `Archive ${item.name}?`, body: `${item.name} and its ${plural(item.campaigns.length, "project")} leave the Clients list. Nothing is deleted.`, action: "Archive", run: () => archiveClientAction(item.id) })}>
        <Archive size={14} />Archive
      </DropdownMenuItem>
    </>;
  };

  const projectMenu = (project: CampaignNode, owner: ClientNode) => <>
    {access.renameProject && <DropdownMenuItem onSelect={() => window.setTimeout(() => setRenaming(project.id), 0)}><Pencil size={14} />Rename</DropdownMenuItem>}
    {access.renameProject && <DropdownMenuSub>
      <DropdownMenuSubTrigger><FolderInput size={14} />Move to client</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {teams.map((team) => <DropdownMenuItem key={team.id} disabled={team.id === owner.id} onSelect={() => run(() => moveCampaignToClientAction(project.id, team.id), `Moved ${project.name} to ${team.name}`)}>{team.name}</DropdownMenuItem>)}
        <DropdownMenuItem disabled={owner.id === NO_CLIENT_ID} onSelect={() => run(() => moveCampaignToClientAction(project.id, null), `Moved ${project.name} to ${NO_CLIENT_LABEL}`)}>{NO_CLIENT_LABEL}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>}
    <DropdownMenuItem onSelect={() => window.setTimeout(() => setShare(project), 0)}><Share2 size={14} />Share</DropdownMenuItem>
    {access.renameProject && <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setConfirm({ title: `Archive ${project.name}?`, body: "It moves to Archived projects, where you can restore it.", action: "Archive", run: () => setProjectStatusAction(project.id, "ARCHIVED") })}><Archive size={14} />Archive</DropdownMenuItem>
      <DropdownMenuItem className="ap-danger" onSelect={() => setConfirm({ title: `Delete ${project.name}?`, body: "It is removed from Projects, Files and Tasks. Its files stay in Archived projects.", action: "Delete", run: () => deleteCampaignAction(project.id) })}><Trash2 size={14} />Delete</DropdownMenuItem>
    </>}
  </>;

  return (
    <section className="ap" aria-label="All clients">
      <header className="ap-head">
        <div>
          {client
            ? <><nav className="ap-crumbs" aria-label="Breadcrumb"><Link href="/projects?view=all">All clients</Link><ChevronRight size={14} /><span aria-current="page">{client.name}</span></nav><h1>{client.name}</h1><p>{plural(client.campaigns.length, "project")}</p></>
            : <><h1>All clients</h1><p>{plural(view.clients.length, "client")} · {view.workspaceName}</p></>}
        </div>
      </header>
      {(client ? client.campaigns : view.clients).length === 0 && <p className="ap-empty">{client ? "No projects for this client yet." : "No clients yet."}</p>}
      <div className="ap-grid">
        {client
          ? client.campaigns.map((project) => card(project, "project", `/projects?campaign=${project.id}`, updated(project.updatedAt),
              <Cover id={project.id} letter={project.name.slice(0, 1).toUpperCase()} projects={[project]} />, projectMenu(project, client)))
          : view.clients.map((item) => card(item, "client", `/projects?view=all&client=${item.id}`, `${plural(item.campaigns.length, "project")} · ${updated(item.updatedAt)}`,
              <Cover id={item.id} letter={item.name.slice(0, 1).toUpperCase()} projects={item.campaigns} />, clientMenu(item)))}
      </div>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent className="ap-confirm">
          <DialogTitle>{confirm?.title}</DialogTitle>
          <DialogDescription>{confirm?.body}</DialogDescription>
          <div className="ap-confirm-actions">
            <button type="button" className="ap-btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className={`ap-btn ${confirm?.action === "Delete" ? "is-danger" : "is-primary"}`} disabled={pending}
              onClick={() => { const current = confirm; setConfirm(null); if (current) run(current.run, `${current.action === "Delete" ? "Deleted" : "Archived"}`); }}>
              {confirm?.action}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {share && <ShareModal open onOpenChange={(open) => { if (!open) setShare(null); }} title={share.name}
        internalUrl={typeof window === "undefined" ? "" : `${window.location.origin}/projects?campaign=${share.id}`}
        workspaceId={view.workspaceId} projectId={share.id} canCreateLinks={Boolean(view.workspaceId)} />}
    </section>
  );
}
