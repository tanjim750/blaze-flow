import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/shell";
import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Chat · Blaze Flow" };

export default async function ChatChannelPage({ params, searchParams }: PageProps<"/chat/[channelId]">) {
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  const { channelId } = await params;
  const query = await searchParams;
  if (!workspace) return <div className="ch-shell"><p className="mt-alert" role="alert">No workspace is available.</p></div>;
  return <ChatShell key={`${channelId}:${query.side === "team" ? "team" : "client"}`} workspaceId={workspace.id} initialChannelId={channelId} initialSide={query.side === "team" ? "team" : "client"} />;
}
