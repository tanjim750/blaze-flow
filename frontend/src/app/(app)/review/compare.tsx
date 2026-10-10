"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronFirst, ChevronLast, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ReviewVersion } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import { playerShouldIgnoreKey } from "./player-keys";
import { positionFromPointer } from "./player-state";

/**
 * Two cuts, side by side, under one transport.
 *
 * One play button, one scrubber and one clock drive both videos, so the two are always
 * looking at the same moment — the point of comparing. The longer cut leads: its clock is
 * the shared one, and the other is nudged back into step only when it drifts past a
 * threshold, because assigning `currentTime` every frame fights the browser's decoder and
 * stutters far worse than the drift it corrects. A shorter cut simply holds its last frame
 * once it runs out. Only one side plays sound at a time, picked in the transport.
 */
export const DRIFT_TOLERANCE_SECONDS = 0.15;
const FRAME_SECONDS = 1 / 25;

/** Lets the comments panel's timecode chips seek the comparison (both sides move together). */
export type CompareHandle = { seek: (versionId: string, ms: number) => void };

type Side = "left" | "right";

export function CompareView({ left, right, sources, handle }: {
  left: ReviewVersion;
  right: ReviewVersion;
  sources: (version: ReviewVersion) => string | null;
  handle?: React.Ref<CompareHandle>;
}) {
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);
  const [durations, setDurations] = useState<Record<Side, number>>({ left: 0, right: 0 });
  const [positionMs, setPositionMs] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audio, setAudio] = useState<Side>("left");
  const [muted, setMuted] = useState(false);

  const durationMs = Math.max(durations.left, durations.right);
  const leader: Side = durations.right > durations.left ? "right" : "left";
  const videos = useCallback(() => [leftRef.current, rightRef.current].filter((item): item is HTMLVideoElement => Boolean(item)), []);
  const element = useCallback((side: Side) => (side === "left" ? leftRef.current : rightRef.current), []);

  /** Puts both sides on `ms`, each clamped to its own length. */
  const seek = useCallback((ms: number) => {
    const target = Math.max(0, durationMs ? Math.min(ms, durationMs) : ms);
    for (const video of videos()) {
      const own = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
      video.currentTime = Math.min(target / 1000, own);
    }
    setPositionMs(target);
  }, [durationMs, videos]);

  const play = useCallback(() => {
    const lead = element(leader);
    const at = lead ? lead.currentTime : positionMs / 1000;
    // Restart from the top when the leader has already played to its end.
    const restart = lead && lead.duration && at >= lead.duration - 0.05;
    for (const video of videos()) {
      if (restart) video.currentTime = 0;
      else if (video !== lead && Number.isFinite(video.duration) && at < video.duration) video.currentTime = at;
      if (!Number.isFinite(video.duration) || (restart ? 0 : at) < video.duration) void video.play().catch(() => undefined);
    }
    setPlaying(true);
  }, [element, leader, positionMs, videos]);

  const pause = useCallback(() => {
    for (const video of videos()) video.pause();
    setPlaying(false);
  }, [videos]);

  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);
  const step = useCallback((seconds: number) => {
    pause();
    const lead = element(leader);
    seek(((lead?.currentTime ?? positionMs / 1000) + seconds) * 1000);
  }, [element, leader, pause, positionMs, seek]);

  useImperativeHandle(handle, () => ({ seek: (_versionId, ms) => seek(ms) }), [seek]);

  // Sound from one side only; two copies of nearly the same mix just phase against each other.
  useEffect(() => {
    if (leftRef.current) leftRef.current.muted = muted || audio !== "left";
    if (rightRef.current) rightRef.current.muted = muted || audio !== "right";
  }, [audio, muted]);

  // Same keys as the single player, for both sides at once.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (playerShouldIgnoreKey(event)) return;
      const keys: Record<string, () => void> = {
        " ": toggle, k: toggle,
        j: () => step(-1), l: () => (playing ? undefined : play()),
        ArrowLeft: () => step(event.shiftKey ? -1 : -FRAME_SECONDS),
        ArrowRight: () => step(event.shiftKey ? 1 : FRAME_SECONDS),
        m: () => setMuted((value) => !value),
      };
      const action = keys[event.key] ?? keys[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, playing, step, toggle]);

  /** The leader's clock is the shared clock; the follower is corrected only past the tolerance. */
  const onLeaderTime = (side: Side, video: HTMLVideoElement) => {
    if (side !== leader) return;
    setPositionMs(video.currentTime * 1000);
    const other = element(side === "left" ? "right" : "left");
    if (!other || other.seeking || !playing) return;
    const otherEnd = Number.isFinite(other.duration) ? other.duration : Infinity;
    if (video.currentTime < otherEnd && Math.abs(other.currentTime - video.currentTime) > DRIFT_TOLERANCE_SECONDS) {
      other.currentTime = video.currentTime;
    }
  };

  const pointerMs = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return positionFromPointer(event.clientX, bounds.left, bounds.width, durationMs);
  };
  const headMs = dragMs ?? positionMs;
  const progress = durationMs ? Math.min(100, (headMs / durationMs) * 100) : 0;
  const anyPlayable = Boolean(sources(left) || sources(right));

  return (
    <div className="rv-compare">
      <div className="rv-compare-grid">
        {([["left", left, leftRef], ["right", right, rightRef]] as const).map(([side, version, ref]) => (
          <ComparePane
            key={version.id}
            side={side}
            version={version}
            src={sources(version)}
            videoRef={ref}
            positionMs={positionMs}
            durationMs={durations[side]}
            audible={!muted && audio === side}
            onDuration={(ms) => setDurations((current) => (current[side] === ms ? current : { ...current, [side]: ms }))}
            onTime={(video) => onLeaderTime(side, video)}
            onEnded={() => { if (side === leader) setPlaying(false); }}
            onToggle={toggle}
          />
        ))}
      </div>

      <div className="rv-compare-transport" role="group" aria-label={`Shared transport for ${left.label} and ${right.label}`}>
        <div className="rv-compare-buttons">
          <button type="button" onClick={() => step(-FRAME_SECONDS)} aria-label="Previous frame" title="Previous frame (←)"><ChevronFirst size={15} /></button>
          <button type="button" className="rv-compare-play" onClick={toggle} disabled={!anyPlayable} aria-label={playing ? "Pause both" : "Play both"} title="Play / pause both (space)">
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button type="button" onClick={() => step(FRAME_SECONDS)} aria-label="Next frame" title="Next frame (→)"><ChevronLast size={15} /></button>
        </div>
        <span className="rv-compare-clock" aria-live="off"><strong>{timecode(headMs)}</strong> / {timecode(durationMs)}</span>
        <div
          className={`rv-compare-scrub ${dragMs !== null ? "is-dragging" : ""}`}
          role="slider"
          tabIndex={0}
          aria-label="Position in both cuts"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(headMs / 1000)}
          aria-valuetext={timecode(headMs)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              seek(headMs + (event.key === "ArrowLeft" ? -1000 : 1000));
            }
          }}
          onPointerDown={(event) => {
            if (!durationMs || event.button !== 0) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragMs(pointerMs(event));
          }}
          onPointerMove={(event) => { if (dragMs !== null) setDragMs(pointerMs(event)); }}
          onPointerUp={(event) => {
            if (dragMs === null) return;
            setDragMs(null);
            seek(pointerMs(event));
          }}
          onPointerCancel={() => setDragMs(null)}
        >
          <i style={{ width: `${progress}%` }} />
          <b style={{ left: `${progress}%` }} />
        </div>
        <div className="rv-compare-audio" role="radiogroup" aria-label="Play sound from">
          <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} title="Mute (m)" className="rv-compare-mute">
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={audio === side}
              className={audio === side ? "is-on" : ""}
              onClick={() => { setAudio(side); setMuted(false); }}
              title={`Sound from ${(side === "left" ? left : right).label}`}
            >
              {(side === "left" ? left : right).label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComparePane({ side, version, src, videoRef, positionMs, durationMs, audible, onDuration, onTime, onEnded, onToggle }: {
  side: Side;
  version: ReviewVersion;
  src: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  positionMs: number;
  durationMs: number;
  audible: boolean;
  onDuration: (ms: number) => void;
  onTime: (video: HTMLVideoElement) => void;
  onEnded: () => void;
  onToggle: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);
  const report = useRef(onDuration);
  useEffect(() => { report.current = onDuration; }, [onDuration]);

  // The same hydration race the main player has: the browser can settle the video before
  // React attaches its handlers, leaving the duration at zero.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const sync = () => {
      if (!Number.isFinite(element.duration) || !element.duration) return;
      report.current(element.duration * 1000);
      // The frame is sized from this, so a vertical cut is shown vertical.
      if (element.videoWidth && element.videoHeight) setShape({ width: element.videoWidth, height: element.videoHeight });
    };
    const fail = () => setFailed(true);
    if (element.error) fail();
    else if (element.readyState >= 1) sync();
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("durationchange", sync);
    element.addEventListener("error", fail);
    return () => {
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("durationchange", sync);
      element.removeEventListener("error", fail);
    };
  }, [src, videoRef]);

  const pastEnd = durationMs > 0 && positionMs > durationMs + 50;

  return (
    <section className="rv-compare-pane" data-side={side}>
      <header>
        <strong>{version.label}</strong>
        <span title={version.title}>{version.title}</span>
        <em className={audible ? "is-on" : ""} aria-label={audible ? "Sound on" : "Muted"}>{audible ? <Volume2 size={11} /> : <VolumeX size={11} />}</em>
      </header>

      <div className="rv-compare-stage">
        <div
          className={shape ? "rv-compare-frame" : "rv-compare-frame is-unsized"}
          style={shape ? { aspectRatio: `${shape.width} / ${shape.height}` } : undefined}
        >
          {src && !failed
            ? <video
                ref={videoRef}
                src={src}
                playsInline
                muted={!audible}
                onClick={onToggle}
                onTimeUpdate={(event) => onTime(event.currentTarget)}
                onSeeked={(event) => onTime(event.currentTarget)}
                onEnded={onEnded}
              />
            : <p className="rv-compare-empty">No preview available for {version.label}.</p>}
          {pastEnd && <span className="rv-compare-ended">{version.label} ends at {timecode(durationMs)}</span>}
        </div>
      </div>
    </section>
  );
}
