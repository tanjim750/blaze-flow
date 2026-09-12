"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import {
  ChevronFirst, ChevronLast, Circle, Crosshair, Film, Gauge, Maximize2, MonitorPlay,
  MoveUpRight, Pause, PencilLine, Play, Square, Trash2, Type, Volume2, VolumeX,
} from "lucide-react";
import type { AnnotationElement } from "@/lib/api";
import type { ReviewNote } from "@/lib/review-notes";
import { timecode } from "@/lib/timecode";

export type DrawTool = "POINT" | "RECTANGLE" | "ELLIPSE" | "ARROW" | "PATH" | "TEXT";
export type PlayerHandle = { seek: (ms: number) => void; position: () => number };
export type PlayerSource = { id: string; label: string; src: string };
export type DrawnAnnotation = { id: string; elements: AnnotationElement[]; startMs: number | null };

const TOOLS: { tool: DrawTool; icon: typeof Crosshair; label: string }[] = [
  { tool: "POINT", icon: Crosshair, label: "Point" },
  { tool: "RECTANGLE", icon: Square, label: "Rectangle" },
  { tool: "ELLIPSE", icon: Circle, label: "Ellipse" },
  { tool: "ARROW", icon: MoveUpRight, label: "Arrow" },
  { tool: "PATH", icon: PencilLine, label: "Freehand" },
  { tool: "TEXT", icon: Type, label: "Text" },
];

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const DEFAULT_FPS = 25;

type Props = {
  handle: RefObject<PlayerHandle | null>;
  sources: PlayerSource[];
  title: string;
  notes: ReviewNote[];
  annotations: DrawnAnnotation[];
  /** Held in the composer until the note is posted, so a drawing arrives with its comment. */
  pending: AnnotationElement | null;
  canDraw: boolean;
  onTime: (ms: number) => void;
  onMeta: (meta: { durationMs: number; width: number; height: number }) => void;
  onDraw: (element: AnnotationElement) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onFocusNote: (noteId: string) => void;
};

