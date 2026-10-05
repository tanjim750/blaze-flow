"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, MessagesSquare, Users } from "lucide-react";
import { dayLabel, clock, fetchUnread, threadHref, unreadLabel, type UnreadSummary } from "@/lib/messages";
import "./messages.css";

/** When the last message landed: a time today, otherwise the day. */
function when(iso: string) {
  const day = dayLabel(iso);
  return day === "Today" ? clock(iso) : day;
}

/**
 * Every project thread this person can read, newest first, with unread counts per channel.
 * Refreshes every half minute while visible. Shared by /messages and the client home.
 */
export function MessagesInbox({ workspaceId, initial, limit, emptyText }: {
  workspaceId: string; initial: UnreadSummary; limit?: number; emptyText?: string;
}) {
  const [summary, setSummary] = useState(initial);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchUnread(workspaceId).then((result) => { if (result.ok) setSummary(result.data); });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [workspaceId]);

  const rows = limit ? summary.projects.filter((row) => row.last_message_at || row.total_unread).slice(0, limit) : summary.projects;
  if (rows.length === 0) return <p className="mt-empty-line">{emptyText ?? "No project conversations yet."}</p>;
  return <ul className="mt-inbox">
    {rows.map((row) => <li key={row.project_id}>
      <Link className={`mt-inbox-row${row.total_unread ? " is-unread" : ""}`} href={threadHref(row.project_id, row.viewer_kind, row.unread.team && !row.unread.client ? "team" : undefined, row.chat_channel_id)}>
        <span className="mt-inbox-title"><MessagesSquare size={15} aria-hidden="true" /><strong>{row.project_name}</strong>{row.client_name && row.viewer_kind === "team" && <small>{row.client_name}</small>}</span>
        <p className="mt-inbox-latest">{row.latest
          ? <>{row.latest.channel === "team" && <Lock size={11} aria-label="Team only" />} <b>{row.latest.author_name}:</b> {row.latest.snippet || "sent an attachment"}</>
          : "No messages yet"}</p>
        <span className="mt-inbox-meta">
          {row.last_message_at && <time dateTime={row.last_message_at}>{when(row.last_message_at)}</time>}
          <span className="mt-inbox-split">
            {(row.unread.client ?? 0) > 0 && <span className="mt-tag is-hot" title="Unread with the client"><Users aria-hidden="true" />{unreadLabel(row.unread.client ?? 0)}</span>}
            {(row.unread.team ?? 0) > 0 && <span className="mt-tag is-team" title="Unread team-only"><Lock aria-hidden="true" />{unreadLabel(row.unread.team ?? 0)}</span>}
          </span>
        </span>
      </Link>
    </li>)}
  </ul>;
}
