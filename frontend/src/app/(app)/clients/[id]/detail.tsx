"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Banknote, CalendarDays, CheckCircle2, ChevronDown, Clapperboard, Globe2, Mail, MapPin, Pencil, TriangleAlert, Users } from "@/components/icons";
import type { ClientOverview, ClientOverviewProject } from "@/lib/api";
import type { ClientCard } from "@/lib/clients-view";
import { formatMoney } from "@/lib/money";
import { ClientAccessDialog, ClientDialog } from "../panel";

const STATUS: Record<string, string> = { DRAFT: "Draft", ACTIVE: "Active", ON_HOLD: "On hold", COMPLETED: "Completed", ARCHIVED: "Archived" };
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const projectHref = (clientId: string, projectId: string) => `/projects?client=${clientId}&campaign=${projectId}`;

function dueLabel(due: string | null) {
  if (!due) return { text: "No due date", late: false };
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Overdue · ${shortDate(due)}`, late: true };
  if (days === 0) return { text: "Due today", late: true };
  return { text: `Due ${shortDate(due)}`, late: false };
}

function ProjectRow({ clientId, project, done }: { clientId: string; project: ClientOverviewProject; done?: boolean }) {
  const due = dueLabel(project.due_at);
  const percent = project.tasks_total === 0 || project.progress === null ? null : Math.round(project.progress);
  return <li>
    <Link href={projectHref(clientId, project.id)} className="cd-project">
      <span className="cd-project-main">
        <strong>{project.name}</strong>
        <span className="cd-project-meta">
          <em className={`cd-status is-${project.status.toLowerCase().replace("_", "-")}`}>{STATUS[project.status] ?? project.status}</em>
          {done ? <span>Updated {shortDate(project.updated_at)}</span> : <span className={due.late ? "is-late" : undefined}><CalendarDays />{due.text}</span>}
        </span>
      </span>
      {!done && <span className="cd-progress" aria-label={percent === null ? "No tasks yet" : `${percent}% of tasks done`}>
        <span className="cd-bar"><i style={{ width: `${percent ?? 0}%` }} /></span>
        <small>{percent === null ? "No tasks yet" : `${project.tasks_done}/${project.tasks_total} ${project.tasks_total === 1 ? "task" : "tasks"} · ${percent}%`}</small>
      </span>}
      <ArrowUpRight className="cd-go" />
    </Link>
  </li>;
}

export function ClientDetail({ client, overview, notice }: { client: ClientCard; overview: ClientOverview | null; notice: string | null }) {
  const [editing, setEditing] = useState(false);
  const [access, setAccess] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const money = overview?.money ?? null;
  const openInvites = client.invites.filter((invite) => !invite.revoked_at).length;
  const counts = overview?.counts ?? { ongoing: 0, completed: 0, editors: 0 };
  const paidText = !money ? null : money.invoices_issued === 0 && Number(money.paid) === 0 ? "—" : formatMoney(money.paid, money.currency);
  const place = [client.city, client.country_code].filter(Boolean).join(", ");

  return <section className="clients-page cd-page">
    <Link href="/clients" className="cd-back"><ArrowLeft />All clients</Link>
    <header className="cd-head">
      <span className="cd-logo" aria-hidden="true">{initials(client.name)}</span>
      <div><p className="cd-eyebrow">Client</p><h1>{client.name}</h1>{place && <p className="cd-place"><MapPin />{place}</p>}</div>
      <div className="cd-actions">
        <button type="button" className="cd-ghost" onClick={() => setAccess(true)}><Users />Members &amp; invites</button>
        <button type="button" className="cd-primary" onClick={() => setEditing(true)}><Pencil />Edit</button>
      </div>
    </header>
    {notice && <p className="clients-notice"><TriangleAlert />{notice}</p>}

    <div className={`cd-stats${money ? "" : " is-three"}`}>
      <article><span className="cd-stat-icon"><CheckCircle2 /></span><small>Completed projects</small><strong>{counts.completed}</strong></article>
      <article><span className="cd-stat-icon"><Clapperboard /></span><small>Ongoing projects</small><strong>{counts.ongoing}</strong></article>
      {money && <article><span className="cd-stat-icon"><Banknote /></span><small>Paid to date</small><strong>{paidText}</strong>
        <p>{Number(money.agreed) > 0 ? `of ${formatMoney(money.agreed, money.currency)} agreed` : "No fees or task prices set"}{money.invoices_issued > 0 && ` · ${money.invoices_paid}/${money.invoices_issued} ${money.invoices_issued === 1 ? "invoice" : "invoices"} paid`}</p></article>}
      <article><span className="cd-stat-icon"><Users /></span><small>Editors on their work</small><strong>{counts.editors}</strong></article>
    </div>

    <div className="cd-grid">
      <div className="cd-col">
        <section className="cd-card">
          <header><h2>Ongoing projects</h2><span>{counts.ongoing}</span></header>
          {overview?.ongoing_projects.length ? <ul className="cd-list">{overview.ongoing_projects.map((project) => <ProjectRow key={project.id} clientId={client.id} project={project} />)}</ul> : <p className="cd-empty">Nothing in progress for {client.name}.</p>}
        </section>
        <section className="cd-card">
          <button type="button" className="cd-toggle" aria-expanded={showDone} onClick={() => setShowDone((open) => !open)}>
            <h2>Completed projects</h2><span>{counts.completed}</span><ChevronDown className={showDone ? "is-open" : undefined} />
          </button>
          {showDone && (overview?.completed_projects.length ? <ul className="cd-list">{overview.completed_projects.map((project) => <ProjectRow key={project.id} clientId={client.id} project={project} done />)}</ul> : <p className="cd-empty">No completed projects yet.</p>)}
        </section>
      </div>
      <div className="cd-col">
        <section className="cd-card">
          <header><h2>Editors</h2><span>{counts.editors}</span></header>
          {overview?.editors.length ? <ul className="cd-editors">{overview.editors.map((editor) => <li key={editor.membership_id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- user avatars come from arbitrary hosts */}
            {editor.avatar_url ? <img src={editor.avatar_url} alt="" /> : <span className="cd-avatar" aria-hidden="true">{initials(editor.name)}</span>}
            <span><strong>{editor.name}</strong><small>{editor.role}</small></span>
            <em>{plural(editor.project_count, "project")}</em>
          </li>)}</ul> : <p className="cd-empty">No editors are assigned to this client&apos;s tasks yet.</p>}
        </section>
        <section className="cd-card cd-info">
          <header><h2>About</h2></header>
          <p>{client.description || "No description yet."}</p>
          <dl>
            {client.email && <div><Mail /><a href={`mailto:${client.email}`}>{client.email}</a></div>}
            {client.website && <div><Globe2 /><a href={client.website} target="_blank" rel="noreferrer">{client.website.replace(/^https?:\/\//, "")}</a></div>}
            <div><Users />{plural(client.members.length, "client member")} · {plural(openInvites, "open invite")}</div>
          </dl>
          {client.projects.length > 0 && <div className="client-projects">{client.projects.slice(0, 8).map((project) => <span key={project.id}>{project.name}</span>)}{client.projects.length > 8 && <small>+{client.projects.length - 8}</small>}</div>}
        </section>
      </div>
    </div>
    {editing && <ClientDialog client={client} close={() => setEditing(false)} />}
    {access && <ClientAccessDialog client={client} close={() => setAccess(false)} />}
  </section>;
}
