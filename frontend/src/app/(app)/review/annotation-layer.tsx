"use client";

/**
 * The drawing surface over the review frame: renders every drawing in real pixels (so text
 * keeps its proportions and strokes stay crisp on any DPR), draws new shapes with a live
 * preview, and lets the reviewer select, move, resize, retype and delete them.
 *
 * Coordinates in and out are normalised 0–1 (what the API stores); only rendering and
 * pointer maths happen in pixels. A drag never re-renders per pointer event: moves land in
 * a ref and are painted once per animation frame.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AnnotationElement } from "@/lib/api";
import { GripVertical } from "@/components/icons";
import { bounds, handleAt, handles, hitIndex, resize, shapeFrom, textOf, textSize, translate, type Handle, type Pt } from "@/lib/annotation-geometry";

export type LayerTool = "SELECT" | AnnotationElement["element_type"];
export type LayerAnnotation = {
  id: string; elements: AnnotationElement[]; opacity: number; noteId?: string | null;
  /** The viewer may move or edit it (it is theirs and already saved). */
  editable?: boolean;
};
type Selection = { scope: "draft" | string; index: number } | null;
type Drag =
  | { kind: "draw"; tool: LayerAnnotation["elements"][number]["element_type"]; from: Pt; to: Pt; path: Pt[] }
  | { kind: "move"; sel: NonNullable<Selection>; origin: AnnotationElement; from: Pt; to: Pt; moved: boolean }
  | { kind: "resize"; sel: NonNullable<Selection>; origin: AnnotationElement; handle: Handle; to: Pt };
type TextEdit = { scope: "draft" | string; index: number | null; at: Pt; value: string; color: string; size: number; moved?: boolean };

type Props = {
  annotations: LayerAnnotation[];
  draft: AnnotationElement[];
  draftOpacity: number;
  tool: LayerTool | null;
  color: string;
  canDraw: boolean;
  onDraft: (elements: AnnotationElement[]) => void;
  onEditSaved?: (annotationId: string, elements: AnnotationElement[]) => void;
  onDeleteSaved?: (annotationId: string) => void;
  onActivate?: (annotation: LayerAnnotation) => void;
  /** Lets the toolbar show undo/redo state and the colour of the selection. */
  onState?: (state: { canUndo: boolean; canRedo: boolean; selectedColor: string | null }) => void;
  /** Imperative undo/redo for the toolbar buttons. */
  commands?: React.MutableRefObject<{ undo: () => void; redo: () => void; recolor: (color: string) => void } | null>;
};

