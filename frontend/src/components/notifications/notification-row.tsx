"use client";

import { useState } from "react";
import { AtSign, Check, CheckCheck, CircleCheckBig, FilePlus2, FolderInput, Inbox, ListTodo, MessageSquareText, MessagesSquare, Reply, RotateCcw, Bell } from "@/components/icons";
import { actorsLabel, sentence, timeLabel, type CollapsedNotification, type DescribedNotification, type NotificationTone } from "@/lib/notifications";

const TONE_ICON: Record<NotificationTone, typeof Bell> = {
  comment: MessageSquareText, reply: Reply, mention: AtSign, version: FilePlus2,
  approved: CircleCheckBig, changes: RotateCcw, task: ListTodo, upload: FolderInput, request: Inbox, message: MessagesSquare, other: Bell,
};

/** The actor's avatar, or their initials on the accent plate, with the kind as a small badge. */
export function NotificationAvatar({ row }: { row: DescribedNotification }) {
  const [broken, setBroken] = useState(false);
  const Icon = TONE_ICON[row.tone];
  return (
    <span className="nf-avatar" aria-hidden="true">
      {row.avatarUrl && !broken
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied avatar URL on any origin
        ? <img src={row.avatarUrl} alt="" onError={() => setBroken(true)} />
        : <b>{row.initials}</b>}
      <i className={`nf-kind is-${row.tone}`}><Icon size={9} strokeWidth={2.5} /></i>
    </span>
  );
}

/**
 * A fixed 40px slot on the right of every row: the cut's still when there is one, else the
 * event's type icon, so titles and times line up down the list.
 */
export function NotificationPoster({ src, tone }: { src: string | null; tone: NotificationTone }) {
  const [broken, setBroken] = useState(false);
  const Icon = TONE_ICON[tone];
  if (!src || broken) return <span className={`nf-poster is-icon is-${tone}`} aria-hidden="true"><Icon size={16} /></span>;
  // eslint-disable-next-line @next/next/no-img-element -- permission-checked API route, not a static asset
  return <img className="nf-poster" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function NotificationRow({ row, now, onOpen, onMarkRead, wide = false }: {
  row: DescribedNotification | CollapsedNotification;
  now: Date;
  onOpen: (row: DescribedNotification) => void;
  onMarkRead: (row: DescribedNotification) => void;
  wide?: boolean;
}) {
  const repeat = "repeat" in row ? row.repeat : 1;
  const actor = "actors" in row ? actorsLabel(row.actors) : row.actor;
  const label = `${repeat > 1 ? `${repeat} times: ` : ""}${sentence({ ...row, actor })}${row.unread ? " (unread)" : ""}`;
  return (
    <li className={`nf-row${row.unread ? " is-unread" : ""}${wide ? " is-wide" : ""}`}>
      <button type="button" className="nf-open" onClick={() => onOpen(row)} aria-label={label} disabled={!row.href && !row.unread}>
        <NotificationAvatar row={row} />
        <span className="nf-text">
          <span className="nf-line">
            {repeat > 1 && <b className="nf-repeat" title={`${repeat} identical events`}>{repeat}×</b>}
            <strong>{actor}</strong> {row.verb}{row.subject && <> <em>{row.subject}</em></>}
          </span>
          {row.snippet && <span className="nf-snippet">“{row.snippet}”</span>}
          <small suppressHydrationWarning>{timeLabel(row.createdAt, now)}</small>
        </span>
        <NotificationPoster src={row.posterUrl} tone={row.tone} />
      </button>
      {row.unread
        ? <button type="button" className="nf-mark" onClick={() => onMarkRead(row)} aria-label="Mark as read" title="Mark as read"><Check size={13} /></button>
        : <span className="nf-mark is-done" aria-hidden="true"><CheckCheck size={13} /></span>}
    </li>
  );
}
