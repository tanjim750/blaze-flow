import { WORDMARK_PATH } from "./wordmark";

/**
 * Krewsys "Origami K" mark. Fold colours come from CSS variables in brand.css,
 * so the same inline SVG switches between the light and dark kit variants with the theme.
 */
export function KrewsysMark({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={`ks-mark${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 64 64"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path d="M12 6L26 12V58L12 52Z" className="ks-f1" />
      <path d="M26 12L52 6L26 34Z" className="ks-f2" />
      <path d="M26 34L52 6V20Z" className="ks-f3" />
      <path d="M26 34L54 58H38L26 46Z" className="ks-f2" />
      <path d="M26 34L38 58L26 58Z" className="ks-f1" />
    </svg>
  );
}

/** Horizontal lockup (mark + outlined wordmark). Height drives size; 262×64 artboard. */
export function KrewsysLogo({ height = 24, className, title = "Krewsys" }: { height?: number; className?: string; title?: string }) {
  return (
    <svg className={`ks-logo${className ? ` ${className}` : ""}`} height={height} width={(height * 262) / 64} viewBox="0 0 262 64"
      role="img" aria-label={title} focusable="false">
      <path d="M12 6L26 12V58L12 52Z" className="ks-f1" />
      <path d="M26 12L52 6L26 34Z" className="ks-f2" />
      <path d="M26 34L52 6V20Z" className="ks-f3" />
      <path d="M26 34L54 58H38L26 46Z" className="ks-f2" />
      <path d="M26 34L38 58L26 58Z" className="ks-f1" />
      <path d={WORDMARK_PATH} className="ks-word" />
    </svg>
  );
}

/** Animated fold-loop loader built from the mark (designer loader, tightened to a 1.4s loop). */
export function KrewsysLoader({ size = 48, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span className="ks-loader" role="status" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M12 6L26 12V58L12 52Z" className="ks-f1" />
        <path d="M26 12L52 6L26 34Z" className="ks-f2" />
        <path d="M26 34L52 6V20Z" className="ks-f3 y" />
        <path d="M26 34L54 58H38L26 46Z" className="ks-f2 y" />
        <path d="M26 34L38 58L26 58Z" className="ks-f1" />
      </svg>
    </span>
  );
}

/** Neutral aliases for files that must not spell out the product name. */
export { KrewsysMark as BrandMark, KrewsysLogo as BrandLogo };
