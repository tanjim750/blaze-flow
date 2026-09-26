"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** A width the user can drag, remembered in localStorage. `null` means "use the default". */
export function useStoredNumber(key: string): [number | null, (value: number | null) => void] {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    // Loads after mount so server and client render the same first frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const stored = Number(window.localStorage.getItem(key)); if (stored > 0) setValue(stored); } catch { /* storage blocked */ }
  }, [key]);
  const set = (next: number | null) => {
    setValue(next);
    try { if (next === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, String(Math.round(next))); } catch { /* storage blocked */ }
  };
  return [value, set];
}

/**
 * The drag handle between two panels (DS §1): an 8px hit area with a 1px line that shows on
 * hover and focus. It is a focusable `separator` with a value, so the keyboard can resize
 * too: ←/→ by 16px, Home resets. Double-click resets as well.
 *
 * `edge` says which side the panel sits on: dragging right grows a left panel and shrinks
 * a right one.
 */
export function PanelResizer({ label, value, min, max, fallback, edge, onChange }: {
  label: string; value: number; min: number; max: number; fallback: number; edge: "left" | "right";
  onChange: (value: number | null) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (width: number) => Math.min(max, Math.max(min, width));
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    start.current = { x: event.clientX, width: value };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = event.clientX - start.current.x;
    onChange(clamp(start.current.width + (edge === "left" ? delta : -delta)));
  };
  const onPointerUp = () => { start.current = null; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const grow = edge === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = edge === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key === grow) { event.preventDefault(); onChange(clamp(value + step)); }
    if (event.key === shrink) { event.preventDefault(); onChange(clamp(value - step)); }
    if (event.key === "Home") { event.preventDefault(); onChange(null); }
  };
  return (
    <div
      className={`fx-resizer is-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · double-click to reset to ${fallback}px`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(null)}
      onKeyDown={onKeyDown}
    />
  );
}
