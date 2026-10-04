import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Inbox, Plus } from "lucide-react";
import { getBranding, listProjectRequests } from "@/lib/api";
import { accentStyle } from "@/lib/portal";
import { loadWorkspaceContext } from "@/lib/workspace";
import { PortalBrandBar } from "@/components/portal/brand-bar";
import { ClientRequestList } from "@/components/portal/request-list";
import "@/components/portal/portal.css";

export const metadata: Metadata = { title: "Your requests · Client portal · Blaze Flow" };

export default async function ClientRequestsPage() {
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="pt-page"><p className="pt-alert is-error" role="alert">No workspace is available.</p></div>;
  const [branding, list] = await Promise.all([getBranding(workspace.id), listProjectRequests(workspace.id)]);
  const brand = branding.ok ? branding.data : { studio_name: workspace.name, brand_color: null, logo_url: null, portal_welcome: null };
  return <div className="pt-page pt-scope" style={accentStyle(brand.brand_color)}>
    <Link className="pt-back" href="/"><ArrowLeft size={14} />Back to your portal</Link>
    <PortalBrandBar branding={brand}>
      {list.ok && list.data.can_request && <Link className="pt-cta" href="/portal/requests/new"><Plus />Start a new project</Link>}
    </PortalBrandBar>
    <section className="pt-card" aria-labelledby="pt-req-title">
      <div className="pt-card-head"><h2 id="pt-req-title"><Inbox />Your project requests</h2>{list.ok && <small>{list.data.requests.length} sent</small>}</div>
      {!list.ok
        ? <p className="pt-alert is-error" role="alert">{list.error.status === 403 ? "Project requests are for client contacts." : `Requests could not be loaded: ${list.error.detail}`}</p>
        : list.data.requests.length === 0
          ? <p className="pt-empty">Nothing sent yet. When you have a new idea, start a project and {brand.studio_name} will pick it up from here.</p>
          : <ClientRequestList workspaceId={workspace.id} requests={list.data.requests} />}
    </section>
  </div>;
}
