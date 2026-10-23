"use client";

import { useSyncExternalStore } from "react";

/*
 * Motion budget for the public site, read hydration-safely: the server and the first client
 * render both assume "full motion off" (static), then the real value takes over. So the
 * markup never mismatches, and nobody gets an animation they asked not to have.
 */

function mediaStore(query: string) {
  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  };
  const get = () => (typeof window !== "undefined" && !!window.matchMedia?.(query)?.matches);
  return { subscribe, get };
}

const reduceStore = mediaStore("(prefers-reduced-motion: reduce)");
const smallStore = mediaStore("(max-width: 699px)");
const finePointerStore = mediaStore("(hover: hover) and (pointer: fine)");
const noop = () => () => {};

/** True when the visitor asked for reduced motion. */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(reduceStore.subscribe, reduceStore.get, () => false);
}

/** True on devices with a real mouse, where pointer-driven tilt makes sense. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(finePointerStore.subscribe, finePointerStore.get, () => false);
}

function lowPower(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return !!nav.connection?.saveData || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 2;
}

/**
 * "Lite" motion: small screens, data-saver and low-power devices skip the continuous,
 * scroll-linked effects (parallax, the showcase's 3D swing) and keep only the one-shot
 * entrances. Reduced motion is lite too, and additionally skips the entrances.
 */
export function useLiteMotion(): boolean {
  const reduce = useReducedMotionSafe();
  const small = useSyncExternalStore(smallStore.subscribe, smallStore.get, () => false);
  const weak = useSyncExternalStore(noop, lowPower, () => false);
  return reduce || small || weak;
}
