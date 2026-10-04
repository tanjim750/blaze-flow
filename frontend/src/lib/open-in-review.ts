/**
 * One address for "open this in review", shared by every entry point: Files, a project's
 * files, the task board and list, a task's attachments, and the dashboards.
 *
 *   /review?media=<File id>[&task=<task id>][&from=<return path>][&comment=…][&t=…]
 *
 * - `media` is the `File` id (see `review-media.ts`), so every entry point produces the
 *   same URL for the same cut.
 * - `task` puts the task context panel beside the player (title, stage, assignee, due).
 * - `from` is where the review's Back button returns to, including that page's filters.
 *   Browser Back already works because opening review is a real navigation; `from` keeps
 *   the in-page Back right after a refresh or when the review was opened in a new tab.
 *
 * Pure functions only, so the rules are unit-tested.
 */

export type ReviewLink = {
  mediaId: string;
  taskId?: string | null;
  from?: string | null;
  commentId?: string | null;
  timeMs?: number | null;
};

/** Builds the canonical review URL. Parameter order is fixed so links compare equal. */
export function reviewHref({ mediaId, taskId, from, commentId, timeMs }: ReviewLink): string {
  const params = new URLSearchParams();
  params.set("media", mediaId);
  if (taskId) params.set("task", taskId);
  if (commentId) params.set("comment", commentId);
  if (timeMs !== null && timeMs !== undefined && Number.isFinite(timeMs) && timeMs >= 0) params.set("t", String(Math.round(timeMs)));
  const back = safeReturnPath(from);
  if (back) params.set("from", back);
  return `/review?${params.toString()}`;
}

/**
 * A same-origin, in-app path or null. Rejects absolute URLs, protocol-relative `//host`,
 * backslash tricks and review itself (Back from review should never land on review).
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const path = raw.split(/[?#]/)[0];
  if (path === "/review" || path.startsWith("/review/") || path === "/review-embed") return null;
  return raw;
}

/** "Files", "Tasks", "Home"… for the review page's Back button. */
export function returnLabel(path: string | null): string {
  if (!path) return "Back";
  const route = path.split(/[?#]/)[0];
  if (route === "/") return "Home";
  if (route.startsWith("/files")) return "Files";
  if (route.startsWith("/tasks")) return "Tasks";
  if (route.startsWith("/projects")) return "Project";
  if (route.startsWith("/notifications")) return "Notifications";
  if (route.startsWith("/deliverables")) return "Deliverables";
  return "Back";
}

/** Adds `from` to a review link (keeping everything else) unless it already has one. */
export function withReturnPath(href: string, from: string | null | undefined): string {
  const back = safeReturnPath(from);
  if (!back) return href;
  try {
    const url = new URL(href, "http://local");
    if (url.pathname !== "/review" || url.searchParams.has("from")) return href;
    url.searchParams.set("from", back);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return href;
  }
}

export type LinkedCandidate = { fileId: string; mimeType: string | null; versionNumber?: number | null };

const KIND_RANK: Record<string, number> = { video: 0, audio: 1, image: 2, application: 3 };

/**
 * The file a task opens in review. Attach order is kept (the first cut someone linked is
 * usually the one the task is about) but a video beats a still, a still beats a brief, and
 * within a kind the newest version wins. A file whose type we cannot see (a project upload
 * that is not in the library) ranks as a video: those are always cuts.
 */
export function primaryLinkedFile(fileIds: readonly string[] | undefined, known: (fileId: string) => LinkedCandidate | null): string | null {
  if (!fileIds?.length) return null;
  const ranked = fileIds.map((fileId, index) => {
    const info = known(fileId);
    const kind = info?.mimeType ? info.mimeType.split("/")[0] : "video";
    return { fileId, index, rank: KIND_RANK[kind] ?? 4, version: info?.versionNumber ?? 0 };
  });
  ranked.sort((a, b) => a.rank - b.rank || b.version - a.version || a.index - b.index);
  return ranked[0].fileId;
}

/** What clicking a task does: open review for its primary file, or the detail sheet. */
export function taskOpenTarget(task: { id: string; attachment_file_ids?: string[] }, known: (fileId: string) => LinkedCandidate | null, from: string | null):
  { kind: "review"; href: string } | { kind: "sheet" } {
  const fileId = primaryLinkedFile(task.attachment_file_ids, known);
  return fileId ? { kind: "review", href: reviewHref({ mediaId: fileId, taskId: task.id, from }) } : { kind: "sheet" };
}

/** How the review page shows a file: the player for time-based media, a viewer for the rest. */
export type ReviewSurface = "video" | "audio" | "image" | "pdf" | "download";
export function reviewSurface(mimeType: string, name: string): ReviewSurface {
  const type = (mimeType || "").toLowerCase();
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (type.startsWith("video/") || ["mp4", "mov", "m4v", "webm"].includes(extension)) return "video";
  if (type.startsWith("audio/") || ["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(extension)) return "audio";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) return "image";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  return "download";
}
