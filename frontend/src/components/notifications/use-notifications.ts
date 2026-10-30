"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { markRead, type NotificationItem, type NotificationPage } from "@/lib/notifications";

/** How often the bell asks for news while the tab is visible. */
export const POLL_MS = 45_000;

function csrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

export type FeedOptions = {
  workspaceId: string | null;
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
  /** Poll every POLL_MS while visible. The /notifications page turns this off. */
  poll?: boolean;
};

export type Feed = {
  items: NotificationItem[];
  unreadCount: number;
  count: number;
  hasNext: boolean;
  status: "loading" | "ready" | "error";
  error: string | null;
  refresh: () => Promise<void>;
  markOneRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
};

/**
 * One page of the viewer's notifications for a workspace, with mark-read actions.
 *
 * Polling pauses while the tab is hidden (no timer runs at all) and catches up the moment
 * it becomes visible again, so a backgrounded tab costs nothing and a returning one is
 * never 45 seconds stale.
 */
export function useNotifications({ workspaceId, page = 1, pageSize = 15, unreadOnly = false, poll = true }: FeedOptions): Feed {
  const [data, setData] = useState<NotificationPage | null>(null);
  const [status, setStatus] = useState<Feed["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (workspaceId) query.set("workspace", workspaceId);
  if (unreadOnly) query.set("unread", "true");
  const url = `/api/notifications/?${query.toString()}`;

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const response = await fetch(url, { credentials: "include", signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in again to see notifications." : `Notifications could not load (${response.status}).`);
      const body = await response.json() as NotificationPage;
      setData(body);
      setStatus("ready");
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setStatus((current) => (current === "ready" ? "ready" : "error"));
      setError(caught instanceof Error ? caught.message : "Notifications could not load.");
    }
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const start = () => {
      stop();
      if (poll) timer = setInterval(() => void refresh(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void refresh(); start(); }
      else stop();
    };
    queueMicrotask(() => void refresh());
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      inflight.current?.abort();
    };
  }, [poll, refresh]);

  const markOneRead = useCallback(async (id: string) => {
    const response = await fetch(`/api/notifications/${id}/read/`, { method: "POST", credentials: "include", headers: { "X-CSRFToken": csrfToken() } }).catch(() => null);
    if (!response?.ok) return false;
    setData((current) => {
      if (!current) return current;
      const target = current.results.find((item) => item.id === id);
      const wasUnread = Boolean(target?.unread);
      return {
        ...current,
        results: markRead(current.results, new Set([id]), new Date().toISOString()),
        unread_count: Math.max(0, current.unread_count - (wasUnread ? 1 : 0)),
      };
    });
    return true;
  }, []);

  const markAllRead = useCallback(async () => {
    const response = await fetch("/api/notifications/read-all/", {
      method: "POST", credentials: "include",
      headers: { "X-CSRFToken": csrfToken(), "Content-Type": "application/json" },
      body: JSON.stringify(workspaceId ? { workspace_id: workspaceId } : {}),
    }).catch(() => null);
    if (!response?.ok) return false;
    setData((current) => current && { ...current, results: markRead(current.results, "all", new Date().toISOString()), unread_count: 0 });
    return true;
  }, [workspaceId]);

  return {
    items: data?.results ?? [],
    unreadCount: data?.unread_count ?? 0,
    count: data?.count ?? 0,
    hasNext: data?.has_next ?? false,
    status,
    error,
    refresh,
    markOneRead,
    markAllRead,
  };
}
