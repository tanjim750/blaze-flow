"use client";

/**
 * Small presentational pieces shared by the Files panel's tiles, rows, tree and inspector.
 * Styles live in `files.css` under the `.fx` scope.
 */
import { AudioLines, CircleCheck, CircleDashed, CircleDot, Eye, File, FileImage, FileText, Film, Image as ImageIcon, RotateCcw, Tag, Users } from "lucide-react";
import type { LibraryFile, LibraryKind } from "@/lib/asset-library";
import type { TaskStageKind } from "@/lib/api";
import { middleTruncate, stageTone, type StageTone } from "@/lib/files-panel";
import { StagePill as SharedStagePill } from "@/components/ui/stage-pill";

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

/** A stage as the Files panel sees it: a `TaskStage` payload (`kind` from migration 0030, absent on older backends). */
export type StageLike = { name: string; color: string; kind?: TaskStageKind };

/* Same icon per tone as the Tasks board's `StagePill` (components/tasks/stage-ui.tsx). */
const TONE_ICON: Record<StageTone, typeof Tag> = { neutral: CircleDashed, brand: CircleDot, teal: Eye, info: Users, destructive: RotateCcw, success: CircleCheck };

/**
 * A stage pill per DS spec §13, through the shared `StagePill` (components/ui/stage-pill):
 * a known stage gets its tone, a custom stage the neutral pill with its colour as a dot.
 */
export function StagePill({ stage, variant = "dot" }: { stage: StageLike | null | undefined; variant?: "dot" | "icon" }) {
  if (!stage) return null;
  const tone = stageTone(stage.name, stage.kind);
  const Icon = tone ? TONE_ICON[tone] : null;
  return <SharedStagePill name={stage.name} dataTone={tone ?? undefined} tone={tone ? "var(--tone, var(--muted-foreground))" : null} dot={tone ? null : stage.color} icon={variant === "icon" ? Icon : null} />;
}

/** The neutral pill for "no stage", the same size as a stage pill. */
export function NoStagePill() { return <SharedStagePill name="No stage" />; }

/** Keyboard hint. */
export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="fx-kbd">{children}</kbd>; }
