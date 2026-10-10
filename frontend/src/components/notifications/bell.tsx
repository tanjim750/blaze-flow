"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { openUniversalReview } from "@/components/universal-review";
import { badgeCount, describeNotification, groupByDay, sentence, type DescribedNotification } from "@/lib/notifications";
import { NotificationRow } from "./notification-row";
import { useNotifications } from "./use-notifications";
import "./notifications.css";

/**
 * The sidebar bell: unread count, a popover of recent items grouped by day, and a way to
 * the full list. Polls every 45s while the tab is visible (see `useNotifications`).
 */
export function NotificationBell({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const feed = useNotifications({ workspaceId, pageSize: 15 });
  const rows = useMemo(() => feed.items.map(describeNotification), [feed.items]);
  // `now` is read when the list renders, which is when it is opened or refreshed.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the clock whenever the rows change
  const now = useMemo(() => new Date(), [rows, open]);
  const groups = useMemo(() => groupByDay(rows, now), [rows, now]);
  const badge = badgeCount(feed.unreadCount);

  async function openRow(row: DescribedNotification) {
    if (row.unread) void feed.markOneRead(row.id);
    if (!row.href) return;
    setOpen(false);
    if (row.href.startsWith("/review?")) openUniversalReview({ href: row.href, title: sentence(row) });
    else router.push(row.href);
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) void feed.refresh(); }}>
      <PopoverTrigger asChild>
        <button type="button" className="studio-icon-button nf-bell" aria-label={feed.unreadCount ? `Notifications, ${feed.unreadCount} unread` : "Notifications"}>
          <Bell size={16} />
          {badge && <span className="nf-badge" aria-hidden="true">{badge}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={12} collisionPadding={12} className="nf-popover" aria-label="Notifications">
        <header className="nf-head">
          <strong>Notifications</strong>
          {feed.unreadCount > 0 && <span className="nf-count">{feed.unreadCount} unread</span>}
          <button type="button" className="nf-link" disabled={feed.unreadCount === 0} onClick={() => void feed.markAllRead()}>Mark all read</button>
        </header>
        <div className="nf-scroll">
          {feed.status === "loading" && !rows.length ? (
            <ul className="nf-skeleton" aria-label="Loading notifications">{[0, 1, 2].map((key) => <li key={key} />)}</ul>
          ) : feed.status === "error" && !rows.length ? (
            <div className="nf-empty" role="alert"><p>{feed.error}</p><button type="button" className="nf-link" onClick={() => void feed.refresh()}>Try again</button></div>
          ) : !rows.length ? (
            <div className="nf-empty"><Bell size={20} aria-hidden="true" /><p><strong>You&rsquo;re all caught up</strong><br />Notes on your cuts, replies, approvals and assignments show up here.</p></div>
          ) : groups.map((group) => (
            <section key={group.key} className="nf-group" aria-label={group.label}>
              <h3 suppressHydrationWarning>{group.label}</h3>
              <ul>
                {group.items.map((row) => (
                  <NotificationRow key={row.id} row={row} now={now} onOpen={(item) => void openRow(item)} onMarkRead={(item) => void feed.markOneRead(item.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="nf-foot">
          <Link href="/settings#notifications" onClick={() => setOpen(false)} className="nf-foot-pref"><Settings2 size={13} />Preferences</Link>
          <Link href="/notifications" onClick={() => setOpen(false)} className="nf-link">View all</Link>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
