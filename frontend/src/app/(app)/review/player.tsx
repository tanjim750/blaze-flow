"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import {
  AudioLines, ChevronFirst, ChevronLast, Circle, Crosshair, Download, ExternalLink, FileText, Film, Gauge, ImageOff, Loader2, Maximize2, MonitorPlay,
  MoveUpRight, Pause, PencilLine, Play, RotateCw, Square, Trash2, Type, Volume2, VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import type { AnnotationElement } from "@/lib/api";
import type { ReviewNote } from "@/lib/review-notes";
import { timecode } from "@/lib/timecode";
import type { ReviewSurface } from "@/lib/open-in-review";
import { playerShouldIgnoreKey } from "./player-keys";
import {
  BUFFERING_DELAY_MS, bufferedSpans, canSeekTo, clampSeekMs, describePlaybackError,
  positionFromPointer, sameSpans, seekLanded, type BufferedSpan,
} from "./player-state";

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
  /**
   * How the file is shown. Video (and audio, through the same element) gets the full
   * player; an image gets the frame with drawing tools but no timeline; a PDF opens in the
   * browser's viewer; anything else gets a download card. Comments sit beside all of them.
   */
  surface?: ReviewSurface;
  downloadHref?: string | null;
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

export function Player(props: Props) {
  const surface = props.surface ?? "video";
  if (surface === "pdf" || surface === "download") return <DocumentViewer {...props} surface={surface} />;
  return <MediaPlayer {...props} surface={surface} />;
}

/** `?inline=1` asks the download route to serve an image or PDF for display, not as an attachment. */
export function inlineSrc(src: string): string {
  if (!src.includes("/asset-files/") || !src.includes("/download/")) return src;
  return src.includes("?") ? `${src}&inline=1` : `${src}?inline=1`;
}

/** A PDF in the browser's own viewer, or a download card for a type nothing can preview. */
function DocumentViewer({ sources, title, surface, downloadHref }: Props & { surface: "pdf" | "download" }) {
  const source = sources[0] ?? null;
  return (
    <section className="rvp is-document">
      <div className="rvp-stage is-document">
        {surface === "pdf" && source ? (
          <iframe className="rvp-doc" src={inlineSrc(source.src)} title={`${title} (PDF)`} />
        ) : (
          <div className="rvp-empty">
            <FileText size={28} />
            <strong>{title}</strong>
            <p>This file type can&rsquo;t be previewed here. Download it to open it, and keep the feedback in the comments.</p>
            {downloadHref && <a className="rvp-retry" href={downloadHref} download><Download size={14} /> Download</a>}
          </div>
        )}
      </div>
      <div className="rvp-transport is-document">
        <span className="rvp-doc-label"><FileText size={14} aria-hidden="true" />{surface === "pdf" ? "PDF" : "File"} · comments apply to the whole file</span>
        <span className="rvp-spacer" />
        {surface === "pdf" && source && <a className="rvp-doc-link" href={inlineSrc(source.src)} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open in new tab</a>}
        {downloadHref && <a className="rvp-doc-link" href={downloadHref} download><Download size={14} />Download</a>}
      </div>
    </section>
  );
}

