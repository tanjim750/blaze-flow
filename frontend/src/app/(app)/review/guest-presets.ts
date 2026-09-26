import type { GuestPermission } from "@/lib/api";

/**
 * Guest permission presets.
 *
 * The API accepts thirteen individual keys, but a share dialog that asks someone to
 * assemble them by hand invites mistakes with a credential that leaves the workspace.
 * These three cover what a client link is actually for; the edit/delete keys are scoped
 * by the backend to the guest's own content, so "Review" cannot touch anyone else's notes.
 *
 * Lives outside `actions.ts` on purpose: a `"use server"` module may only export async
 * functions, and exporting these objects from it made the whole module fail to load, which
 * took every review server action down with it.
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
