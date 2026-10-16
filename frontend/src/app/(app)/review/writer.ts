"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AnnotationElement, CommentVisibility } from "@/lib/api";
import { initialsFrom, type NoteDrawing, type ReviewNote } from "@/lib/review-notes";
import { timecode } from "@/lib/timecode";
import { EMPTY_OVERLAY, applyOverlay, dropEntry, pruneOverlay, type Overlay } from "@/lib/review-optimistic";
import type { ReviewView } from "@/lib/review-view";
import { addLocalAnnotation, addLocalNote, editLocalNote, removeLocalAnnotation, removeLocalNote, setLocalAnnotationWindow, setLocalNoteResolved, toggleLocalReaction } from "@/lib/review-local";
import { updateAssetFile } from "@/lib/asset-api-client";
import {
  addAnnotationAction, deleteAnnotationAction, deleteNoteAction, editNoteAction, postNoteAction, reactToCommentAction, setAnnotationWindowAction,
  clientDecisionAction, recolorAnnotationAction, requestRevisionAction, setNoteResolvedAction, transitionStageAction,
  updateAnnotationElementsAction, type ActionState,
} from "./actions";
import type { DecisionKind } from "@/lib/review-decisions";

/**
 * Every write the review page makes, in one place.
 *
 * The page has two possible backings — a project `MediaVersion`, which has real endpoints
 * for notes and annotations, and a bare library file, which has none (see
 * `lib/review-local.ts`). Keeping the branch here means the UI never asks which one it is:
 * it calls `compose`, and either a comment is POSTed or a local note is added. That is
 * what lets a video uploaded through Files and one uploaded to a project behave
 * identically once open, and it is the seam to replace when the API grows notes for
 * library files.
 */

export type RecordedClip = { blob: Blob; url: string; mimeType: string; kind: "voice" | "screen"; durationMs: number };

export type ComposeInput = {
  text: string;
  startMs: number | null;
  parentId: string | null;
  mentions: { id: string; name: string }[];
  recording: RecordedClip | null;
  /** Drawn over the frame while composing; saved with the note rather than on the video. */
  annotation: AnnotationElement | null;
  /**
   * Where that drawing stops being shown: `startMs` itself for "just this frame", later to
   * hold it on screen. Null leaves it to the player's default hold.
   */
  annotationEndMs?: number | null;
  /** The out point of an in/out range note; null for a note on one moment. */
  endMs?: number | null;
  /** Team notes stay inside the workspace. Ignored for device-local notes. */
  visibility?: CommentVisibility;
};

function csrfToken(): string {
  const match = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return match ? decodeURIComponent(match.slice("csrftoken=".length)) : "";
}

const extensionFor = (mimeType: string) => {
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  return subtype === "quicktime" ? "mov" : subtype === "mpeg" ? "mp3" : subtype;
};

