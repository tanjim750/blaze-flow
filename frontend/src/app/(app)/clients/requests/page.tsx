import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { listProjectRequests } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";
import { RequestInbox } from "@/components/portal/request-inbox";
import "@/components/portal/portal.css";

export const metadata: Metadata = { title: "Project requests · Clients · Blaze Flow" };

export default async function ProjectRequestsPage() {
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const list = workspace ? await listProjectRequests(workspace.id) : null;
  return <div className="pt-page">
    <Link className="pt-back" href="/clients"><ArrowLeft size={14} />Clients</Link>
    <section className="pt-hero"><div><p className="pt-eyebrow">From the client portal</p><h1>Project requests</h1><p>Briefs your clients sent. Accepting opens a draft project for that client with the brief and specs filled in; declining sends them your note.</p></div></section>
    {!workspace || !list
      ? <p className="pt-alert is-error" role="alert">No workspace is available.</p>
      : !list.ok
        ? <p className="pt-alert is-error" role="alert">{list.error.status === 403 ? "You need permission to create projects to answer requests." : `Requests could not be loaded: ${list.error.detail}`}</p>
        : list.data.viewer !== "team"
          ? <p className="pt-alert is-error" role="alert">Only the studio team answers project requests. <Link href="/portal/requests">See your own requests</Link>.</p>
          : <RequestInbox workspaceId={workspace.id} requests={list.data.requests} />}
  </div>;
}
