"use client";

/**
 * Shared Frame.io-style browsing primitives. Used by the studio asset library (Files page
 * and a project's Files tab, via `AssetLibrary`) and by the client portal's project files
 * area, so folders, thumbnails, hover playback and the selection bar look and behave the
 * same everywhere files are browsed. Styles: `frame.css` (scoped under `.frm`).
 */
import { useRef, useState, type ReactNode } from "react";
import { Download, Ellipsis, Link2, X } from "lucide-react";
import { FolderShape, PlayDisc } from "./icons";
import "./frame.css";

export type Preview = { id: string; src: string };

/**
 * A folder card: the tabbed folder shape with up to three of its contents stacked
 * diagonally inside — smallest at the back top-left, largest in front bottom-right. With
 * nothing to show it is the plain folder. Sizes are percentages, so it scales on phones.
 */
export function StackedFolder({ previews }: { previews: Preview[] }) {
  const shown = previews.slice(0, 3);
  // Back-to-front order: index 0 is the back (smallest) layer.
  const layers = shown.length === 1 ? ["is-front"] : shown.length === 2 ? ["is-mid", "is-front"] : ["is-back", "is-mid", "is-front"];
  return (
    <span className="frm-folder" data-count={shown.length} aria-hidden="true">
      <FolderShape className="frm-folder-shape" />
      {shown.length > 0 && <span className="frm-folder-stack">
        {shown.map((preview, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- auth-proxied same-origin posters
          <img key={preview.id} className={`frm-folder-thumb ${layers[index]}`} src={preview.src} alt="" loading="lazy" decoding="async" draggable={false} />
        ))}
      </span>}
    </span>
  );
}

/**
 * A 16:9 media thumbnail. For video with a playable `videoSrc`, hovering starts muted
 * playback (nothing is fetched until then: `preload="none"`); the play disc fades while it
 * plays. Touch devices keep the still poster — a tap opens the file instead.
 */
export function HoverMedia({ poster, videoSrc, isVideo, children }: { poster: ReactNode; videoSrc?: string | null; isVideo: boolean; children?: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const canPlay = isVideo && Boolean(videoSrc);
  const start = (event: React.PointerEvent) => {
    if (!canPlay || event.pointerType === "touch") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const node = video.current; if (!node) return;
    node.muted = true;
    void node.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const stop = () => { const node = video.current; if (node) { node.pause(); try { node.currentTime = 0; } catch { /* not seekable yet */ } } setPlaying(false); };
  return (
    <span className={`frm-media ${playing ? "is-playing" : ""}`} onPointerEnter={start} onPointerLeave={stop}>
      {poster}
      {canPlay && <video ref={video} className="frm-media-video" src={videoSrc!} muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1} />}
      {isVideo && <PlayDisc className="frm-play" />}
      {children}
    </span>
  );
}

/**
 * The selection bar that slides up bottom-centre: "N selected", Copy link, Download, More.
 * `more` is a menu node (e.g. a DropdownMenu) so each caller keeps its own actions and
 * permissions. Buttons are 40px tall so they are comfortable taps at 390px.
 */
export function SelectionBar({ count, onClear, onCopyLink, onDownload, downloadDisabled, more }: {
  count: number; onClear: () => void; onCopyLink?: () => void; onDownload?: () => void; downloadDisabled?: boolean; more?: ReactNode;
}) {
  if (count <= 0) return null;
  // Slide-up is a CSS animation (frame.css) and is dropped under prefers-reduced-motion.
  return (
    <div className="frm-selbar" role="region" aria-label="Selection">
      <button type="button" className="frm-selbar-clear" onClick={onClear} aria-label="Clear selection"><X /></button>
      <strong role="status" aria-live="polite">{count} selected</strong>
      <span className="frm-selbar-sep" aria-hidden="true" />
      {onCopyLink && <button type="button" className="frm-selbar-btn" onClick={onCopyLink}><Link2 /><span>Copy link</span></button>}
      {onDownload && <button type="button" className="frm-selbar-btn" onClick={onDownload} disabled={downloadDisabled}><Download /><span>Download</span></button>}
      {more}
    </div>
  );
}

/** The ⋯ glyph used as the selection bar's "More" trigger content. */
export function MoreLabel() { return <><Ellipsis /><span>More</span></>; }

/** Copies text and reports whether it worked; never throws. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
