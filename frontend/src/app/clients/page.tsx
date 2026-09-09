import { AppShell } from "@/components/app-shell";
import { loadClientsView } from "@/lib/clients-view";
import { loadSession } from "@/lib/session";
import { toShellUser } from "@/lib/user";
import { loadWorkspaceContext } from "@/lib/workspace";
import { ClientsPanel } from "./panel";
import "./clients.css";

export default async function ClientsPage() {
  const [session, view, context] = await Promise.all([loadSession(), loadClientsView(), loadWorkspaceContext()]);
  return <AppShell user={session.user ? toShellUser(session.user) : null} workspaces={context.ok ? context.data.workspaces : []} selectedWorkspaceId={context.ok ? context.data.selected?.id : null}><ClientsPanel view={view} /></AppShell>;
}
