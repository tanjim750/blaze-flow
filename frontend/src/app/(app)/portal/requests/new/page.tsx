import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getBranding, listProjectRequests } from "@/lib/api";
import { accentStyle } from "@/lib/portal";
import { loadWorkspaceContext } from "@/lib/workspace";
import { PortalBrandBar } from "@/components/portal/brand-bar";
import { ProjectRequestForm } from "@/components/portal/request-form";
import "@/components/portal/portal.css";

export const metadata: Metadata = { title: "Start a new project · Client portal · Blaze Flow" };

const todayIso = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default async function NewProjectRequestPage() {
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="pt-page"><p className="pt-alert is-error" role="alert">No workspace is available.</p></div>;
  const [branding, list] = await Promise.all([getBranding(workspace.id), listProjectRequests(workspace.id)]);
  const brand = branding.ok ? branding.data : { studio_name: workspace.name, brand_color: null, logo_url: null, portal_welcome: null };
  return <div className="pt-page pt-scope" style={accentStyle(brand.brand_color)}>
    <Link className="pt-back" href="/portal/requests"><ArrowLeft size={14} />Your requests</Link>
    <PortalBrandBar branding={brand} eyebrow="New project" />
    <section className="pt-hero"><div><p className="pt-eyebrow">Start a new project</p><h1>Tell {brand.studio_name} what you need</h1><p>Three quick steps. Nothing is booked until the studio accepts.</p></div></section>
    {list.ok && list.data.can_request
      ? <ProjectRequestForm workspaceId={workspace.id} studioName={brand.studio_name} clientTeams={list.data.client_teams} today={todayIso()} />
      : <p className="pt-alert is-error" role="alert">New project requests come from client contacts. Team members create projects from Projects.</p>}
  </div>;
}
