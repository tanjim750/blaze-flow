import { AppShell } from "@/components/app-shell";
import { loadSession } from "@/lib/session";
import { loadTeamView } from "@/lib/team-view";
import { toShellUser } from "@/lib/user";
import { loadWorkspaceContext } from "@/lib/workspace";
import { TeamPanel } from "./panel";
import "./team.css";

export default async function TeamPage() {
  const [session, context, view] = await Promise.all([loadSession(), loadWorkspaceContext(), loadTeamView()]);
  return <AppShell user={session.user && toShellUser(session.user)} workspaces={context.ok ? context.data.workspaces : []} selectedWorkspaceId={context.ok ? context.data.selected?.id : null}><TeamPanel view={view} /></AppShell>;
}
