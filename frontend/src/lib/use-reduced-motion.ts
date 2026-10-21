"use client";

import { useSyncExternalStore } from "react";

/** `prefers-reduced-motion`, without pulling the motion library into a route just for this. */
const query = "(prefers-reduced-motion: reduce)";
const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null);
const subscribe = (notify: () => void) => {
  const list = media();
  if (!list) return () => {};
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
};

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