export function useReviewWriter(view: ReviewView, author: string, authorId: string | null = null) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = view.target;
  const mediaId = view.version?.id ?? null;

  /*
   * Optimistic writes. Post, edit, resolve, delete and a drawing's duration show at once;
   * each entry is pruned when the refreshed server data agrees with it, or dropped (rolled
   * back) the moment its request fails, with the error said in the composer and a toast.
   */
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const annotationEnds = useMemo(() => new Map(view.annotations.map((item) => [item.id, item.end_time_ms])), [view.annotations]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles the overlay with the server data that just arrived
    setOverlay((current) => pruneOverlay(current, view.notes, annotationEnds));
  }, [annotationEnds, view.notes]);
  const apply = useCallback((notes: ReviewNote[]) => applyOverlay(notes, overlay), [overlay]);

  /** Sends one optimistic write; on failure undoes `rollback`, reports, and resolves false. */
  const optimistic = useCallback(async (work: () => Promise<ActionState>, rollback: () => void, failure: string) => {
    setError(null);
    try {
      const result = await work();
      if (result.error) throw new Error(result.error);
      router.refresh();
      return true;
    } catch (cause) {
      rollback();
      const message = cause instanceof Error && cause.message ? cause.message : failure;
      setError(message);
      toast.error(failure, { description: message === failure ? undefined : message });
      return false;
    }
  }, [router]);

  const run = useCallback(async (work: () => Promise<ActionState | void>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result && result.error) { setError(result.error); return false; }
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [router]);

  /**
   * Uploads a recording as an attachment on the note that carries it.
   *
   * Recordings are not a separate kind of object on the server: the review API already
   * accepts arbitrary files against a comment, and the attachment's own mime type is
   * enough to decide whether it plays back as audio or video. So a voice note persists
   * for real, rather than being mocked, without any new endpoint.
   */
  const attachRecording = useCallback(async (commentId: string, clip: RecordedClip) => {
    if (!target) return;
    const name = `${clip.kind === "voice" ? "voice-note" : "screen-recording"}-${Date.now()}.${extensionFor(clip.mimeType)}`;
    const body = new FormData();
    body.set("file", new File([clip.blob], name, { type: clip.mimeType }));
    const response = await fetch(
      `/api/workspaces/${target.workspaceId}/projects/${target.projectId}/media-versions/${target.versionId}/comments/${commentId}/attachments/`,
      { method: "POST", body, credentials: "include", headers: { "X-CSRFToken": csrfToken() } },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(payload?.detail || `The recording could not be uploaded (${response.status}).`);
    }
  }, [target]);

  const compose = useCallback(async (input: ComposeInput): Promise<boolean> => {
    if (!input.text.trim() && !input.recording) {
      setError("Write a comment or record one first.");
      return false;
    }
    if (!target) {
      if (!mediaId) return false;
      const note = addLocalNote(mediaId, {
        text: input.text.trim(),
        startMs: input.startMs,
        endMs: input.endMs ?? null,
        author,
        parentId: input.parentId,
        mentions: input.mentions,
        recording: input.recording ? { url: input.recording.url, mimeType: input.recording.mimeType, kind: input.recording.kind } : null,
        annotation: input.annotation ? { elements: [input.annotation], endMs: input.annotationEndMs ?? null } : null,
      });
      return Boolean(note);
    }
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startMs = input.parentId ? null : input.startMs;
    const endMs = input.parentId ? null : input.endMs ?? null;
    const text = input.text.trim() || (input.recording?.kind === "voice" ? "Voice comment" : "Screen recording");
    const draft: ReviewNote = {
      id: tempId, author, authorId, guestSessionId: null, initials: initialsFrom(author),
      timecode: startMs === null ? null : timecode(startMs), startMs,
      endMs: startMs !== null && endMs !== null && endMs > startMs ? endMs : null,
      text, age: "just now", resolved: false, reactions: [], attachments: [], mentions: input.mentions, replies: [],
      visibility: input.visibility ?? "client", pending: true,
    };
    setOverlay((current) => ({ ...current, added: [...current.added, { tempId, serverId: null, parentId: input.parentId, note: draft }] }));
    setError(null);
    try {
      const created = await postNoteAction({
        ...target, text, startMs, endMs, parentId: input.parentId,
        mentionedUserIds: input.mentions.map((mention) => mention.id),
        visibility: input.visibility,
      });
      if (created.error || !created.commentId) throw new Error(created.error ?? "The comment was not created.");
      const commentId = created.commentId;
      setOverlay((current) => ({ ...current, added: current.added.map((entry) => entry.tempId === tempId ? { ...entry, serverId: commentId } : entry) }));
      // The note exists from here on: a failed recording or drawing is reported, not rolled back.
      try {
        if (input.recording) await attachRecording(commentId, input.recording);
        if (input.annotation) {
          const drawn = await addAnnotationAction(target.workspaceId, target.projectId, target.versionId, input.annotation, input.startMs, commentId, input.annotationEndMs ?? null);
          if (drawn.error) throw new Error(drawn.error);
        }
      } catch (cause) {
        setError(`The note was posted, but ${cause instanceof Error ? cause.message : "its attachment could not be saved."}`);
      }
      router.refresh();
      return true;
    } catch (cause) {
      setOverlay((current) => dropEntry(current, "added", tempId));
      const message = cause instanceof Error ? cause.message : "The comment could not be posted.";
      setError(message);
      toast.error("Comment not posted", { description: `${message} Your text is back in the box.` });
      return false;
    }
  }, [attachRecording, author, authorId, mediaId, router, target]);

  const setResolved = useCallback((note: ReviewNote, resolved: boolean) => {
    if (!target || note.local) { if (mediaId) setLocalNoteResolved(mediaId, note.id, resolved); return; }
    if (note.pending) return;
    setOverlay((current) => ({ ...current, resolved: { ...current.resolved, [note.id]: resolved } }));
    void optimistic(
      () => setNoteResolvedAction(target.workspaceId, target.projectId, target.versionId, note.id, resolved),
      () => setOverlay((current) => dropEntry(current, "resolved", note.id)),
      resolved ? "Couldn't resolve the note" : "Couldn't reopen the note",
    );
  }, [mediaId, optimistic, target]);

  /** Rewrites the viewer's own note or reply. Resolves false (and restores the old text) on failure. */
  const editNote = useCallback(async (note: ReviewNote, text: string): Promise<boolean> => {
    const next = text.trim();
    if (!next) { setError("A note can't be empty. Delete it instead."); return false; }
    if (next === note.text.trim()) return true;
    if (!target || note.local) { if (mediaId) editLocalNote(mediaId, note.id, next); return true; }
    setOverlay((current) => ({ ...current, edits: { ...current.edits, [note.id]: next } }));
    return optimistic(
      () => editNoteAction(target.workspaceId, target.projectId, target.versionId, note.id, next),
      () => setOverlay((current) => dropEntry(current, "edits", note.id)),
      "Couldn't save your edit",
    );
  }, [mediaId, optimistic, target]);

  /** Deletes a note (with its thread) or a reply; it comes back if the server refuses. */
  const deleteNote = useCallback(async (note: ReviewNote): Promise<boolean> => {
    if (!target || note.local) { if (mediaId) removeLocalNote(mediaId, note.id); return true; }
    if (note.pending) return false;
    setOverlay((current) => ({ ...current, deleted: [...current.deleted, note.id] }));
    return optimistic(
      () => deleteNoteAction(target.workspaceId, target.projectId, target.versionId, note.id),
      () => setOverlay((current) => dropEntry(current, "deleted", note.id)),
      "Couldn't delete the note",
    );
  }, [mediaId, optimistic, target]);

  /**
   * Changes how long a posted drawing stays on screen (`endMs === startMs`: just its frame).
   * The caveat from the first drawing-duration change: until now this was fixed at posting.
   */
  const setDrawingWindow = useCallback(async (drawing: NoteDrawing, endMs: number): Promise<boolean> => {
    if (drawing.startMs === null) return false;
    if (!target || drawing.annotationId.startsWith("local-")) {
      if (mediaId) setLocalAnnotationWindow(mediaId, drawing.annotationId, endMs);
      return true;
    }
    const startMs = drawing.startMs;
    setOverlay((current) => ({ ...current, windows: { ...current.windows, [drawing.annotationId]: endMs } }));
    return optimistic(
      () => setAnnotationWindowAction(target.workspaceId, target.projectId, target.versionId, drawing.annotationId, drawing.elements, startMs, endMs),
      () => setOverlay((current) => dropEntry(current, "windows", drawing.annotationId)),
      "Couldn't change how long the drawing shows",
    );
  }, [mediaId, optimistic, target]);

  const react = useCallback((note: ReviewNote, emoji: string) => {
    if (!target || note.local) { if (mediaId) toggleLocalReaction(mediaId, note.id, emoji); return; }
    void run(() => reactToCommentAction(target.workspaceId, target.projectId, target.versionId, note.id, emoji));
  }, [mediaId, run, target]);

  const removeNote = useCallback((note: ReviewNote) => {
    if (note.local && mediaId) removeLocalNote(mediaId, note.id);
  }, [mediaId]);

  const draw = useCallback((element: AnnotationElement, atMs: number) => {
    if (!target) { if (mediaId) addLocalAnnotation(mediaId, [element], atMs); return; }
    void run(() => addAnnotationAction(target.workspaceId, target.projectId, target.versionId, element, atMs));
  }, [mediaId, run, target]);

  const eraseAnnotation = useCallback((annotationId: string) => {
    if (!target || annotationId.startsWith("local-")) { if (mediaId) removeLocalAnnotation(mediaId, annotationId); return; }
    void run(() => deleteAnnotationAction(target.workspaceId, target.projectId, target.versionId, annotationId));
  }, [mediaId, run, target]);

  const moveAnnotation = useCallback((annotationId: string, elements: AnnotationElement[]) => {
    if (!target || annotationId.startsWith("local-")) return;
    void run(() => updateAnnotationElementsAction(target.workspaceId, target.projectId, target.versionId, annotationId, elements));
  }, [run, target]);

  const recolorAnnotation = useCallback((annotationId: string, elements: AnnotationElement[], color: string) => {
    if (!target || annotationId.startsWith("local-")) return;
    void run(() => recolorAnnotationAction(target.workspaceId, target.projectId, target.versionId, annotationId, elements, color));
  }, [run, target]);

  const moveToStage = useCallback((stageId: string) => {
    if (!target) { setError("This cut has no project review record, so it cannot change workflow stage yet."); return Promise.resolve(false); }
    return run(() => transitionStageAction(target.workspaceId, target.projectId, target.versionId, stageId));
  }, [run, target]);

  const requestChanges = useCallback((text: string, startMs: number | null) => {
    if (!target) { setError("This cut has no project review record, so changes cannot be requested against it yet."); return Promise.resolve(false); }
    return run(() => requestRevisionAction(target.workspaceId, target.projectId, target.versionId, text, startMs));
  }, [run, target]);

  /** A client-team member's Approve / Request changes, recorded as a client decision. */
  const decideAsClient = useCallback((decision: DecisionKind, message = "", startMs: number | null = null) => {
    if (!target) { setError("This cut has no project review record, so it cannot be decided on yet."); return Promise.resolve(false); }
    return run(() => clientDecisionAction(target.workspaceId, target.projectId, target.versionId, decision, message, startMs));
  }, [run, target]);

  /**
   * Moves the file's task stage, which is the status the board and the Files list both
   * read. Review and the board therefore share one state rather than each keeping its own.
   */
  const setTaskStage = useCallback((stageId: string | null) => {
    const assetFileId = view.version?.assetFileId;
    if (!view.workspaceId || !assetFileId) { setError("This cut is not in the asset library, so it has no board status to set."); return Promise.resolve(false); }
    return run(async () => { await updateAssetFile(view.workspaceId!, assetFileId, { task_stage_id: stageId }); });
  }, [run, view.version?.assetFileId, view.workspaceId]);

  return { error, setError, busy, overlay, apply, compose, setResolved, editNote, deleteNote, setDrawingWindow, react, removeNote, draw, eraseAnnotation, moveAnnotation, recolorAnnotation, moveToStage, requestChanges, decideAsClient, setTaskStage };
}

export type ReviewWriter = ReturnType<typeof useReviewWriter>;
