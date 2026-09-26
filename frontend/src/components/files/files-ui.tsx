"use client";

/**
 * Small presentational pieces shared by the Files panel's tiles, rows, tree and inspector.
 * Styles live in `files.css` under the `.fx` scope.
 */
import type { CSSProperties } from "react";
import { AudioLines, CircleCheck, CircleDashed, CircleDot, Eye, File, FileImage, FileText, Film, Image as ImageIcon, RotateCcw, Tag, Users } from "lucide-react";
import type { LibraryFile, LibraryKind } from "@/lib/asset-library";
import { middleTruncate, stageTone, type StageTone } from "@/lib/files-panel";

export function KindIcon({ kind, className }: { kind: LibraryKind; className?: string }) {
  const Icon = kind === "video" ? Film : kind === "audio" ? AudioLines : kind === "image" ? ImageIcon : kind === "document" ? FileText : kind === "source" ? FileImage : File;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * A filename that truncates in the middle, so `spring_launch…_v3_9x16.mp4` keeps both ends.
 * The full name is always in `title` and in the accessible name of the item that owns it.
 */
export function FileName({ name, max = 32, className }: { name: string; max?: number; className?: string }) {
  const short = middleTruncate(name, max);
  return <strong className={className} title={short === name ? undefined : name}>{short}</strong>;
}

/**
 * The 16:9 frame every tile, row and the inspector draw media into.
 *
 * Media is letterboxed (`contain` on the near-black canvas) and never cropped, so a 9:16
 * story or a 1:1 still reads as itself. Types without a poster get a neutral glyph and
 * their extension. Type is never colour-coded.
 */
export function Thumb({ file, size = "md" }: { file: LibraryFile | null; size?: "sm" | "md" | "lg" }) {
  if (!file) return <span className="fx-thumb is-blank" aria-hidden="true" />;
  if (file.preview) {
    return (
      <span className="fx-thumb has-media" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- server posters are auth-proxied, same-origin and already sized; next/image adds nothing here */}
        <img src={file.preview} alt="" loading="lazy" decoding="async" draggable={false} />
      </span>
    );
  }
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase().slice(0, 5) : null;
  return (
    <span className={`fx-thumb is-glyph kind-${file.kind}`} aria-hidden="true">
      <KindIcon kind={file.kind} />
      {size !== "sm" && extension && <em>{extension}</em>}
    </span>
  );
}

const TONE_ICON: Record<StageTone, typeof Tag> = { neutral: CircleDashed, brand: CircleDot, teal: Eye, info: Users, destructive: RotateCcw, success: CircleCheck };

/**
 * A stage pill per DS spec §13: a known stage gets its tone (dot or icon plus label on a
 * 14% tint). A custom stage falls back to the neutral `is-stage` pill with the workspace's
 * colour as a dot only, because an arbitrary hex cannot be relied on for 4.5:1 text.
 */
export function StagePill({ stage, variant = "dot" }: { stage: { name: string; color: string } | null | undefined; variant?: "dot" | "icon" }) {
  if (!stage) return null;
  const tone = stageTone(stage.name);
  const Icon = tone ? TONE_ICON[tone] : null;
  return (
    <span className={`fx-pill ${tone ? "" : "is-stage"}`} data-tone={tone ?? undefined} style={tone ? undefined : ({ "--stage-color": stage.color } as CSSProperties)}>
      {variant === "icon" && Icon ? <Icon aria-hidden="true" /> : <i aria-hidden="true" />}
      {stage.name}
    </span>
  );
}

/** Keyboard hint. */
export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="fx-kbd">{children}</kbd>; }