function MediaPlayer({ handle, sources, title, notes, annotations, pending, canDraw, onTime, onMeta, onDraw, onDeleteAnnotation, onFocusNote, surface }: Props & { surface: "video" | "audio" | "image" }) {
  const still = surface === "image";
  const image = useRef<HTMLImageElement>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  /** The `MediaError` code once playback has failed, or null while it is healthy. */
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const failed = errorCode !== null;
  /** Where a seek was sent, shown on the playhead until the element confirms with `seeked`. */
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [buffered, setBuffered] = useState<BufferedSpan[]>([]);
  /** While the scrubber is being dragged, the position under the pointer. */
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);
  // A still reports its size once decoded; like the video, it may decode before hydration.
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; }, [onMeta]);
  const imageLoaded = useCallback(() => {
    const element = image.current;
    if (!element || !element.naturalWidth) return;
    setShape({ width: element.naturalWidth, height: element.naturalHeight });
    onMetaRef.current({ durationMs: 0, width: element.naturalWidth, height: element.naturalHeight });
  }, []);
  useEffect(() => {
    // Reads an image that finished loading before hydration attached onLoad.
    if (still && image.current?.complete) imageLoaded();
  }, [still, imageLoaded]);
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const fps = useRef(DEFAULT_FPS);
  // A seek requested before the metadata arrived, applied as soon as it does.
  const queuedSeek = useRef<number | null>(null);
  // The seek in flight, compared against where the element actually lands.
  const inFlight = useRef<number | null>(null);
  const bufferingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through a ref so a parent passing a fresh callback doesn't re-run the media effect.
  const onTimeRef = useRef(onTime);
  useEffect(() => { onTimeRef.current = onTime; }, [onTime]);

  const source = sources.find((item) => item.id === sourceId) ?? sources[0] ?? null;

  /**
   * Sends the element to `ms` and lets the element say where it ended up.
   *
   * This used to set `positionMs` straight away, so the clock and playhead showed the
   * requested time even when the browser refused the jump — then `timeupdate` snapped them
   * back. Now the requested time is only a provisional target for the playhead; the clock,
   * `onTime` and everything downstream move on `seeked`, from `currentTime` itself.
   */
  const seek = useCallback((ms: number) => {
    const element = video.current;
    const known = element && Number.isFinite(element.duration) && element.duration > 0 ? element.duration * 1000 : durationMs;
    const target = clampSeekMs(ms, known);
    if (!element || element.readyState < 1) {
      queuedSeek.current = target;
      setSeekTarget(target);
      return;
    }
    if (!canSeekTo(element.seekable, target / 1000)) {
      // Without range support the browser can only seek within what it has fetched.
      toast("Seeking unavailable, loading the full cut…", { description: `Couldn't jump to ${timecode(target)} yet. Try again once more of the cut has loaded.` });
      return;
    }
    inFlight.current = target;
    setSeekTarget(target);
    element.currentTime = target / 1000;
  }, [durationMs]);

  useImperativeHandle(handle, () => ({
    seek,
    position: () => (video.current ? video.current.currentTime * 1000 : positionMs),
  }), [seek, positionMs]);

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
    setErrorCode(null);
    setShape(null);
    setBuffered([]);
    const report = (ms: number) => { setPositionMs(ms); onTimeRef.current(ms); };
    const sync = () => {
      if (!Number.isFinite(element.duration) || !element.duration) return;
      setDurationMs(element.duration * 1000);
      if (element.videoWidth && element.videoHeight) setShape({ width: element.videoWidth, height: element.videoHeight });
      onMeta({ durationMs: element.duration * 1000, width: element.videoWidth, height: element.videoHeight });
      onProgress();
      const queued = queuedSeek.current;
      if (queued !== null) {
        queuedSeek.current = null;
        inFlight.current = queued;
        element.currentTime = clampSeekMs(queued, element.duration * 1000) / 1000;
      }
    };
    const fail = () => {
      clearBuffering();
      setSeekTarget(null);
      setErrorCode(element.error?.code ?? 0);
    };
    // The spinner waits a beat, so a seek inside the buffer never flashes it.
    const startBuffering = () => {
      if (bufferingTimer.current) return;
      bufferingTimer.current = setTimeout(() => setBuffering(true), BUFFERING_DELAY_MS);
    };
    const clearBuffering = () => {
      if (bufferingTimer.current) clearTimeout(bufferingTimer.current);
      bufferingTimer.current = null;
      setBuffering(false);
    };
    const onSeeked = () => {
      const target = inFlight.current;
      inFlight.current = null;
      setSeekTarget(null);
      report(element.currentTime * 1000);
      if (!element.seeking) clearBuffering();
      if (target !== null && !seekLanded(target, element.currentTime)) {
        toast("Couldn't jump to that point", { description: `The player stopped at ${timecode(element.currentTime * 1000)} instead of ${timecode(target)}.` });
      }
    };
    const onReady = () => { if (!element.seeking) clearBuffering(); };
    const onProgress = () => {
      const next = bufferedSpans(element.buffered, element.duration * 1000);
      setBuffered((current) => (sameSpans(current, next) ? current : next));
    };
    const onTimeUpdate = () => { if (!element.seeking) report(element.currentTime * 1000); };

    if (element.error) fail();
    else if (element.readyState >= 1) sync();
    const listeners: [string, () => void][] = [
      ["loadedmetadata", sync], ["durationchange", sync], ["error", fail],
      ["seeking", startBuffering], ["waiting", startBuffering], ["seeked", onSeeked],
      ["canplay", onReady], ["playing", onReady], ["progress", onProgress],
      ["timeupdate", onTimeUpdate], ["timeupdate", onProgress],
    ];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
      if (bufferingTimer.current) clearTimeout(bufferingTimer.current);
      bufferingTimer.current = null;
    };
  }, [onMeta, source?.src]);

  /** Reloads a failed source and puts the playhead back where it was. */
  const retry = useCallback(() => {
    const element = video.current;
    if (!element) return;
    queuedSeek.current = positionMs > 0 ? positionMs : null;
    setErrorCode(null);
    element.load();
  }, [positionMs]);

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

  // Transport shortcuts, skipped while typing and for keys a focused control owns.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (playerShouldIgnoreKey(event)) return;
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

  // Scrubbing: the playhead follows the pointer while it is held, and the one real seek
  // happens on release, so a drag does not queue dozens of competing range requests.
  const pointerMs = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return positionFromPointer(event.clientX, bounds.left, bounds.width, durationMs);
  };
  const scrubStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!durationMs || failed || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragMs(pointerMs(event));
  };
  const scrubMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragMs !== null) setDragMs(pointerMs(event));
  };
  const scrubEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragMs === null) return;
    const target = pointerMs(event);
    setDragMs(null);
    seek(target);
  };

  const markers = still ? [] : notes.filter((note) => note.startMs !== null);
  // The playhead shows a drag or a seek in flight; the clock only ever shows the real time.
  const headMs = dragMs ?? seekTarget ?? positionMs;
  const progress = durationMs ? Math.min(100, (headMs / durationMs) * 100) : 0;
  const problem = failed ? describePlaybackError(errorCode) : null;
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
        {source && still ? (
          // eslint-disable-next-line @next/next/no-img-element -- streamed through the API with the session cookie; next/image would proxy it without one
          <img
            ref={image}
            src={inlineSrc(source.src)}
            alt={title}
            className={imageFailed ? "rvp-still is-failed" : "rvp-still"}
            onLoad={imageLoaded}
            onError={() => setImageFailed(true)}
            draggable={false}
          />
        ) : source ? (
          <video
            ref={video}
            src={source.src}
            playsInline
            className={failed ? "is-failed" : undefined}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div className="rvp-empty">
            <Film size={28} />
            <p>This cut has no preview available yet.</p>
          </div>
        )}
        {/* The element stays mounted when it fails, so Retry can reload it in place. */}
        {problem && (
          <div className="rvp-empty rvp-error" role="alert">
            <Film size={28} />
            <strong>{problem.title}</strong>
            <p>{problem.detail}</p>
            {problem.retryable && (
              <button type="button" className="rvp-retry" onClick={retry}>
                <RotateCw size={14} /> Retry
              </button>
            )}
          </div>
        )}
        {buffering && !failed && (
          <div className="rvp-buffering" role="status" aria-live="polite">
            <Loader2 size={28} aria-hidden="true" />
            <span className="sr-only">Loading…</span>
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

        {still && imageFailed && (
          <div className="rvp-empty rvp-error" role="alert">
            <ImageOff size={28} />
            <strong>Image unavailable</strong>
            <p>The image couldn&rsquo;t be loaded. It may still be processing, or it was removed.</p>
          </div>
        )}
        {surface === "audio" && !failed && (
          <div className="rvp-audio" aria-hidden="true"><AudioLines size={40} /><span>{title}</span></div>
        )}
        <div className="rvp-badge">{title}</div>
        </div>
      </div>

      {!still && <div className="rvp-timeline">
        <div
          className={`rvp-scrub ${dragMs !== null ? "is-dragging" : ""}`}
          role="presentation"
          onPointerDown={scrubStart}
          onPointerMove={scrubMove}
          onPointerUp={scrubEnd}
          onPointerCancel={() => setDragMs(null)}
        >
          {buffered.map((span) => (
            <span key={`${span.start}-${span.end}`} className="rvp-buffered" style={{ left: `${span.start}%`, width: `${span.end - span.start}%` }} />
          ))}
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
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); seek(note.startMs!); onFocusNote(note.id); }}
            >
              <i>{note.initials}</i>
            </button>
          ))}
        </div>
      </div>}

      <div className={`rvp-transport ${still ? "is-still" : ""}`}>
        {still && <span className="rvp-doc-label">Image{shape ? ` · ${shape.width} × ${shape.height}` : ""} · comments apply to the whole image</span>}
        {!still && <><div className="rvp-group">
          <button type="button" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame (←)"><ChevronFirst /></button>
          <button type="button" className="rvp-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title="Play / pause (space)" disabled={!source || failed}>
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next frame" title="Next frame (→)"><ChevronLast /></button>
        </div>

        <div className={`rvp-clock ${seekTarget !== null ? "is-seeking" : ""}`} aria-live="off">
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

        </>}
        {!still && sources.length > 1 && (
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
