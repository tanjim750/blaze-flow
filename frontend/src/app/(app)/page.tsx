import { redirect } from "next/navigation";
import { CloudOff } from "lucide-react";
import { ClientDashboard } from "@/components/dashboards/client-dashboard";
import { EditorDashboard } from "@/components/dashboards/editor-dashboard";
import { OwnerDashboard } from "@/components/dashboards/owner-dashboard";
import { partOfDay } from "@/components/dashboards/parts";
import { DashboardRetry } from "@/components/dashboard-retry";
import { listWorkspaces } from "@/lib/api";
import { chooseLayout } from "@/lib/dashboard-role";
import { failureView, type DashboardFailure } from "@/lib/dashboard-view";
import { loadClientDashboard, loadEditorDashboard, loadOwnerDashboard } from "@/lib/role-dashboard-view";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import { selectWorkspace } from "@/lib/workspace";
import "./home.css";

/**
 * The dashboard. One of three layouts by the viewer's role in the selected workspace
 * (owner, editor or client, from `dashboard_role` on the workspace list). Owners can
 * preview the other two with `?view=editor` / `?view=client`; see `lib/dashboard-role.ts`.
 */
export default async function Dashboard({ searchParams }: PageProps<"/">) {
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const greetingName = session.user ? displayName(session.user).split(" ")[0] : "there";
  const now = new Date();

  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return <DashboardError view={failureView(greetingName, now, workspaces.error)} />;
  if (session.user && workspaces.data.length === 0) redirect("/onboarding");
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return <DashboardError view={failureView(greetingName, now, { status: 404, detail: "This account has no workspace yet." })} />;

  const choice = chooseLayout(workspace, (await searchParams).view);
  if (choice.layout === "editor") {
    return <EditorDashboard view={await loadEditorDashboard(greetingName, workspace)} choice={choice} />;
  }
  if (choice.layout === "client") {
    const view = await loadClientDashboard(greetingName, workspace);
    return "status" in view ? <DashboardError view={view} /> : <ClientDashboard view={view} choice={choice} />;
  }
  const view = await loadOwnerDashboard(greetingName, workspace);
  return "status" in view ? <DashboardError view={view} /> : <OwnerDashboard view={view} choice={choice} />;
}

function DashboardError({ view }: { view: DashboardFailure }) {
  return <div className="home-shell">
    <div className="dashboard-heading">
      <p>{view.today}</p>
      <h1>Good {partOfDay()}, {view.greetingName}</h1>
    </div>
    <section className="home-error" role="alert" aria-labelledby="dashboard-error-title">
      <CloudOff size={22} aria-hidden="true" />
      <h2 id="dashboard-error-title">{view.title}</h2>
      <p>{view.detail}</p>
      <DashboardRetry />
    </section>
  </div>;
}
