"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@/components/icons";

/**
 * The hero's product clip: muted, looping, inline.
 *
 * It deliberately has no `autoPlay` attribute. The page is server-rendered, so an autoplay
 * attribute would start the clip before hydration — before we can check
 * `prefers-reduced-motion`. Instead playback starts here, on mount, only when the visitor
 * has not asked for reduced motion; otherwise the poster stays up with a Play button.
 * It also pauses while scrolled out of view, and the toggle satisfies WCAG 2.2.2
 * (moving content longer than five seconds can be paused).
 */
export function DemoVideo({ label }: { label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const userPaused = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not reliably reflect `muted` onto server-rendered markup, and browsers
    // only allow unmuted playback after a user gesture, so set it on the element itself.
    video.muted = true;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = () => {
      if (query.matches || userPaused.current) return;
      // Older engines return nothing from play(); newer ones reject when autoplay is blocked.
      video.play()?.catch(() => setPlaying(false));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    // The media may already be playing/paused by the time this effect runs.
    setPlaying(!video.paused);
    const onMotionChange = () => (query.matches ? video.pause() : start());
    query.addEventListener("change", onMotionChange);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : video.pause()), { threshold: 0 });
      observer.observe(video);
    } else {
      start();
    }
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      query.removeEventListener("change", onMotionChange);
      observer?.disconnect();
    };
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) { userPaused.current = false; video.play()?.catch(() => setPlaying(false)); }
    else { userPaused.current = true; video.pause(); }
  };

  return (
    <div className="mk-video">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/marketing/demo-poster.webp"
        aria-label={label}
        width={1280}
        height={800}
      >
        <source src="/marketing/demo-clip.webm" type="video/webm" />
        <source src="/marketing/demo-clip.mp4" type="video/mp4" />
      </video>
      <button type="button" className="mk-video-toggle" onClick={toggle} aria-pressed={!playing} aria-label={playing ? "Pause product demo" : "Play product demo"}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        <span>{playing ? "Pause" : "Play demo"}</span>
      </button>
    </div>
  );
}
