"use server";

import { revalidatePath } from "next/cache";
import { createAnnotation, createGuestInvite, createMediaDecision, createReviewComment, deleteAnnotation, requestMediaRevision, revokeGuestAccess, revokeGuestInvite, setCommentReaction, setCommentResolution, transitionMediaVersion, updateAnnotation, updateGuestInvite } from "@/lib/api";
import { changeMessageProblem, type DecisionKind } from "@/lib/review-decisions";
import type { AnnotationElement, CommentVisibility } from "@/lib/api";
import { endTimeField, startTimeField } from "@/lib/review-timing";
import { GUEST_PRESETS, invitePermissions, type GuestInviteState, type GuestPreset } from "./guest-presets";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

export async function addPointAnnotationAction(workspaceId: string, projectId: string, versionId: string, x: number, y: number, atMs: number): Promise<ActionState> {
  const result = await createAnnotation(workspaceId, projectId, versionId, {
    ...startTimeField(atMs),
    elements: [{ element_type: "POINT", geometry: { x, y }, style: { color: "#ffcf5a" }, payload: {} }],
  });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

/**
 * `reviewCommentId` links a drawing made while composing to the note it was drawn for, so
 * the drawing shares the note's visibility: a drawing on a team note is hidden from guests
 * along with the note.
 */
/** `untilMs` is how long the drawing stays on screen: `atMs` itself for one frame, later to hold it. */
export async function addAnnotationAction(workspaceId: string, projectId: string, versionId: string, element: Omit<AnnotationElement, "id">, atMs: number | null, reviewCommentId?: string, untilMs: number | null = null): Promise<ActionState> {
  const result = await createAnnotation(workspaceId, projectId, versionId, { ...startTimeField(atMs), ...endTimeField(atMs, untilMs), ...(reviewCommentId ? { review_comment_id: reviewCommentId } : {}), elements: [element] });
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
 * Posts a review note and hands back its id.
 *
 * The id matters: a voice or screen recording is stored as an attachment on the note, so
 * the caller has to be able to address the note it just created. The older form-action
 * version returned only an error and revalidated, which left nothing to attach to.
 *
 * `startMs` is the player position when the composer was opened, sent as `start_time_ms`
 * so the note pins to a timecode. The backend rejects timing on a reply, so a reply never
 * sends it and inherits its parent's instead.
 */
export async function postNoteAction(payload: {
  workspaceId: string; projectId: string; versionId: string;
  text: string; startMs: number | null; parentId: string | null; mentionedUserIds: string[];
  visibility?: CommentVisibility;
  /** The out point of an in/out range note. */
  endMs?: number | null;
}): Promise<{ error: string | null; commentId: string | null }> {
  const text = payload.text.trim();
  if (!text) return { error: "Write a comment first.", commentId: null };
  if (!payload.workspaceId || !payload.projectId || !payload.versionId) {
    return { error: "This cut has no project review record, so notes stay on this device.", commentId: null };
  }

  const created = await createReviewComment(payload.workspaceId, payload.projectId, payload.versionId, {
    text,
    ...(payload.parentId ? { parent_comment_id: payload.parentId } : {}),
    ...(!payload.parentId ? startTimeField(payload.startMs) : {}),
    ...(!payload.parentId && payload.endMs != null && payload.endMs > (payload.startMs ?? Infinity) ? endTimeField(payload.startMs, payload.endMs) : {}),
    ...(payload.mentionedUserIds.length ? { mentioned_user_ids: payload.mentionedUserIds } : {}),
    ...(payload.visibility ? { visibility: payload.visibility } : {}),
  });
  if (!created.ok) return { error: created.error.detail, commentId: null };

  revalidatePath("/review");
  return { error: null, commentId: created.data.id };
}

/** Resolves or reopens a note. Requires `REVIEW_COMMENT_MANAGE` on the project. */
export async function setNoteResolvedAction(
  workspaceId: string, projectId: string, versionId: string, commentId: string, resolved: boolean,
): Promise<ActionState> {
  const updated = await setCommentResolution(workspaceId, projectId, versionId, commentId, resolved);
  if (!updated.ok) return { error: updated.error.detail };
  revalidatePath("/review");
  return ok;
}

export async function reactToCommentAction(workspaceId: string, projectId: string, versionId: string, commentId: string, emoji: string): Promise<ActionState> {
  const result = await setCommentReaction(workspaceId, projectId, versionId, commentId, emoji);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

/**
 * Moves the cut to a configured workflow stage. This is what Approve and Request changes
 * both do — the stage list is the workspace's own, so neither button hard-codes a status.
 */
export async function transitionStageAction(
  workspaceId: string, projectId: string, versionId: string, stageId: string,
): Promise<ActionState> {
  if (!workspaceId || !projectId || !versionId || !stageId) return { error: "Choose a workflow stage." };
  const transitioned = await transitionMediaVersion(workspaceId, projectId, versionId, stageId);
  if (!transitioned.ok) return { error: transitioned.error.detail };
  revalidatePath("/review");
  revalidatePath("/projects");
  revalidatePath("/tasks");
  return ok;
}

/**
 * Requests a revision: posts the note and moves the cut in one call, so "Request changes"
 * does not leave a comment without the state change it was meant to cause.
 */
export async function requestRevisionAction(
  workspaceId: string, projectId: string, versionId: string, text: string, startMs: number | null,
): Promise<ActionState> {
  if (!workspaceId || !projectId || !versionId || !text.trim()) return { error: "Describe the requested revision first." };
  const result = await requestMediaRevision(workspaceId, projectId, versionId, {
    text: text.trim(),
    ...startTimeField(startMs),
  });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review");
  revalidatePath("/projects");
  revalidatePath("/tasks");
  return ok;
}

export async function createGuestInviteAction(_prev: GuestInviteState, form: FormData): Promise<GuestInviteState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const preset = String(form.get("preset") ?? "comment") as GuestPreset;
  const days = Number(form.get("expiresInDays") ?? 7);
  // An unticked checkbox is simply absent from the form.
  const allowDecisions = form.get("allowDecisions") === "on";

  if (!workspaceId || !projectId) {
    return { error: "This review is showing demo content, so links cannot be created.", token: null };
  }
  if (!(preset in GUEST_PRESETS)) return { error: "Choose what the link should allow.", token: null };
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return { error: "Choose an expiry between 1 and 365 days.", token: null };
  }

  const created = await createGuestInvite(workspaceId, projectId, {
    ...(label ? { label } : {}),
    permissions: invitePermissions(preset, allowDecisions),
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

/** "Allow decisions" on an existing link, for everyone already using it too. */
export async function setGuestInviteDecisionsAction(workspaceId: string, projectId: string, inviteId: string, allow: boolean): Promise<ActionState> {
  const result = await updateGuestInvite(workspaceId, projectId, inviteId, { allow_decisions: allow });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review"); return ok;
}

/**
 * A client-team member's Approve / Request changes on this exact cut. Recorded as a client
 * decision (the same record a review link makes) and moves the cut like the team buttons.
 */
export async function clientDecisionAction(
  workspaceId: string, projectId: string, versionId: string, decision: DecisionKind, message: string, startMs: number | null,
): Promise<ActionState> {
  if (!workspaceId || !projectId || !versionId) return { error: "This cut has no project review record." };
  if (decision === "changes_requested") {
    const problem = changeMessageProblem(message);
    if (problem) return { error: problem };
  }
  const result = await createMediaDecision(workspaceId, projectId, versionId, {
    decision,
    ...(decision === "changes_requested" ? { message: message.trim(), ...startTimeField(startMs) } : {}),
  });
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/review");
  revalidatePath("/projects");
  return ok;
}
