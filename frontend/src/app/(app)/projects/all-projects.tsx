"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, Bell, Building2, Ellipsis, Image, Pencil, Share2, Trash2, FolderInput } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ProjectsView } from "@/lib/projects-view";

/* DESIGN PREVIEW (not wired): a Frame.io-style grid of every project. Covers and
   "Updated" ages are derived from the id until the API exposes cover/updated_at. */
const COVERS = [
  "linear-gradient(135deg,#6d5efc,#c86dd7)", "linear-gradient(135deg,#0f9b8e,#7ad3a8)", "linear-gradient(135deg,#f2994a,#f2c94c)",
  "linear-gradient(135deg,#2d3a8c,#56ccf2)", "linear-gradient(135deg,#eb5757,#f2994a)", "linear-gradient(135deg,#27313f,#6b7a90)",
];
const hash = (id: string) => [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function AllProjects({ view }: { view: ProjectsView }) {
  const projects = view.clients.flatMap((client) => client.campaigns.map((campaign) => ({ ...campaign, client: client.id === "unassigned" ? "No client" : client.name })));
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <section className="ap" aria-label="All projects">
      <header className="ap-head">
        <div><h1>All Projects</h1><p>{projects.length} projects · {view.workspaceName}</p></div>
        <button type="button" className="ap-bell" aria-label="Notifications"><Bell size={16} /><span className="ap-dot" /></button>
      </header>
      <div className="ap-grid">
        {projects.map((project) => {
          const h = hash(project.id); const name = names[project.id] ?? project.name;
          return (
            <article key={project.id} className="ap-card">
              <Link href={`/projects?campaign=${project.id}`} className="ap-cover" style={{ background: COVERS[h % COVERS.length] }} aria-label={`Open ${name}`}>
                <span>{name.slice(0, 1).toUpperCase()}</span>
              </Link>
              <div className="ap-meta">
                {renaming === project.id
                  ? <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("name") as string; if (value.trim()) setNames({ ...names, [project.id]: value.trim() }); setRenaming(null); }}>
                      <input name="name" aria-label="Project name" defaultValue={name} autoFocus onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
                    </form>
                  : <Link href={`/projects?campaign=${project.id}`} className="ap-name">{name}</Link>}
                <small><Building2 size={12} />{project.client} · Updated {1 + (h % 11)}mo ago</small>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="ap-more" aria-label={`More for ${name}`}><Ellipsis size={16} /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                  <DropdownMenuItem onSelect={() => window.setTimeout(() => setRenaming(project.id), 0)}><Pencil size={14} />Rename</DropdownMenuItem>
                  <DropdownMenuItem><Image size={14} />Change cover</DropdownMenuItem>
                  <DropdownMenuItem><FolderInput size={14} />Move to client</DropdownMenuItem>
                  <DropdownMenuItem><Share2 size={14} />Share</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem><Archive size={14} />Archive</DropdownMenuItem>
                  <DropdownMenuItem className="ap-danger"><Trash2 size={14} />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          );
        })}
      </div>
    </section>
  );
}
