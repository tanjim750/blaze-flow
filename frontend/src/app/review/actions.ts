"use server";

import { revalidatePath } from "next/cache";
import { createAnnotation, createGuestInvite, createReviewComment, deleteAnnotation, requestMediaRevision, revokeGuestAccess, revokeGuestInvite, setCommentReaction, setCommentResolution, transitionMediaVersion, updateAnnotation } from "@/lib/api";
import type { AnnotationElement, GuestPermission } from "@/lib/api";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

export async function addPointAnnotationAction(workspaceId: string, projectId: string, versionId: string, x: number, y: number, atMs: number): Promise<ActionState> {
  const result = await createAnnotation(workspaceId, projectId, versionId, {
    ...(atMs > 0 ? { start_time_ms: Math.round(atMs) } : {}),
    elements: [{ element_type: "POINT", geometry: { x, y }, style: { color: "#ffcf5a" }, payload: {} }],
  });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

export async function addAnnotationAction(workspaceId: string, projectId: string, versionId: string, element: Omit<AnnotationElement, "id">, atMs: number): Promise<ActionState> {
  const result = await createAnnotation(workspaceId, projectId, versionId, { ...(atMs > 0 ? { start_time_ms: Math.round(atMs) } : {}), elements: [element] });
  if (!result.ok) return { error: result.error.detail }; revalidatePath("/review"); return ok;
}

export async function deleteAnnotationAction(workspaceId: string, projectId: string, versionId: string, annotationId: string): Promise<ActionState> {
  const result = await deleteAnnotation(workspaceId, projectId, versionId, annotationId);
  if (!result.ok) return { error: result.error.detail }; revalidatePath("/review"); return ok;
}

export async function recolorAnnotationAction(workspaceId: string, projectId: string, versionId: string, annotationId: string, elements: AnnotationElement[], color: string): Promise<ActionState> {
  const result = await updateAnnotation(workspaceId, projectId, versionId, annotationId, { elements: elements.map(({ element_type, geometry, style, payload }) => ({ element_type, geometry, style: { ...style, color }, payload })) });
  if (!result.ok) return { error: result.error.detail }; revalidatePath("/review"); return ok;
}
export async function updateAnnotationElementsAction(workspaceId: string, projectId: string, versionId: string, annotationId: string, elements: AnnotationElement[]): Promise<ActionState> { const result = await updateAnnotation(workspaceId, projectId, versionId, annotationId, { elements: elements.map(({ element_type, geometry, style, payload }) => ({ element_type, geometry, style, payload })) }); if (!result.ok) return { error: result.error.detail }; revalidatePath("/review"); return ok; }

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

export async function reactToCommentAction(workspaceId: string, projectId: string, versionId: string, commentId: string, emoji: string): Promise<ActionState> {
  const result = await setCommentReaction(workspaceId, projectId, versionId, commentId, emoji);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

export async function requestRevisionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const workspaceId = String(form.get("workspaceId") ?? ""); const projectId = String(form.get("projectId") ?? ""); const versionId = String(form.get("versionId") ?? ""); const text = String(form.get("text") ?? "").trim(); const atMs = Number(form.get("atMs") ?? 0);
  if (!workspaceId || !projectId || !versionId || !text) return { error: "Describe the requested revision first." };
  const result = await requestMediaRevision(workspaceId, projectId, versionId, { text, ...(atMs > 0 ? { start_time_ms: Math.round(atMs) } : {}) });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); revalidatePath("/projects"); return ok;
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

/** Moves the active media version to a configured workflow stage, including approval. */
export async function transitionVersionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const versionId = String(form.get("versionId") ?? "");
  const stageId = String(form.get("stageId") ?? "");
  if (!workspaceId || !projectId || !versionId || !stageId) return { error: "Choose a workflow stage." };
  const transitioned = await transitionMediaVersion(workspaceId, projectId, versionId, stageId);
  if (!transitioned.ok) return { error: transitioned.error.detail };
  revalidatePath("/review");
  revalidatePath("/projects");
  return ok;
}

/**
 * Guest permission presets.
 *
 * The API accepts thirteen individual keys, but a share dialog that asks someone to
 * assemble them by hand invites mistakes with a credential that leaves the workspace.
 * These three cover what a client link is actually for; the edit/delete keys are scoped
 * by the backend to the guest's own content, so "Review" cannot touch anyone else's notes.
 */
export const GUEST_PRESETS = {
  view: {
    label: "View only",
    description: "Can open the cut list and read notes.",
    permissions: ["media.read", "review.comment.read", "annotation.read"],
  },
  comment: {
    label: "View and comment",
    description: "Can read, leave notes, and react.",
    permissions: [
      "media.read", "review.comment.read", "review.comment.create",
      "review.comment.edit", "review.reaction.create", "annotation.read",
    ],
  },
  review: {
    label: "Full review",
    description: "Adds attachments, annotations, and downloads.",
    permissions: [
      "media.read", "media.download", "review.comment.read", "review.comment.create",
      "review.comment.edit", "review.comment.delete", "review.reaction.create",
      "review.attachment.create", "review.attachment.delete",
      "annotation.read", "annotation.create", "annotation.edit", "annotation.delete",
    ],
  },
} satisfies Record<string, { label: string; description: string; permissions: GuestPermission[] }>;

export type GuestPreset = keyof typeof GUEST_PRESETS;

/** Carries the one-time token back to the dialog, because the API never returns it again. */
export type GuestInviteState = { error: string | null; token: string | null };
export const emptyGuestInviteState: GuestInviteState = { error: null, token: null };

export async function createGuestInviteAction(_prev: GuestInviteState, form: FormData): Promise<GuestInviteState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const preset = String(form.get("preset") ?? "comment") as GuestPreset;
  const days = Number(form.get("expiresInDays") ?? 7);

  if (!workspaceId || !projectId) {
    return { error: "This review is showing demo content, so links cannot be created.", token: null };
  }
  if (!(preset in GUEST_PRESETS)) return { error: "Choose what the link should allow.", token: null };
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return { error: "Choose an expiry between 1 and 365 days.", token: null };
  }

  const created = await createGuestInvite(workspaceId, projectId, {
    ...(label ? { label } : {}),
    permissions: GUEST_PRESETS[preset].permissions,
    expires_in_hours: Math.round(days * 24),
  });
  if (!created.ok) return { error: created.error.detail, token: null };

  revalidatePath("/review");
  return { error: null, token: created.data.token };
}

/** Revokes the link itself. Sessions already exchanged from it stop working too. */
export async function revokeGuestInviteAction(workspaceId: string, projectId: string, inviteId: string): Promise<ActionState> {
  const result = await revokeGuestInvite(workspaceId, projectId, inviteId);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

/** Revokes one reviewer without invalidating the link for everyone else who holds it. */
export async function revokeGuestAccessAction(workspaceId: string, projectId: string, accessId: string): Promise<ActionState> {
  const result = await revokeGuestAccess(workspaceId, projectId, accessId);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}
