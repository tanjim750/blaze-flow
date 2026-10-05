import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/shell";
import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Messages · Client portal · Blaze Flow" };

export default async function PortalChatPage() {
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="pt-page"><p className="pt-alert is-error" role="alert">No workspace is available.</p></div>;
  return <div className="pt-page"><ChatShell workspaceId={workspace.id} variant="portal" /></div>;
}
