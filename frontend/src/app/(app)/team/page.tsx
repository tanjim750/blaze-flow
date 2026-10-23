import { guardRoute } from "@/lib/route-guard";
import { loadTeamView } from "@/lib/team-view";
import { TeamPanel } from "./panel";
import "./team.css";

export default async function TeamPage() {
  await guardRoute("/team");
  const view = await loadTeamView();
  return <><TeamPanel view={view} /></>;
}
