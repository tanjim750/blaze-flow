"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { NotificationRow } from "@/components/notifications/notification-row";
import { useNotifications } from "@/components/notifications/use-notifications";
import "@/components/notifications/notifications.css";
import { describeNotification, groupByDay, type DescribedNotification } from "@/lib/notifications";

const PAGE_SIZE = 25;

export function NotificationsList({ workspaceId, workspaceName, filter, page }: {
  workspaceId: string | null; workspaceName: string | null; filter: "all" | "unread"; page: number;
}) {
  const router = useRouter();
  const feed = useNotifications({ workspaceId, page, pageSize: PAGE_SIZE, unreadOnly: filter === "unread" });
  const rows = useMemo(() => feed.items.map(describeNotification), [feed.items]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the clock whenever the rows change
  const now = useMemo(() => new Date(), [rows]);
  const groups = useMemo(() => groupByDay(rows, now), [rows, now]);
  const pages = Math.max(1, Math.ceil(feed.count / PAGE_SIZE));
  const href = (next: { filter?: string; page?: number }) => {
    const query = new URLSearchParams();
    const f = next.filter ?? filter;
    const p = next.page ?? 1;
    if (f === "unread") query.set("filter", "unread");
    if (p > 1) query.set("page", String(p));
    const text = query.toString();
    return text ? `/notifications?${text}` : "/notifications";
  };

  function open(row: DescribedNotification) {
    if (row.unread) void feed.markOneRead(row.id);
    if (row.href) router.push(row.href);
  }

  return (
    <div className="nf-page">
      <header>
        <div>
          <p className="eyebrow">{workspaceName ?? "Workspace"}</p>
          <h1>Notifications</h1>
          <p>Notes on your cuts, replies, new versions, approvals and task assignments.</p>
        </div>
        <Link className="nf-button" href="/settings#notifications"><Settings2 size={14} />Preferences</Link>
      </header>

      <div className="nf-toolbar">
        <nav className="nf-filters" aria-label="Filter notifications">
          <Link href={href({ filter: "all" })} aria-current={filter === "all" ? "page" : undefined}>All</Link>
          <Link href={href({ filter: "unread" })} aria-current={filter === "unread" ? "page" : undefined}>
            Unread{feed.unreadCount > 0 && <span>{feed.unreadCount}</span>}
          </Link>
        </nav>
        <button type="button" className="nf-button" disabled={feed.unreadCount === 0} onClick={() => void feed.markAllRead()}>
          <CheckCheck size={14} />Mark all read
        </button>
      </div>

      <div className="nf-card">
        {feed.status === "loading" && !rows.length ? (
          <ul className="nf-skeleton" aria-label="Loading notifications">{[0, 1, 2, 3, 4].map((key) => <li key={key} />)}</ul>
        ) : feed.status === "error" && !rows.length ? (
          <div className="nf-empty" role="alert"><p>{feed.error}</p><button type="button" className="nf-link" onClick={() => void feed.refresh()}>Try again</button></div>
        ) : !rows.length ? (
          <div className="nf-empty">
            <Bell size={22} aria-hidden="true" />
            <p>
              <strong>{filter === "unread" ? "No unread notifications" : page > 1 ? "Nothing on this page" : "No notifications yet"}</strong><br />
              {filter === "unread" ? "You’re all caught up." : "When someone comments on your cuts, replies, approves or assigns you a task, it shows up here."}
            </p>
            {filter === "unread" && <Link className="nf-link" href={href({ filter: "all" })}>See all notifications</Link>}
          </div>
        ) : groups.map((group) => (
          <section key={group.key} className="nf-group" aria-label={group.label}>
            <h3 suppressHydrationWarning>{group.label}</h3>
            <ul>
              {group.items.map((row) => (
                <NotificationRow key={row.id} wide row={row} now={now} onOpen={open} onMarkRead={(item) => void feed.markOneRead(item.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {feed.count > 0 && (
        <div className="nf-pager">
          <span>Page {page} of {pages} · {feed.count} {filter === "unread" ? "unread" : "total"}</span>
          <nav aria-label="Pages">
            <Link className="nf-button" href={href({ page: page - 1 })} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}><ChevronLeft size={14} />Newer</Link>
            <Link className="nf-button" href={href({ page: page + 1 })} aria-disabled={!feed.hasNext} tabIndex={!feed.hasNext ? -1 : undefined}>Older<ChevronRight size={14} /></Link>
          </nav>
        </div>
      )}
    </div>
  );
}
