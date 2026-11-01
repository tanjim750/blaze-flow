import { guardRoute } from "@/lib/route-guard";
import { loadTeamView } from "@/lib/team-view";
import { loadWorkspaceContext } from "@/lib/workspace";
import { hasFeature } from "@/lib/plan";
import { UpgradePrompt } from "@/components/plan/upgrade-prompt";
import { TeamPanel } from "./panel";
import "./team.css";

export default async function TeamPage() {
  await guardRoute("/team");
  const context = await loadWorkspaceContext();
  // Solo is one person: the API refuses invites (403 plan_upgrade_required), so say why here.
  if (context.ok && !hasFeature(context.data.selected, "team_members")) {
    return <div className="team-solo">
      <header className="team-solo-head"><h1>Team &amp; Roles</h1><p>Your Solo workspace is just you.</p></header>
      <UpgradePrompt feature="team_members" />
    </div>;
  }
  const view = await loadTeamView();
  return <><TeamPanel view={view} /></>;
}
