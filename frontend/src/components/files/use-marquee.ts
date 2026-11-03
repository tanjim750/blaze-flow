"use client";

/**
 * Drag-to-select ("marquee" / lasso) for the Files grid and list.
 *
 * A primary-button mouse or pen press on empty space inside the scroll container starts it;
 * presses on an item (which keeps its own native drag-to-move), a button, a field or a link
 * never do, and touch input never does (a finger drag scrolls). The box is drawn in the
 * container's scroll coordinates so it stays anchored while the container auto-scrolls near
 * its top/bottom edge. Items whose rectangles intersect the box are selected; holding
 * Cmd/Ctrl/Shift at press time adds to the existing selection. A press-and-release without
 * movement on empty space clears the selection.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const THRESHOLD = 4;
const EDGE = 40;
const MAX_SPEED = 18;

export type Rect = { left: number; top: number; right: number; bottom: number };
export const intersects = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

type Options = {
  itemRefs: RefObject<Map<string, HTMLElement>>;
  order: string[];
  selected: ReadonlySet<string>;
  containerRef: RefObject<HTMLDivElement | null>;
  /** `base` is the selection to add to (empty unless a modifier was held at press time). */
  onChange: (ids: string[], base: Set<string>) => void;
  onClear: () => void;
};

type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; additive: boolean; moved: boolean; base: Set<string>; startContent?: { x: number; y: number } };

export function useMarquee({ itemRefs, containerRef, order, selected, onChange, onClear }: Options) {
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const latest = useRef({ order, selected, onChange, onClear });
  useEffect(() => { latest.current = { order, selected, onChange, onClear }; });

  const update = () => {
    const state = drag.current, container = containerRef.current;
    if (!state || !container) return;
    const bounds = container.getBoundingClientRect();
    // Content coordinates (client position + scroll offset) so the box survives scrolling.
    const toContent = (x: number, y: number) => ({ x: x - bounds.left + container.scrollLeft, y: y - bounds.top + container.scrollTop });
    const a = state.startContent ?? toContent(state.startX, state.startY);
    const b = toContent(state.x, state.y);
    const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
    setBox({ left, top, width: right - left, height: bottom - top });
    const area: Rect = { left: left - container.scrollLeft + bounds.left, top: top - container.scrollTop + bounds.top, right: right - container.scrollLeft + bounds.left, bottom: bottom - container.scrollTop + bounds.top };
    const ids = latest.current.order.filter((id) => { const node = itemRefs.current?.get(id); return node ? intersects(area, node.getBoundingClientRect()) : false; });
    latest.current.onChange(ids, state.base);
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = 0;
      const state = drag.current, container = containerRef.current;
      if (!state?.moved || !container) return;
      const bounds = container.getBoundingClientRect();
      let dy = 0;
      if (state.y < bounds.top + EDGE) dy = -Math.ceil(MAX_SPEED * Math.min(1, (bounds.top + EDGE - state.y) / EDGE));
      else if (state.y > bounds.bottom - EDGE) dy = Math.ceil(MAX_SPEED * Math.min(1, (state.y - bounds.bottom + EDGE) / EDGE));
      if (dy) { const before = container.scrollTop; container.scrollTop += dy; if (container.scrollTop !== before) update(); }
      if (drag.current) frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      state.x = event.clientX; state.y = event.clientY;
      if (!state.moved && Math.hypot(state.x - state.startX, state.y - state.startY) < THRESHOLD) return;
      if (!state.moved) { state.moved = true; window.getSelection?.()?.removeAllRanges(); }
      event.preventDefault();
      update();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const end = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      drag.current = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (!state.moved && !state.additive && event.type === "pointerup") latest.current.onClear();
      setBox(null);
      document.body.classList.remove("fx-marquee-dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); if (frame) cancelAnimationFrame(frame); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest(".fx-item, button, a, input, select, textarea, label, [role=menu], [role=dialog], .fx-list-head, .fx-section-head, .fx-dropzone, .fx-notice")) return;
    const container = containerRef.current;
    if (!container) return;
    // Ignore presses on the container's own scrollbar.
    const bounds = container.getBoundingClientRect();
    if (event.clientX - bounds.left >= container.clientWidth || event.clientY - bounds.top >= container.clientHeight) return;
    event.preventDefault(); // no text selection while lassoing
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, additive: event.shiftKey || event.metaKey || event.ctrlKey, moved: false, base: event.shiftKey || event.metaKey || event.ctrlKey ? new Set(latest.current.selected) : new Set<string>(), startContent: { x: event.clientX - bounds.left + container.scrollLeft, y: event.clientY - bounds.top + container.scrollTop } };
    document.body.classList.add("fx-marquee-dragging");
  };

  return { onPointerDown, box, active: box !== null };
}
