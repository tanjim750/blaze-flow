"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, Bell, ChevronRight, Ellipsis, Image, Pencil, Share2, Trash2, FolderInput } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ProjectsView } from "@/lib/projects-view";

/* DESIGN PREVIEW (not wired): a Frame.io-style grid of every project. Covers and
   "Updated" ages are derived from the id until the API exposes cover/updated_at. */
const COVERS = [
  "linear-gradient(135deg,#6d5efc,#c86dd7)", "linear-gradient(135deg,#0f9b8e,#7ad3a8)", "linear-gradient(135deg,#f2994a,#f2c94c)",
  "linear-gradient(135deg,#2d3a8c,#56ccf2)", "linear-gradient(135deg,#eb5757,#f2994a)", "linear-gradient(135deg,#27313f,#6b7a90)",
];
const hash = (id: string) => [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);

type Item = { id: string; name: string };
function Card({ item, href, cover, sub, menu, names, setNames, renaming, setRenaming }: { item: Item; href: string; cover: React.ReactNode; sub: string; menu: "client" | "project"; names: Record<string, string>; setNames: (v: Record<string, string>) => void; renaming: string | null; setRenaming: (v: string | null) => void }) {
  const name = names[item.id] ?? item.name;
  return (
    <article className="ap-card">
      <Link href={href} className="ap-cover" aria-label={`Open ${name}`}>{cover}</Link>
      <div className="ap-meta">
        {renaming === item.id
          ? <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("name") as string; if (value.trim()) setNames({ ...names, [item.id]: value.trim() }); setRenaming(null); }}>
              <input name="name" aria-label="Name" defaultValue={name} autoFocus onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
            </form>
          : <Link href={href} className="ap-name">{name}</Link>}
        <small>{sub}</small>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="ap-more" aria-label={`More for ${name}`}><Ellipsis size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem onSelect={() => window.setTimeout(() => setRenaming(item.id), 0)}><Pencil size={14} />Rename</DropdownMenuItem>
          <DropdownMenuItem><Image size={14} />Change cover</DropdownMenuItem>
          {menu === "project" && <DropdownMenuItem><FolderInput size={14} />Move to client</DropdownMenuItem>}
          <DropdownMenuItem><Share2 size={14} />Share</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem><Archive size={14} />Archive</DropdownMenuItem>
          {menu === "project" && <DropdownMenuItem className="ap-danger"><Trash2 size={14} />Delete</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
const ago = (id: string) => `Updated ${1 + (hash(id) % 11)}mo ago`;
const gradient = (id: string) => ({ background: COVERS[hash(id) % COVERS.length] });

export function AllProjects({ view }: { view: ProjectsView }) {
  const clientId = useSearchParams()?.get("client");
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const label = (client: { id: string; name: string }) => names[client.id] ?? (client.id === "unassigned" ? "No client" : client.name);
  const client = clientId ? view.clients.find((item) => item.id === clientId) : undefined;
  const shared = { names, setNames, renaming, setRenaming };

  return (
    <section className="ap" aria-label="All clients">
      <header className="ap-head">
        <div>
          {client
            ? <><nav className="ap-crumbs" aria-label="Breadcrumb"><Link href="/projects?view=all">All clients</Link><ChevronRight size={14} /><span aria-current="page">{label(client)}</span></nav><h1>{label(client)}</h1><p>{client.campaigns.length} projects</p></>
            : <><h1>All clients</h1><p>{view.clients.length} clients · {view.workspaceName}</p></>}
        </div>
        <button type="button" className="ap-bell" aria-label="Notifications"><Bell size={16} /><span className="ap-dot" /></button>
      </header>
      <div className="ap-grid">
        {client
          ? client.campaigns.map((project) => <Card key={project.id} item={project} menu="project" href={`/projects?campaign=${project.id}`} sub={ago(project.id)} cover={<span className="ap-solid" style={gradient(project.id)}>{(names[project.id] ?? project.name).slice(0, 1).toUpperCase()}</span>} {...shared} />)
          : view.clients.map((item) => <Card key={item.id} item={{ id: item.id, name: label(item) }} menu="client" href={`/projects?view=all&client=${item.id}`} sub={`${item.campaigns.length} project${item.campaigns.length === 1 ? "" : "s"} · ${ago(item.id)}`}
              cover={item.campaigns.length > 1
                ? <span className="ap-collage">{item.campaigns.slice(0, 4).map((project) => <i key={project.id} style={gradient(project.id)}>{project.name.slice(0, 1)}</i>)}</span>
                : <span className="ap-solid" style={gradient(item.id)}>{label(item).slice(0, 1).toUpperCase()}</span>} {...shared} />)}
      </div>
    </section>
  );
}