export function Player({ handle, sources, title, notes, annotations, pending, canDraw, onTime, onMeta, onDraw, onDeleteAnnotation, onFocusNote }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const fps = useRef(DEFAULT_FPS);

  const source = sources.find((item) => item.id === sourceId) ?? sources[0] ?? null;

  const seek = useCallback((ms: number) => {
    const element = video.current;
    const clamped = Math.max(0, durationMs ? Math.min(ms, durationMs) : ms);
    if (element) element.currentTime = clamped / 1000;
    setPositionMs(clamped);
    onTime(clamped);
  }, [durationMs, onTime]);

  useImperativeHandle(handle, () => ({ seek, position: () => positionMs }), [seek, positionMs]);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  }, []);

  /**
   * Reads the loaded video's own state, rather than waiting to be told about it.
   *
   * React's `onLoadedMetadata` and `onError` are not enough on their own. The markup is
   * server-rendered, so the browser starts fetching the video as soon as the HTML lands
   * and routinely settles it before hydration attaches any handler — the event is simply
   * missed. Two things then go wrong and both were seen in testing: the duration stays
   * zero, which collapses every comment marker onto 0%, and a proxy that 404s leaves a
   * blank stage instead of the "still being generated" message. Reading `readyState` and
   * `error` on mount covers the race; the listeners cover everything after it.
   */
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    setFailed(false);
    setShape(null);
    const sync = () => {
      if (!Number.isFinite(element.duration) || !element.duration) return;
      setDurationMs(element.duration * 1000);
      if (element.videoWidth && element.videoHeight) setShape({ width: element.videoWidth, height: element.videoHeight });
      onMeta({ durationMs: element.duration * 1000, width: element.videoWidth, height: element.videoHeight });
    };
    const fail = () => setFailed(true);
    if (element.error) fail();
    else if (element.readyState >= 1) sync();
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("error", fail);
    return () => {
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("error", fail);
    };
  }, [onMeta, source?.src]);

  /**
   * Measures the real frame duration rather than assuming one.
   *
   * `requestVideoFrameCallback` reports the media time of each presented frame, so two
   * consecutive callbacks give the actual cadence. Without this, frame stepping would be
   * a guess, and a guess is worse than useless on a 23.976 or 50 fps cut.
   */
  useEffect(() => {
    const element = video.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number }) | null;
    if (!element?.requestVideoFrameCallback) return;
    let cancelled = false;
    let previous: number | null = null;
    const sample = (_now: number, meta: { mediaTime: number }) => {
      if (cancelled) return;
      if (previous !== null) {
        const delta = meta.mediaTime - previous;
        if (delta > 0.002 && delta < 0.2) fps.current = Math.round(1 / delta);
      }
      previous = meta.mediaTime;
      element.requestVideoFrameCallback!(sample);
    };
    element.requestVideoFrameCallback(sample);
    return () => { cancelled = true; };
  }, [source?.src]);

  const step = useCallback((frames: number) => {
    const element = video.current;
    if (!element) return;
    element.pause();
    seek((element.currentTime + frames / fps.current) * 1000);
  }, [seek]);

  useEffect(() => {
    const element = video.current;
    if (element) { element.volume = volume; element.muted = muted; element.playbackRate = speed; }
  }, [muted, speed, volume]);

  // Transport shortcuts, skipped whenever the viewer is typing a note.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = event.target;
      if ((node instanceof Element && node.matches("input, textarea, select, [contenteditable=true]")) || event.metaKey || event.ctrlKey) return;
      const keys: Record<string, () => void> = {
        " ": toggle, k: toggle,
        j: () => step(-fps.current), l: () => step(fps.current),
        ArrowLeft: () => step(-1), ArrowRight: () => step(1),
        m: () => setMuted((value) => !value),
        f: () => void stage.current?.requestFullscreen().catch(() => undefined),
      };
      const action = keys[event.key] ?? keys[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggle]);

  const scrub = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!durationMs) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
  };

  const markers = notes.filter((note) => note.startMs !== null);
  const progress = durationMs ? (positionMs / durationMs) * 100 : 0;
  // Only annotations pinned near the playhead, so the frame shows its own notes.
  const visible = annotations.filter((item) => item.startMs === null || Math.abs(item.startMs - positionMs) < 2000);

  return (
    <section className="rvp">
      <div className={`rvp-stage ${tool ? "is-drawing" : ""}`} ref={stage}>
        {/*
          * The frame carries the media's own aspect ratio, and the picture and both
          * annotation layers all fill it exactly.
          *
          * The video used to sit straight in the stage at `width/height: 100%`. The height
          * percentage never resolved — the stage's grid row is not a definite height from
          * the item's side — so the video fell back to its intrinsic ratio at full width,
          * `object-fit: contain` had nothing left to do, and anything taller than the stage
          * was simply cropped by its `overflow: hidden`. A portrait clip lost its top and
          * bottom entirely.
          *
          * Sizing the frame instead fixes a second thing: annotation coordinates are
          * normalised 0–1 against the layer they are drawn on. While that layer covered the
          * whole stage, a drawing on letterboxed media landed away from the picture it was
          * made against.
          */}
        <div className={shape ? "rvp-frame" : "rvp-frame is-unsized"} style={shape ? { aspectRatio: `${shape.width} / ${shape.height}` } : undefined}>
        {source && !failed ? (
          <video
            ref={video}
            src={source.src}
            playsInline
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => { const ms = event.currentTarget.currentTime * 1000; setPositionMs(ms); onTime(ms); }}
          />
        ) : (
          <div className="rvp-empty">
            <Film size={28} />
            <p>{failed ? "The review proxy for this cut is still being generated. Refresh in a moment." : "This cut has no preview available yet."}</p>
          </div>
        )}

        <svg className="rvp-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden={visible.length === 0}>
          <defs>
            <marker id="rvp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffcf5a" />
            </marker>
          </defs>
          {visible.flatMap((annotation) => annotation.elements.map((element, index) => (
            <Shape
              key={`${annotation.id}-${index}`}
              element={element}
              onActivate={() => annotation.startMs !== null && seek(annotation.startMs)}
            />
          )))}
          {pending && <Shape element={pending} onActivate={() => undefined} />}
        </svg>

        {tool && canDraw && (
          <div
            className="rvp-draw"
            role="application"
            aria-label={`Draw ${tool.toLowerCase()} on the frame`}
            onPointerDown={(event) => { const point = at(event); setDrawStart(point); setPath([point]); }}
            onPointerMove={(event) => { if (drawStart && tool === "PATH" && event.buttons) setPath((points) => [...points, at(event)]); }}
            onPointerUp={(event) => {
              if (!drawStart) return;
              const end = at(event);
              const geometry = geometryFor(tool, drawStart, end, path);
              setDrawStart(null);
              setPath([]);
              if (!geometry) return;
              const text = tool === "TEXT" ? window.prompt("Annotation text")?.trim() : "";
              if (tool === "TEXT" && !text) return;
              onDraw({ element_type: tool, geometry, style: { color: "#ffcf5a", stroke_width: 2 }, payload: text ? { text } : {} });
              setTool(null);
            }}
          />
        )}

        <div className="rvp-badge">{title}</div>
        </div>
      </div>

      <div className="rvp-timeline">
        <div className="rvp-scrub" onClick={scrub} role="presentation">
          <span className="rvp-played" style={{ width: `${progress}%` }} />
          <span className="rvp-head" style={{ left: `${progress}%` }} />
          {markers.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`rvp-marker ${note.resolved ? "is-resolved" : ""}`}
              style={{ left: durationMs ? `${(note.startMs! / durationMs) * 100}%` : "0%" }}
              title={`${note.timecode} — ${note.author}`}
              aria-label={`Jump to ${note.timecode} by ${note.author}`}
              onClick={(event) => { event.stopPropagation(); seek(note.startMs!); onFocusNote(note.id); }}
            >
              <i>{note.initials}</i>
            </button>
          ))}
        </div>
      </div>

      <div className="rvp-transport">
        <div className="rvp-group">
          <button type="button" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame (←)"><ChevronFirst /></button>
          <button type="button" className="rvp-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title="Play / pause (space)" disabled={!source || failed}>
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next frame" title="Next frame (→)"><ChevronLast /></button>
        </div>

        <div className="rvp-clock">
          <strong>{timecode(positionMs)}</strong>
          <span>/ {timecode(durationMs)}</span>
        </div>

        <div className="rvp-group rvp-volume">
          <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} title="Mute (m)">
            {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(event) => { setVolume(Number(event.target.value)); setMuted(Number(event.target.value) === 0); }}
          />
        </div>

        <label className="rvp-select" title="Playback speed">
          <Gauge />
          <select value={speed} aria-label="Playback speed" onChange={(event) => setSpeed(Number(event.target.value))}>
            {SPEEDS.map((option) => <option key={option} value={option}>{option}x</option>)}
          </select>
        </label>

        {sources.length > 1 && (
          <label className="rvp-select" title="Playback source">
            <MonitorPlay />
            <select value={sourceId} aria-label="Playback quality" onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        )}

        {canDraw && (
          <div className="rvp-tools" role="group" aria-label="Annotation tools">
            {TOOLS.map(({ tool: value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                className={tool === value ? "is-active" : ""}
                aria-pressed={tool === value}
                aria-label={`Draw ${label.toLowerCase()}`}
                title={`${label} annotation`}
                onClick={() => setTool(tool === value ? null : value)}
              >
                <Icon />
              </button>
            ))}
          </div>
        )}

        <button type="button" className="rvp-fullscreen" onClick={() => void stage.current?.requestFullscreen().catch(() => undefined)} aria-label="Fullscreen" title="Fullscreen (f)">
          <Maximize2 />
        </button>
      </div>

      {visible.length > 0 && (
        <ul className="rvp-annotation-list">
          {visible.map((annotation, index) => (
            <li key={annotation.id}>
              <button type="button" onClick={() => annotation.startMs !== null && seek(annotation.startMs)}>
                #{index + 1} {annotation.elements[0]?.element_type.toLowerCase()}
                {annotation.startMs !== null && <span> · {timecode(annotation.startMs)}</span>}
              </button>
              <button type="button" onClick={() => onDeleteAnnotation(annotation.id)} aria-label="Delete annotation"><Trash2 /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function at(event: React.PointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function geometryFor(tool: DrawTool, start: { x: number; y: number }, end: { x: number; y: number }, path: { x: number; y: number }[]): Record<string, unknown> | null {
  if (tool === "POINT" || tool === "TEXT") return end;
  if (tool === "ARROW") return { start, end };
  if (tool === "PATH") return path.length > 1 ? { points: [...path, end].slice(0, 500) } : null;
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
  return width > 0.005 && height > 0.005 ? { x, y, width, height } : null;
}

/** Renders one annotation element in the 0–100 overlay space. Never touches the video. */
function Shape({ element, onActivate }: { element: AnnotationElement; onActivate: () => void }) {
  const g = element.geometry;
  const color = String(element.style.color ?? "#ffcf5a");
  const common = { fill: "none", stroke: color, strokeWidth: Number(element.style.stroke_width ?? 2), vectorEffect: "non-scaling-stroke" as const };
  let shape: React.ReactNode = null;
  if (element.element_type === "POINT") shape = <circle cx={Number(g.x) * 100} cy={Number(g.y) * 100} r="1.5" {...common} fill="#121216" />;
  if (element.element_type === "RECTANGLE") shape = <rect x={Number(g.x) * 100} y={Number(g.y) * 100} width={Number(g.width) * 100} height={Number(g.height) * 100} {...common} />;
  if (element.element_type === "ELLIPSE") shape = <ellipse cx={(Number(g.x) + Number(g.width) / 2) * 100} cy={(Number(g.y) + Number(g.height) / 2) * 100} rx={Number(g.width) * 50} ry={Number(g.height) * 50} {...common} />;
  if (element.element_type === "ARROW") {
    const start = g.start as Record<string, number>, end = g.end as Record<string, number>;
    shape = <line x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} markerEnd="url(#rvp-arrow)" {...common} />;
  }
  if (element.element_type === "PATH") shape = <polyline points={(g.points as { x: number; y: number }[]).map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} {...common} />;
  if (element.element_type === "TEXT") shape = <text x={Number(g.x) * 100} y={Number(g.y) * 100} fill={color} stroke="none" fontSize="4">{String(element.payload.text ?? "")}</text>;
  return <g className="rvp-shape" onClick={onActivate}>{shape}</g>;
}
