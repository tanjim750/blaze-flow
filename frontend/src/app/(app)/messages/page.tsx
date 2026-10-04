import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { getMessageUnread } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { loadWorkspaceContext } from "@/lib/workspace";
import { MessagesInbox } from "@/components/messages/inbox";
import "@/components/messages/messages.css";

export const metadata: Metadata = { title: "Messages · Blaze Flow" };

/** Every project conversation in the selected workspace, newest first, with unread counts. */
export default async function MessagesPage() {
  await loadSession();
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="mt-page"><p className="mt-alert" role="alert">No workspace is available.</p></div>;
  const summary = await getMessageUnread(workspace.id);
  return <div className="mt-page">
    <header className="mt-page-head">
      <div>
        <p>{workspace.name}</p>
        <h1><MessagesSquare aria-hidden="true" />Messages</h1>
      </div>
      {summary.ok && <span className="mt-page-count">{summary.data.total_unread ? `${summary.data.total_unread} unread` : "All caught up"}</span>}
    </header>
    {summary.ok
      ? <MessagesInbox workspaceId={workspace.id} initial={summary.data} emptyText="You are not on any projects yet." />
      : <p className="mt-alert" role="alert">Messages could not be loaded: {summary.error.detail}</p>}
  </div>;
}