export function AnnotationLayer({ annotations, draft, draftOpacity, tool, color, canDraw, onDraft, onEditSaved, onDeleteSaved, onActivate, onState, commands }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selection, setSelection] = useState<Selection>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [text, setText] = useState<TextEdit | null>(null);
  const [hover, setHover] = useState<Selection>(null);
  /** Saved drawings edited here show their new shape until the refreshed data arrives. */
  const [rawOverrides, setOverrides] = useState<Record<string, AnnotationElement[]>>({});
  const dragRef = useRef<Drag | null>(null);
  /** Dragging the text box itself while it is being typed into (its grip or its border). */
  const textDrag = useRef<{ from: Pt; at: Pt; id: number } | null>(null);
  const frame = useRef(0);
  const past = useRef<AnnotationElement[][]>([]);
  const future = useRef<AnnotationElement[][]>([]);
  const [, bump] = useState(0);
  /** The last drawing this layer handed up, to tell its own changes from the parent's. */
  const emitted = useRef<AnnotationElement[] | null>(null);
  const [prevTool, setPrevTool] = useState(tool);
  // Switching tools drops the selection; a drawing tool can't hold one.
  if (tool !== prevTool) { setPrevTool(tool); if (tool !== "SELECT" && tool !== "TEXT") setSelection(null); }

  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // An override is dropped once the server's copy matches it (or the drawing is gone).
  const overrides = useMemo(() => {
    const live: Record<string, AnnotationElement[]> = {};
    for (const [id, els] of Object.entries(rawOverrides)) {
      const saved = annotations.find((a) => a.id === id);
      if (saved && JSON.stringify(saved.elements.map(strip)) !== JSON.stringify(els.map(strip))) live[id] = els;
    }
    return live;
  }, [annotations, rawOverrides]);

  const aspect = size.w && size.h ? size.w / size.h : 16 / 9;
  const elementsOf = useCallback((scope: string) => scope === "draft" ? draft : overrides[scope] ?? annotations.find((a) => a.id === scope)?.elements ?? [], [annotations, draft, overrides]);
  const selected = selection ? elementsOf(selection.scope)[selection.index] ?? null : null;

  const commitDraft = useCallback((next: AnnotationElement[]) => {
    past.current.push(draft); future.current = []; emitted.current = next; onDraft(next); bump((n) => n + 1);
  }, [draft, onDraft]);
  const commitSaved = useCallback((id: string, next: AnnotationElement[]) => {
    setOverrides((o) => ({ ...o, [id]: next }));
    onEditSaved?.(id, next);
  }, [onEditSaved]);
  const replace = useCallback((sel: NonNullable<Selection>, element: AnnotationElement | null) => {
    const list = elementsOf(sel.scope);
    const next = element ? list.map((e, i) => (i === sel.index ? element : e)) : list.filter((_, i) => i !== sel.index);
    if (sel.scope === "draft") commitDraft(next);
    else if (next.length) commitSaved(sel.scope, next);
    else onDeleteSaved?.(sel.scope);
  }, [commitDraft, commitSaved, elementsOf, onDeleteSaved]);

  const undo = useCallback(() => {
    const prev = past.current.pop(); if (!prev) return;
    future.current.push(draft); setSelection(null); emitted.current = prev; onDraft(prev); bump((n) => n + 1);
  }, [draft, onDraft]);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    past.current.push(draft); setSelection(null); emitted.current = next; onDraft(next); bump((n) => n + 1);
  }, [draft, onDraft]);
  const recolor = useCallback((value: string) => {
    if (selection && selected) replace(selection, { ...selected, style: { ...selected.style, color: value } });
    if (text) setText({ ...text, color: value });
  }, [replace, selected, selection, text]);
  useImperativeHandle(commands, () => ({ undo, redo, recolor }), [recolor, redo, undo]);
  // A posted or cleared draft starts a fresh history.
  // (Our own undo back to an empty drawing keeps its redo stack.)
  useEffect(() => { if (!draft.length && draft !== emitted.current) { past.current = []; future.current = []; } }, [draft]);
  useEffect(() => {
    onState?.({ canUndo: past.current.length > 0, canRedo: future.current.length > 0, selectedColor: selected ? String(selected.style.color ?? "#ffcf5a") : null });
  });

  // Keyboard: undo/redo while drafting, delete/escape on a selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (text) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z" && (draft.length || past.current.length || future.current.length) && !typing(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y" && future.current.length && !typing(event)) { event.preventDefault(); redo(); return; }
      if (!selection) return;
      if (event.key === "Escape") { event.stopImmediatePropagation(); setSelection(null); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && !typing(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
        replace(selection, null); setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft.length, redo, replace, selection, text, undo]);

  const toNorm = (event: { clientX: number; clientY: number }): Pt => {
    const r = host.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - r.left) / (r.width || 1)), y: clamp((event.clientY - r.top) / (r.height || 1)) };
  };
  const schedule = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; setDrag(dragRef.current ? { ...dragRef.current } : null); });
  };

  /** What sits under the pointer: draft shapes first (they're on top), then editable saved ones. */
  const pick = (p: Pt): NonNullable<Selection> | null => {
    const tol = 14 / (size.h || 400);
    const d = hitIndex(draft, p, aspect, tol);
    if (d >= 0) return { scope: "draft", index: d };
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i];
      if (!a.editable || a.opacity <= 0) continue;
      const index = hitIndex(elementsOf(a.id), p, aspect, tol);
      if (index >= 0) return { scope: a.id, index };
    }
    return null;
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!tool || !canDraw || event.button > 0) return;
    if (text) { finishText(); return; }
    const p = toNorm(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (tool === "SELECT") {
      if (selected && selection) {
        const handle = handleAt(selected, p, aspect, 16 / (size.h || 400));
        if (handle) { dragRef.current = { kind: "resize", sel: selection, origin: selected, handle, to: p }; setDrag(dragRef.current); return; }
      }
      const hit = pick(p);
      setSelection(hit);
      if (hit) { dragRef.current = { kind: "move", sel: hit, origin: elementsOf(hit.scope)[hit.index], from: p, to: p, moved: false }; setDrag(dragRef.current); }
      return;
    }
    if (tool === "TEXT") {
      // Pressing on existing text with the text tool selects it and drags it; a
      // double-click edits it. Only empty frame places a new box.
      const hit = pick(p);
      const hitEl = hit ? elementsOf(hit.scope)[hit.index] : null;
      if (hit && hitEl?.element_type === "TEXT") {
        setSelection(hit);
        dragRef.current = { kind: "move", sel: hit, origin: hitEl, from: p, to: p, moved: false }; setDrag(dragRef.current);
        return;
      }
      setSelection(null);
      setText({ scope: "draft", index: null, at: p, value: "", color, size: 0.045 });
      return;
    }
    dragRef.current = { kind: "draw", tool, from: p, to: p, path: [p] };
    setDrag(dragRef.current);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) {
      if (tool === "SELECT" && event.pointerType === "mouse") { const h = pick(toNorm(event)); if (h?.scope !== hover?.scope || h?.index !== hover?.index) setHover(h); }
      return;
    }
    // Coalesced events keep freehand smooth when the browser batches pointer moves.
    const native = event.nativeEvent as PointerEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    const p = toNorm(event);
    if (d.kind === "draw") { if (d.tool === "PATH") for (const e of events.length ? events : [native]) d.path.push(toNorm(e)); d.to = p; }
    else if (d.kind === "move") { d.to = p; if (Math.hypot(p.x - d.from.x, p.y - d.from.y) > 0.002) d.moved = true; }
    else d.to = p;
    schedule();
  };
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current; dragRef.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    setDrag(null);
    if (!d) return;
    const p = toNorm(event);
    if (d.kind === "draw") {
      const geometry = shapeFrom(d.tool, d.from, p, [...d.path, p]);
      if (!geometry) return;
      const style: Record<string, unknown> = { color, stroke_width: 2 };
      commitDraft([...draft, { element_type: d.tool, geometry, style, payload: {} }]);
      return;
    }
    if (d.kind === "move") { if (d.moved) replace(d.sel, translate(d.origin, p.x - d.from.x, p.y - d.from.y, aspect)); return; }
    replace(d.sel, resize(d.origin, d.handle, p, aspect));
  };
  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const hit = pick(toNorm(event));
    if (hit && elementsOf(hit.scope)[hit.index]?.element_type === "TEXT") editText(hit);
  };

  const editText = (sel: NonNullable<Selection>) => {
    const el = elementsOf(sel.scope)[sel.index];
    setSelection(sel);
    setText({ scope: sel.scope, index: sel.index, at: { x: Number(el.geometry.x), y: Number(el.geometry.y) }, value: textOf(el), color: String(el.style.color ?? color), size: textSize(el) });
  };
  const finishText = (cancel = false) => {
    const t = text; setText(null);
    if (!t || cancel) return;
    const value = t.value.trim();
    if (t.index === null) {
      if (!value) return;
      const created: AnnotationElement = { element_type: "TEXT", geometry: { x: t.at.x, y: clamp(t.at.y + t.size * 0.4) }, style: { color: t.color, font_size: t.size }, payload: { text: value.slice(0, 280) } };
      commitDraft([...draft, created]);
      // Committed text stays selected, so the next press on it drags it.
      setSelection({ scope: "draft", index: draft.length });
      return;
    }
    const el = elementsOf(t.scope)[t.index]; if (!el) return;
    const geometry = t.moved ? { ...el.geometry, x: t.at.x, y: t.at.y } : el.geometry;
    replace({ scope: t.scope, index: t.index }, value ? { ...el, geometry, style: { ...el.style, color: t.color }, payload: { ...el.payload, text: value.slice(0, 280) } } : null);
    setSelection({ scope: t.scope, index: t.index });
  };

  // What to paint: committed shapes, with the dragged one swapped for its live position.
  const live = (scope: string, list: AnnotationElement[]) => list.map((el, i) => {
    if (!drag || drag.kind === "draw" || drag.sel.scope !== scope || drag.sel.index !== i) return el;
    return drag.kind === "move" ? translate(drag.origin, drag.to.x - drag.from.x, drag.to.y - drag.from.y, aspect) : resize(drag.origin, drag.handle, drag.to, aspect);
  });
  const preview = drag?.kind === "draw" ? previewOf(drag, color) : null;
  const selectedLive = selection ? live(selection.scope, elementsOf(selection.scope))[selection.index] : null;
  const S = { w: size.w || 1, h: size.h || 1 };
  const armed = Boolean(tool && canDraw);
  const showSelection = tool === "SELECT" || (tool === "TEXT" && selectedLive?.element_type === "TEXT");

  // Moving the box while typing: the grip (or the dashed border) drags it, the text stays.
  const onTextGripDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!text || event.button > 0 || (event.target as Element).closest("textarea")) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    textDrag.current = { from: toNorm(event), at: text.at, id: event.pointerId };
  };
  const onTextGripMove = (event: React.PointerEvent<HTMLElement>) => {
    const d = textDrag.current; if (!d || !text || d.id !== event.pointerId) return;
    const p = toNorm(event);
    setText({ ...text, moved: true, at: { x: clamp(d.at.x + p.x - d.from.x), y: clamp(d.at.y + p.y - d.from.y) } });
  };
  const onTextGripUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!textDrag.current) return;
    textDrag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // Typing carries on after a move.
    event.currentTarget.querySelector("textarea")?.focus();
  };

  return (
    <div ref={host} className={`rvp-layer ${armed ? "is-armed" : ""} ${tool === "SELECT" ? "is-select" : ""}`} data-tool={tool ?? undefined}>
      <svg
        className="rvp-layer-svg"
        width={S.w} height={S.h} viewBox={`0 0 ${S.w} ${S.h}`}
        role={armed ? "application" : undefined}
        aria-label={armed ? (tool === "SELECT" ? "Select and move drawings" : `Draw ${tool!.toLowerCase()} on the frame`) : undefined}
        aria-hidden={armed ? undefined : true}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        {annotations.map((a) => (
          <g key={a.id} className={`rvp-drawing ${a.opacity > 0 ? "is-shown" : ""}`} style={{ opacity: selection?.scope === a.id ? 1 : a.opacity }} data-annotation={a.id} data-note={a.noteId ?? undefined}>
            {live(a.id, elementsOf(a.id)).map((el, i) => (
              <ShapePx key={i} element={el} S={S} hidden={text?.scope === a.id && text.index === i}
                hover={hover?.scope === a.id && hover.index === i}
                onClick={armed ? undefined : () => onActivate?.(a)} />
            ))}
          </g>
        ))}
        <g className="rvp-pending" data-shown={draftOpacity > 0 ? "true" : "false"} style={{ opacity: selection?.scope === "draft" || drag ? 1 : draftOpacity }}>
          {live("draft", draft).map((el, i) => (
            <ShapePx key={i} element={el} S={S} hidden={text?.scope === "draft" && text.index === i} hover={hover?.scope === "draft" && hover.index === i} />
          ))}
          {preview && <ShapePx element={preview} S={S} preview />}
        </g>
        {selectedLive && showSelection && <SelectionBox element={selectedLive} S={S} aspect={aspect} />}
      </svg>
      {text && (
        <div
          className="rvp-text-edit"
          style={{ left: text.at.x * S.w, top: text.at.y * S.h - text.size * S.h * (text.index === null ? 0.6 : 0.82), maxWidth: Math.max(80, (1 - text.at.x) * S.w - 8) }}
          onPointerDown={onTextGripDown} onPointerMove={onTextGripMove} onPointerUp={onTextGripUp} onPointerCancel={onTextGripUp}
        >
          <span className="rvp-text-grip" role="presentation" title="Drag to move the text" aria-hidden="true"><GripVertical /></span>
          <textarea
            className="rvp-text-input"
            autoFocus
            rows={1}
            aria-label="Annotation text"
            placeholder="Type, then Enter"
            value={text.value}
            maxLength={280}
            style={{ color: text.color, fontSize: text.size * S.h }}
            onChange={(e) => setText({ ...text, value: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Enter and Esc both commit what was typed and leave edit mode.
              if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); finishText(); }
            }}
            onBlur={() => { if (!textDrag.current) finishText(); }}
          />
        </div>
      )}
    </div>
  );
}

