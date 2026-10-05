import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat/shell";
import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Chat · Blaze Flow" };

/** Slack-style chat: channels grouped by client, With client / Team only in each. */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="ch-shell"><p className="mt-alert" role="alert">No workspace is available.</p></div>;
  const params = await searchParams;
  // Allow /chat?channel=<id>&side=team deep links before the dynamic route is used.
  if (typeof params.channel === "string" && params.channel) {
    redirect(`/chat/${params.channel}${params.side === "team" ? "?side=team" : ""}`);
  }
  return <ChatShell workspaceId={workspace.id} />;
}
