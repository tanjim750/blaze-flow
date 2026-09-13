"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Link2Off, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ReviewVersion } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";

/**
 * Two cuts, side by side.
 *
 * Each side owns its own playback so they can be scrubbed independently, and the link
 * toggle makes one drive the other. The sync is real rather than mocked: the driving side
 * reports its position and the follower is nudged only when it has drifted past a
 * threshold, because assigning `currentTime` every frame fights the browser's own decoding
 * and produces a stutter far worse than the drift it corrects.
 */
const DRIFT_TOLERANCE_SECONDS = 0.35;

export function CompareView({ left, right, sources }: {
  left: ReviewVersion;
  right: ReviewVersion;
  sources: (version: ReviewVersion) => string | null;
}) {
  const [synced, setSynced] = useState(true);
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);

  /** Mirrors one side onto the other while linked. Returns the follower, if any. */
  const follower = (side: "left" | "right") => {
    if (!synced) return null;
    return side === "left" ? rightRef.current : leftRef.current;
  };

  return (
    <div className="rv-compare">
      <div className="rv-compare-bar">
        <button
          type="button"
          className={synced ? "is-linked" : ""}
          onClick={() => setSynced(!synced)}
          aria-pressed={synced}
        >
          {synced ? <Link2 size={14} /> : <Link2Off size={14} />}
          {synced ? "Playback linked" : "Playing separately"}
        </button>
        <span>Comparing {left.label} with {right.label}</span>
      </div>

      <div className="rv-compare-grid">
        <ComparePane version={left} src={sources(left)} videoRef={leftRef} follower={() => follower("left")} />
        <ComparePane version={right} src={sources(right)} videoRef={rightRef} follower={() => follower("right")} />
      </div>
    </div>
  );
}

function ComparePane({ version, src, videoRef, follower }: {
  version: ReviewVersion;
  src: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  follower: () => HTMLVideoElement | null;
}) {
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<{ width: number; height: number } | null>(null);

  // The same hydration race the main player has: the browser can settle the video before
  // React attaches its handlers, leaving duration at zero.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const sync = () => {
      if (!Number.isFinite(element.duration) || !element.duration) return;
      setDurationMs(element.duration * 1000);
      // The frame is sized from this, so a vertical cut is shown vertical rather than
      // filling the pane and losing its top and bottom.
      if (element.videoWidth && element.videoHeight) setShape({ width: element.videoWidth, height: element.videoHeight });
    };
    const fail = () => setFailed(true);
    if (element.error) fail();
    else if (element.readyState >= 1) sync();
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("error", fail);
    return () => { element.removeEventListener("loadedmetadata", sync); element.removeEventListener("error", fail); };
  }, [src, videoRef]);

  const seek = (ms: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = ms / 1000;
    setPositionMs(ms);
    const other = follower();
    if (other) other.currentTime = ms / 1000;
  };

  const toggle = () => {
    const element = videoRef.current;
    if (!element) return;
    const other = follower();
    if (element.paused) {
      void element.play();
      if (other) { other.currentTime = element.currentTime; void other.play(); }
    } else {
      element.pause();
      other?.pause();
    }
  };

  const progress = durationMs ? (positionMs / durationMs) * 100 : 0;

  return (
    <section className="rv-compare-pane">
      <header>
        <strong>{version.label}</strong>
        <span title={version.title}>{version.title}</span>
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
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                setPositionMs(element.currentTime * 1000);
                const other = follower();
                if (other && Math.abs(other.currentTime - element.currentTime) > DRIFT_TOLERANCE_SECONDS) {
                  other.currentTime = element.currentTime;
                }
              }}
            />
          : <p className="rv-compare-empty">No preview available for {version.label}.</p>}
        </div>
      </div>

      <div className="rv-compare-controls">
        <button type="button" onClick={toggle} aria-label={playing ? `Pause ${version.label}` : `Play ${version.label}`} disabled={!src || failed}>
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <strong>{timecode(positionMs)}</strong>
        <div
          className="rv-compare-scrub"
          role="presentation"
          onClick={(event) => {
            if (!durationMs) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            seek(((event.clientX - bounds.left) / bounds.width) * durationMs);
          }}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
        <span>{timecode(durationMs)}</span>
        <button type="button" onClick={() => { const element = videoRef.current; if (element) { element.muted = !muted; setMuted(!muted); } }} aria-label={muted ? `Unmute ${version.label}` : `Mute ${version.label}`}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </section>
  );
}
