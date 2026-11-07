"use client";

import { useEffect, useRef } from "react";

/**
 * Closes a hand-rolled modal on Esc wherever focus is. A keydown handler on the modal itself
 * misses Esc once focus has left it, e.g. after a submit button disables itself and focus
 * falls back to <body> (R3, B5). Nested open menus/dialogs handle Esc first via `defaultPrevented`.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const latest = useRef(onEscape);
  useEffect(() => { latest.current = onEscape; });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
