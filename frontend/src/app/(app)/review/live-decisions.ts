"use client";

import { useEffect, useRef } from "react";
import type { ReviewTarget } from "@/lib/review-media";

/** How often an open review page checks for a client decision made elsewhere. */
export const LIVE_DECISION_POLL_MS = 15_000;

/**
 * Calls `onChange` when a newer client decision lands on this cut (a guest approving in
 * another session, say), so the review page updates without a reload. It polls the same
 * decisions route the page loads from, only while the tab is visible, and stops on unmount.
 */
export function useLiveDecisions(target: ReviewTarget | null, knownLatestId: string | null, onChange: () => void) {
  const latest = useRef(knownLatestId);
  const callback = useRef(onChange);
  useEffect(() => { latest.current = knownLatestId; callback.current = onChange; });
  const key = target ? `${target.workspaceId}/${target.projectId}/${target.versionId}` : null;
  useEffect(() => {
    if (!target) return;
    let active = true;
    const url = `/api/workspaces/${target.workspaceId}/projects/${target.projectId}/media-versions/${target.versionId}/decisions/`;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok || !active) return;
        const body = (await response.json()) as { results?: { id: string }[] };
        const newest = body.results?.[0]?.id ?? null;
        if (newest && newest !== latest.current) { latest.current = newest; callback.current(); }
      } catch { /* offline: try again next tick */ }
    };
    const timer = window.setInterval(() => void check(), LIVE_DECISION_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when the cut changes
  }, [key]);
}