function previewOf(d: Extract<Drag, { kind: "draw" }>, color: string): AnnotationElement | null {
  const geometry = d.tool === "PATH" ? (d.path.length > 1 ? { points: d.path } : null) : shapeFrom(d.tool, d.from, d.to);
  return geometry ? { element_type: d.tool, geometry, style: { color, stroke_width: 2 }, payload: {} } : null;
}

/** Keys typed into a field (the comment box, this layer's text input) are never shortcuts here. */
const typing = (event: KeyboardEvent) => event.target instanceof Element && Boolean(event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const strip = ({ element_type, geometry, style, payload }: AnnotationElement) => ({ element_type, geometry, style, payload });

function arrowHead(x1: number, y1: number, x2: number, y2: number, w: number) {
  const a = Math.atan2(y2 - y1, x2 - x1), len = 9 + w * 2.2, spread = 0.45;
  return `${x2},${y2} ${x2 - len * Math.cos(a - spread)},${y2 - len * Math.sin(a - spread)} ${x2 - len * Math.cos(a + spread)},${y2 - len * Math.sin(a + spread)}`;
}

export function ShapePx({ element, S, hidden, hover, preview, onClick }: { element: AnnotationElement; S: { w: number; h: number }; hidden?: boolean; hover?: boolean; preview?: boolean; onClick?: () => void }) {
  const g = element.geometry;
  const color = String(element.style.color ?? "#ffcf5a");
  const w = Math.max(1.5, Number(element.style.stroke_width ?? 2) * 1.25);
  const X = (v: unknown) => Number(v) * S.w, Y = (v: unknown) => Number(v) * S.h;
  const common = { fill: "none", stroke: color, strokeWidth: w, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let shape: React.ReactNode = null;
  switch (element.element_type) {
    case "POINT": shape = <circle cx={X(g.x)} cy={Y(g.y)} r={6} {...common} fill="#121216" />; break;
    case "RECTANGLE": shape = <rect x={X(g.x)} y={Y(g.y)} width={X(g.width)} height={Y(g.height)} rx={2} {...common} />; break;
    case "ELLIPSE": shape = <ellipse cx={X(Number(g.x) + Number(g.width) / 2)} cy={Y(Number(g.y) + Number(g.height) / 2)} rx={X(g.width) / 2} ry={Y(g.height) / 2} {...common} />; break;
    case "ARROW": {
      const s = g.start as Pt, e = g.end as Pt;
      shape = <><line x1={X(s.x)} y1={Y(s.y)} x2={X(e.x)} y2={Y(e.y)} {...common} /><polygon points={arrowHead(X(s.x), Y(s.y), X(e.x), Y(e.y), w)} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" /></>;
      break;
    }
    case "PATH": shape = <polyline points={((g.points as Pt[]) ?? []).map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} {...common} />; break;
    case "TEXT": shape = <text x={X(g.x)} y={Y(g.y)} fill={color} fontSize={textSize(element) * S.h} fontWeight={600} className="rvp-text" paintOrder="stroke" stroke="#0b0d12cc" strokeWidth={Math.max(2, textSize(element) * S.h * 0.12)}>{textOf(element)}</text>; break;
  }
  return (
    <g className={`rvp-shape ${hover ? "is-hover" : ""} ${preview ? "is-preview" : ""}`} data-kind={element.element_type} style={hidden ? { visibility: "hidden" } : undefined} onClick={onClick}>
      {shape}
    </g>
  );
}

function SelectionBox({ element, S, aspect }: { element: AnnotationElement; S: { w: number; h: number }; aspect: number }) {
  const b = bounds(element, aspect), pad = 4;
  const arrow = element.element_type === "ARROW";
  return (
    <g className="rvp-selection" pointerEvents="none">
      {!arrow && <rect x={b.x * S.w - pad} y={b.y * S.h - pad} width={b.width * S.w + pad * 2} height={b.height * S.h + pad * 2} />}
      {handles(element, aspect).map((h) => (
        <rect key={h.handle} className="rvp-grip" data-handle={h.handle} x={h.at.x * S.w - 5 + (arrow ? 0 : h.handle.includes("w") ? -pad : pad)} y={h.at.y * S.h - 5 + (arrow ? 0 : h.handle.includes("n") ? -pad : pad)} width={10} height={10} rx={2} />
      ))}
    </g>
  );
}
