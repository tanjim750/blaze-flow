/**
 * Hand-drawn glyphs for the Frame-style browser. Our own paths (not copied from any
 * vendor asset): a folder with a rounded top-left tab, a translucent play disc, and a
 * small share arrow. All take `currentColor` unless noted.
 */
import type { SVGProps } from "react";

/** The folder body + tab as one shape, drawn in a 300×200 box (3:2). Fill is themable. */
export function FolderShape({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 300 200" preserveAspectRatio="none" className={className} aria-hidden="true" focusable="false" {...props}>
      <path d="M14 0h70c7 0 11 3 15 8l8 10c3 4 6 6 12 6h167c8 0 14 6 14 14v148c0 8-6 14-14 14H14c-8 0-14-6-14-14V14C0 6 6 0 14 0Z" fill="currentColor" />
    </svg>
  );
}

/** Small outline folder for list rows and empty states. */
export function FolderGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d="M3.5 6.5a2 2 0 0 1 2-2h3.6c.6 0 1 .2 1.4.6l1.2 1.4h6.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z" />
    </svg>
  );
}

/** A translucent disc with a rounded play triangle, centred over video thumbnails. */
export function PlayDisc(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true" focusable="false" {...props}>
      <circle cx="24" cy="24" r="23" fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
      <path d="M19.5 15.8c0-1.2 1.3-1.9 2.3-1.3l11.6 7.6c.9.6.9 2 0 2.6l-11.6 7.6c-1 .6-2.3-.1-2.3-1.3V15.8Z" fill="#fff" />
    </svg>
  );
}

export function ShareArrow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 15V4m0 0-4 4m4-4 4 4" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
