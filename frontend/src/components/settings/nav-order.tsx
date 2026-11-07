"use client";

import { useRef, useState, useTransition, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "@/components/icons";
import { saveNavOrderAction } from "@/app/(app)/settings/actions";
import { DEFAULT_NAV_ORDER, effectiveNavOrder, NAV_KEY_LABELS, type NavKey } from "@/lib/role-nav";

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, index) => key === b[index]);

/**
 * Owner-only sidebar reorder. Drag a row by its handle, or focus the handle and use the
 * arrow keys (Home/End jump to the ends); the up/down buttons do the same for pointer users
 * who prefer not to drag. Nothing changes for the team until "Save order".
 */
export function NavOrderForm({ initial, canEdit }: { initial: string[]; canEdit: boolean }) {
  const [saved, setSaved] = useState<NavKey[]>(effectiveNavOrder(initial));
  const [order, setOrder] = useState<NavKey[]>(saved);
  const [dragging, setDragging] = useState<NavKey | null>(null);
  const [announce, setAnnounce] = useState("");
  const [state, setState] = useState<{ error: string | null; message: string | null }>({ error: null, message: null });
  const [pending, start] = useTransition();
  const handles = useRef(new Map<NavKey, HTMLButtonElement | null>());

  function move(key: NavKey, to: number, focus = true) {
    setOrder((current) => {
      const from = current.indexOf(key);
      const target = Math.max(0, Math.min(current.length - 1, to));
      if (from === target) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(target, 0, key);
      setAnnounce(`${NAV_KEY_LABELS[key]} moved to position ${target + 1} of ${next.length}.`);
      return next;
    });
    setState({ error: null, message: null });
    if (focus) requestAnimationFrame(() => handles.current.get(key)?.focus());
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>, key: NavKey) {
    const index = order.indexOf(key);
    const to = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: order.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(key, to);
  }

  function onDragOver(event: DragEvent<HTMLLIElement>, key: NavKey) {
    if (!dragging || dragging === key) return;
    event.preventDefault();
    move(dragging, order.indexOf(key), false);
  }

  function save(next: NavKey[] | null) {
    start(async () => {
      const result = await saveNavOrderAction(next);
      setState({ error: result.error, message: result.message });
      if (result.order) {
        const applied = effectiveNavOrder(result.order);
        setSaved(applied);
        setOrder(applied);
      }
    });
  }

  const dirty = !same(order, saved);
  const isDefault = same(order, DEFAULT_NAV_ORDER);

  return <div className="nav-order">
    <p className="nav-order-live" aria-live="polite">{announce}</p>
    {canEdit && <p className="settings-muted nav-order-hint" id="nav-order-help">Drag by the handle, or focus a handle and press <kbd>↑</kbd> <kbd>↓</kbd>. Everyone in the workspace sees this order; items a person&rsquo;s role can&rsquo;t open stay hidden for them.</p>}
    <ol className="nav-order-list" aria-label="Sidebar order">
      {order.map((key, index) => <li key={key} className={dragging === key ? "is-dragging" : undefined}
        draggable={canEdit && !pending} onDragStart={(event) => { setDragging(key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", key); }}
        onDragOver={(event) => onDragOver(event, key)} onDrop={(event) => event.preventDefault()} onDragEnd={() => setDragging(null)}>
        <span className="nav-order-pos" aria-hidden>{index + 1}</span>
        {canEdit
          ? <button type="button" className="nav-order-handle" ref={(node) => { handles.current.set(key, node); }}
            aria-label={`${NAV_KEY_LABELS[key]}, position ${index + 1} of ${order.length}. Use arrow keys to move.`}
            aria-describedby="nav-order-help" onKeyDown={(event) => onKey(event, key)} disabled={pending}><GripVertical aria-hidden /></button>
          : null}
        <strong>{NAV_KEY_LABELS[key]}</strong>
        {key === "projects" && <small className="nav-order-first">Opens after sign-in</small>}
        {canEdit && <span className="nav-order-moves">
          <button type="button" onClick={() => move(key, index - 1)} disabled={pending || index === 0} aria-label={`Move ${NAV_KEY_LABELS[key]} up`}><ArrowUp aria-hidden /></button>
          <button type="button" onClick={() => move(key, index + 1)} disabled={pending || index === order.length - 1} aria-label={`Move ${NAV_KEY_LABELS[key]} down`}><ArrowDown aria-hidden /></button>
        </span>}
      </li>)}
    </ol>
    {canEdit
      ? <div className="nav-order-actions">
        <button type="button" className="settings-button" disabled={pending || !dirty} onClick={() => save(order)}>{pending ? "Saving…" : "Save order"}</button>
        <button type="button" className="nav-order-reset" disabled={pending || (isDefault && same(saved, DEFAULT_NAV_ORDER))} onClick={() => save(null)}><RotateCcw aria-hidden /> Reset to default</button>
        {state.message && <span className="settings-success" role="status">{state.message}</span>}
        {state.error && <span className="form-error" role="alert">{state.error}</span>}
      </div>
      : <p className="settings-muted">Only the workspace owner can change this order.</p>}
  </div>;
}
