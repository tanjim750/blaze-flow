"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Channel the branding form announces saves on, so open portal tabs repaint at once. */
export const BRANDING_CHANNEL = "bf-branding";

/** Tell every open tab (this one included) that the studio branding changed. */
export function announceBrandingChange(workspaceId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(BRANDING_CHANNEL);
  channel.postMessage({ workspaceId, at: Date.now() });
  channel.close();
}

/**
 * Mounted on client-portal screens. Re-fetches the server-rendered page when branding is
 * saved in another tab, and when the tab comes back into view, so a new accent colour,
 * welcome line or logo shows without a manual refresh (R7).
 */
export function BrandingSync({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(BRANDING_CHANNEL);
    const onMessage = (event: MessageEvent<{ workspaceId?: string }>) => {
      if (!workspaceId || !event.data?.workspaceId || event.data.workspaceId === workspaceId) router.refresh();
    };
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) router.refresh(); };
    channel?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
    };
  }, [router, workspaceId]);
  return null;
}
