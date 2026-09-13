import { loadTeamView } from "@/lib/team-view";
import { TeamPanel } from "./panel";
import "./team.css";

export default async function TeamPage() {
  const view = await loadTeamView();
  return <><TeamPanel view={view} /></>;
}
