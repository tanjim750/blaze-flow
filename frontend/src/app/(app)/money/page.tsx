import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { MoneyBoard } from "@/components/money/money-board";
import { listClientTeams, listProjects } from "@/lib/api";
import { getMoneySummary } from "@/lib/billing-api";
import { NO_BILLING } from "@/lib/money-view";
import { loadWorkspaceContext } from "@/lib/workspace";
import "./money.css";

/**
 * Money (billing demo): what clients owe us, what we owe editors, and the margin between.
 * Needs billing.view; the API enforces that too, this page just explains a 403 nicely.
 */
export default async function MoneyPage() {
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <MoneyProblem title="No workspace selected" body={context.ok ? "Pick a workspace from the sidebar." : context.error.detail} />;
  const access = workspace.billing ?? NO_BILLING;
  if (!access.view) {
    return <MoneyProblem title="Money is for owners and admins" body="Your role does not include billing. Ask a workspace owner if you need it. Your own earnings are on your dashboard." />;
  }
  const [summary, projects, clients] = await Promise.all([getMoneySummary(workspace.id), listProjects(workspace.id), listClientTeams(workspace.id)]);
  if (!summary.ok) return <MoneyProblem title="Money couldn't be loaded" body={summary.error.detail} />;
  const clientNames = new Map((clients.ok ? clients.data : []).map((client) => [client.id, client.name]));
  const invoiceable = (projects.ok ? projects.data : [])
    .filter((project) => project.client_team_id && project.status !== "ARCHIVED")
    .map((project) => ({ id: project.id, name: project.name, client: clientNames.get(project.client_team_id!) ?? "Client" }));
  return <MoneyBoard workspaceId={workspace.id} workspaceName={workspace.name} summary={summary.data} access={access} projects={invoiceable} now={new Date().toISOString()} />;
}

function MoneyProblem({ title, body }: { title: string; body: string }) {
  return <div className="money-page"><section className="money-empty is-page" role="status">
    <LockKeyhole aria-hidden="true" /><h1>{title}</h1><p>{body}</p><Link href="/">Back to dashboard</Link>
  </section></div>;
}
