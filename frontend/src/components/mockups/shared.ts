"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { siteConfig } from "@/lib/site-config";

/**
 * Shared bits for the three homepage mockups (/mockups/*). Brand and price always come
 * from siteConfig, so the mockups rename with the product.
 */
export const brand = siteConfig.name;
export const price = `${siteConfig.pricing.symbol}${siteConfig.pricing.proMonthly}`;
export const trialDays = siteConfig.pricing.trialDays;
export const links = siteConfig.links;

export const shots = {
  review: "/marketing/review.webp",
  aiqaPoster: "/marketing/aiqa-poster.webp",
  aiqaVideo: "/marketing/aiqa-video.webp",
  portal: "/marketing/portal.webp",
  files: "/marketing/files.webp",
  tasks: "/marketing/tasks.webp",
  dashboard: "/marketing/dashboard.webp",
  poster: "/marketing/demo-poster.webp",
} as const;

export const clip = { webm: "/marketing/demo-clip.webm", mp4: "/marketing/demo-clip.mp4" };

/**
 * Plays a muted, looping clip once mounted, only while on screen and never for
 * prefers-reduced-motion (the poster frame stays up instead). No `autoplay` attribute:
 * it would start before hydration, ahead of the motion check.
 */
export function useAutoplay(ref: RefObject<HTMLVideoElement | null>, onState?: (playing: boolean) => void) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = () => { if (!reduce.matches) video.play()?.catch(() => onState?.(false)); };
    const onPlay = () => onState?.(true);
    const onPause = () => onState?.(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    const observer = typeof IntersectionObserver === "undefined" ? undefined
      : new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : video.pause()), { threshold: 0 });
    if (observer) observer.observe(video); else start();
    return () => { observer?.disconnect(); video.removeEventListener("play", onPlay); video.removeEventListener("pause", onPause); };
  }, [ref, onState]);
}

/** mm:ss:ff at 25 fps, the way an editor reads time. */
export function timecode(seconds: number, hours = true): string {
  const s = Math.max(0, seconds);
  const ff = Math.floor((s % 1) * 25);
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const core = `${pad((s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
  return hours ? `${pad(s / 3600 + 1)}:${core}` : core;
}

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** prefers-reduced-motion, hydration-safe: false on the server and during hydration, then the real value. */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE_QUERY).matches, () => false);
}
