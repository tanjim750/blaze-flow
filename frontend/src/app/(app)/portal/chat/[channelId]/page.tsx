import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/shell";
import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Messages · Client portal · Blaze Flow" };

export default async function PortalChatChannelPage({ params }: PageProps<"/portal/chat/[channelId]">) {
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const { channelId } = await params;
  if (!workspace) return <div className="pt-page"><p className="pt-alert is-error" role="alert">No workspace is available.</p></div>;
  return <div className="pt-page"><ChatShell key={channelId} workspaceId={workspace.id} initialChannelId={channelId} initialSide="client" variant="portal" /></div>;
}
