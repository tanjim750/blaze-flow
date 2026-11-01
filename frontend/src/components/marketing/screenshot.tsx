import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** Real screenshots, captured at 1440×900 @2x from the demo workspace and stored at 2880×1800. */
export const SCREENS = {
  review: { src: "/marketing/review.webp", alt: "Review page: a client cut with an ellipse drawn on the frame and time-stamped comments beside it" },
  aiqaPoster: { src: "/marketing/aiqa-poster.webp", alt: "AI Visual QA on a poster: the misspelt word PREMUIM is outlined on the image and listed against the approved copy" },
  aiqaVideo: { src: "/marketing/aiqa-video.webp", alt: "AI Visual QA on a video: a typo in a title is highlighted on the frame with its time range" },
  files: { src: "/marketing/files.webp", alt: "Files browser: client folders, video and image thumbnails with durations, stages and sizes" },
  tasks: { src: "/marketing/tasks.webp", alt: "Tasks board with To do, In progress, Review, Client review and Revisions columns and cut thumbnails" },
  dashboard: { src: "/marketing/dashboard.webp", alt: "Studio dashboard: approvals waiting, project health, money collected and outstanding" },
  portal: { src: "/marketing/portal.webp", alt: "Branded client portal: cuts waiting for review, recently approved deliverables and a file drop for the studio" },
} as const;

export type ScreenKey = keyof typeof SCREENS;

/**
 * A real screenshot, shown either as a taped-down polaroid with a handwritten caption or as
 * a chunky ink-bordered card. Lazy unless `eager` (only for the image that is the LCP).
 */
export function Screenshot({ name, eager = false, className, caption, tape = true, variant = "polaroid", decorative = false, sizes = "(max-width: 900px) 100vw, 720px" }: {
  name: ScreenKey;
  eager?: boolean;
  className?: string;
  caption?: ReactNode;
  tape?: boolean;
  variant?: "polaroid" | "card";
  decorative?: boolean;
  sizes?: string;
}) {
  const screen = SCREENS[name];
  return (
    <figure className={cn(variant === "polaroid" ? "mk-polaroid" : "mk-shotcard", className)}>
      {tape && variant === "polaroid" && <span className="mk-tape" aria-hidden="true" />}
      <Image
        src={screen.src}
        alt={decorative ? "" : screen.alt}
        width={2880}
        height={1800}
        sizes={sizes}
        {...(eager ? { preload: true, fetchPriority: "high" as const } : { loading: "lazy" as const })}
      />
      {caption && <figcaption className="mk-hand">{caption}</figcaption>}
    </figure>
  );
}
