import { redirect } from "next/navigation";
import { CloudOff } from "@/components/icons";
import { ClientDashboard } from "@/components/dashboards/client-dashboard";
import { EditorDashboard } from "@/components/dashboards/editor-dashboard";
import { OwnerDashboard } from "@/components/dashboards/owner-dashboard";
import { SoloDashboard } from "@/components/dashboards/solo-dashboard";
import { DashboardRetry } from "@/components/dashboard-retry";
import { listWorkspaces } from "@/lib/api";
import { chooseLayout } from "@/lib/dashboard-role";
import { noticeFor } from "@/lib/role-nav";
import { failureView, type DashboardFailure } from "@/lib/dashboard-view";
import { loadClientDashboard, loadEditorDashboard, loadOwnerDashboard } from "@/lib/role-dashboard-view";
import { loadSession } from "@/lib/session";
import { isSolo } from "@/lib/plan";
import { loadSoloDashboard } from "@/lib/solo-dashboard-view";
import { accountName, accountTitle } from "@/lib/user";
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
  const greetingName = session.user ? accountName(session.user) : "";
  const now = new Date();

  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return <DashboardError view={failureView(greetingName, now, workspaces.error)} />;
  if (session.user && workspaces.data.length === 0) redirect("/onboarding");
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return <DashboardError view={failureView(greetingName, now, { status: 404, detail: "This account has no workspace yet." })} />;

  const params = await searchParams;
  const choice = chooseLayout(workspace, params.view);
  // Set by a route guard that sent the viewer here from a page their role doesn't use.
  const notice = noticeFor(params.notice);
  const banner = notice ? <p className="role-guard-notice" role="status">{notice}</p> : null;
  if (choice.layout === "editor") {
    return <>{banner}<EditorDashboard view={await loadEditorDashboard(greetingName, workspace)} choice={choice} /></>;
  }
  if (choice.layout === "client") {
    const view = await loadClientDashboard(greetingName, workspace);
    return "status" in view ? <DashboardError view={view} /> : <>{banner}<ClientDashboard view={view} choice={choice} /></>;
  }
  if (isSolo(workspace)) {
    // Solo: one person, so a focused "my day" dashboard with no team, editor or payout widgets.
    const solo = await loadSoloDashboard(greetingName, workspace);
    return solo.status === "error" ? <DashboardError view={solo} /> : <>{banner}<SoloDashboard view={solo} choice={choice} /></>;
  }
  const view = await loadOwnerDashboard(greetingName, workspace);
  return "status" in view ? <DashboardError view={view} /> : <>{banner}<OwnerDashboard view={view} choice={choice} /></>;
}

function DashboardError({ view }: { view: DashboardFailure }) {
  return <div className="home-shell">
    <div className="dashboard-heading">
      <h1>{accountTitle(view.greetingName)}</h1>
    </div>
    <section className="home-error" role="alert" aria-labelledby="dashboard-error-title">
      <CloudOff size={22} aria-hidden="true" />
      <h2 id="dashboard-error-title">{view.title}</h2>
      <p>{view.detail}</p>
      <DashboardRetry />
    </section>
  </div>;
}
