"use client";

import { useState } from "react";
import { AtSign, Check, CheckCheck, CircleCheckBig, FilePlus2, FolderInput, Inbox, ListTodo, MessageSquareText, Reply, RotateCcw, Bell } from "lucide-react";
import { sentence, timeLabel, type DescribedNotification, type NotificationTone } from "@/lib/notifications";

const TONE_ICON: Record<NotificationTone, typeof Bell> = {
  comment: MessageSquareText, reply: Reply, mention: AtSign, version: FilePlus2,
  approved: CircleCheckBig, changes: RotateCcw, task: ListTodo, upload: FolderInput, request: Inbox, other: Bell,
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

/** A letterboxed 16:9 still of the cut, or nothing at all when there is none or it fails. */
export function NotificationPoster({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  // eslint-disable-next-line @next/next/no-img-element -- permission-checked API route, not a static asset
  return <img className="nf-poster" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function NotificationRow({ row, now, onOpen, onMarkRead, wide = false }: {
  row: DescribedNotification;
  now: Date;
  onOpen: (row: DescribedNotification) => void;
  onMarkRead: (row: DescribedNotification) => void;
  wide?: boolean;
}) {
  return (
    <li className={`nf-row${row.unread ? " is-unread" : ""}${wide ? " is-wide" : ""}`}>
      <button type="button" className="nf-open" onClick={() => onOpen(row)} aria-label={`${sentence(row)}${row.unread ? " (unread)" : ""}`} disabled={!row.href && !row.unread}>
        <NotificationAvatar row={row} />
        <span className="nf-text">
          <span className="nf-line">
            <strong>{row.actor}</strong> {row.verb}{row.subject && <> <em>{row.subject}</em></>}
          </span>
          {row.snippet && <span className="nf-snippet">“{row.snippet}”</span>}
          <small suppressHydrationWarning>{timeLabel(row.createdAt, now)}</small>
        </span>
        <NotificationPoster src={row.posterUrl} />
      </button>
      {row.unread
        ? <button type="button" className="nf-mark" onClick={() => onMarkRead(row)} aria-label="Mark as read" title="Mark as read"><Check size={13} /></button>
        : <span className="nf-mark is-done" aria-hidden="true"><CheckCheck size={13} /></span>}
    </li>
  );
}
