"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { call } from "@/lib/client-uploads";
import { chatHref, clock, dayLabel, fetchUnread, unreadLabel, type Channel, type Thread } from "@/lib/messages";
import "./chat.css";

/** Compact "Latest in chat" card for a project page, linking into /chat. */
export function ChatPreview({ workspaceId, projectId, variant = "studio" }: {
  workspaceId: string; projectId: string; variant?: "studio" | "portal";
}) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<{ author: string; snippet: string; at: string; side: Channel }[]>([]);

  useEffect(() => {
    let alive = true;
    void fetchUnread(workspaceId).then(async (summary) => {
      if (!alive || !summary.ok) return;
      const row = summary.data.projects.find((project) => project.project_id === projectId);
      const id = row?.chat_channel_id ?? null;
      setChannelId(id);
      setUnread(row?.total_unread ?? 0);
      if (!id) return;
      const thread = await call<Thread>(`/workspaces/${workspaceId}/chat/channels/${id}/messages/?channel=client`);
      if (!alive || !thread.ok) return;
      setLatest(thread.data.messages.slice(-3).reverse().map((message) => ({
        author: message.author.name, snippet: message.body || "sent an attachment",
        at: message.created_at, side: message.channel,
      })));
    });
    return () => { alive = false; };
  }, [workspaceId, projectId]);

  const href = channelId ? chatHref(channelId, variant === "portal" ? "client" : "team") : variant === "portal" ? "/portal/chat" : "/chat";

  return <section className="ch-preview" aria-labelledby="ch-preview-title">
    <div className="ch-preview-head">
      <h2 id="ch-preview-title"><MessagesSquare aria-hidden="true" />Latest in chat</h2>
      <Link className="pt-ghost" href={href} style={{ height: 30, padding: "0 10px", fontSize: 12 }}>
        {unread > 0 ? `${unreadLabel(unread)} unread` : "Open chat"}<ArrowRight size={13} />
      </Link>
    </div>
    {latest.length === 0
      ? <p className="ch-preview-empty">No messages yet. Open chat to start the conversation.</p>
      : <ul className="ch-preview-list">{latest.map((row, index) => <li key={`${row.at}-${index}`}>
        <strong>{row.author} · {dayLabel(row.at) === "Today" ? clock(row.at) : dayLabel(row.at)}</strong>
        <span>{row.snippet}</span>
      </li>)}</ul>}
  </section>;
}
