import Image from "next/image";
import { cn } from "@/lib/utils";

/** Real screenshots, captured at 1440×900 from the demo workspace and stored at 1920×1200. */
export const SCREENS = {
  review: { src: "/marketing/review.webp", alt: "Review page: a client cut with an ellipse drawn on the frame and time-stamped comments beside it", url: "review" },
  aiqaPoster: { src: "/marketing/aiqa-poster.webp", alt: "AI Visual QA on a poster: the misspelt word PREMUIM is outlined on the image and listed against the approved copy", url: "review · AI QA" },
  aiqaVideo: { src: "/marketing/aiqa-video.webp", alt: "AI Visual QA on a video: a typo in a title is highlighted on the frame with its time range", url: "review · AI QA" },
  files: { src: "/marketing/files.webp", alt: "Files browser: client folders, video and image thumbnails with durations, stages and sizes", url: "files" },
  tasks: { src: "/marketing/tasks.webp", alt: "Tasks board with To do, In progress, Review, Client review and Revisions columns and cut thumbnails", url: "tasks" },
  dashboard: { src: "/marketing/dashboard.webp", alt: "Studio dashboard: approvals waiting, project health, money collected and outstanding", url: "dashboard" },
  portal: { src: "/marketing/portal.webp", alt: "Branded client portal: cuts waiting for review, recently approved deliverables and a file drop for the studio", url: "portal" },
} as const;

export type ScreenKey = keyof typeof SCREENS;

export function Screenshot({ name, eager = false, className, sizes = "(max-width: 900px) 100vw, 680px" }: { name: ScreenKey; eager?: boolean; className?: string; sizes?: string }) {
  const screen = SCREENS[name];
  return (
    <figure className={cn("mk-frame", className)} style={{ margin: 0 }}>
      <div className="mk-frame-inner">
        <div className="mk-frame-bar" aria-hidden="true"><i /><i /><i /><span>{screen.url}</span></div>
        <Image src={screen.src} alt={screen.alt} width={1920} height={1200} sizes={sizes} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} />
      </div>
    </figure>
  );
}
