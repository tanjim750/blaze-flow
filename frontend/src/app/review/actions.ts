"use server";

import { revalidatePath } from "next/cache";
import { createReviewComment, setCommentResolution } from "@/lib/api";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

/**
 * Posts a review note.
 *
 * `atMs` is the player's position when the composer was opened, forwarded as
 * `start_time_ms` so the note pins to a timecode. It is omitted for a general note, and
 * the backend rejects timing on a reply (`ReviewCommentCreateSerializer`), so a reply
 * never sends it.
 */
export async function postCommentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const text = String(form.get("text") ?? "").trim();
  const workspaceId = String(form.get("workspaceId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const versionId = String(form.get("versionId") ?? "");
  const parentId = String(form.get("parentCommentId") ?? "");
  const atMs = Number(form.get("atMs") ?? "");

  if (!text) return { error: "Write a comment first." };
  if (!workspaceId || !projectId || !versionId) {
    return { error: "This review is showing demo content, so comments cannot be posted." };
  }

  const created = await createReviewComment(workspaceId, projectId, versionId, {
    text,
    ...(parentId ? { parent_comment_id: parentId } : {}),
    ...(!parentId && Number.isFinite(atMs) && atMs > 0 ? { start_time_ms: Math.round(atMs) } : {}),
  });
  if (!created.ok) return { error: created.error.detail };

  revalidatePath("/review");
  return ok;
}

/** Resolves or reopens a note. Requires `REVIEW_COMMENT_MANAGE` on the project. */
export async function resolveCommentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const versionId = String(form.get("versionId") ?? "");
  const commentId = String(form.get("commentId") ?? "");
  const resolved = String(form.get("resolved") ?? "") === "true";

  if (!workspaceId || !projectId || !versionId || !commentId) {
    return { error: "This review is showing demo content, so comments cannot be changed." };
  }

  const updated = await setCommentResolution(workspaceId, projectId, versionId, commentId, resolved);
  if (!updated.ok) return { error: updated.error.detail };

  revalidatePath("/review");
  return ok;
}
