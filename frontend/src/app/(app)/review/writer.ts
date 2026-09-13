"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { AnnotationElement } from "@/lib/api";
import type { ReviewNote } from "@/lib/review-notes";
import type { ReviewView } from "@/lib/review-view";
import { addLocalAnnotation, addLocalNote, removeLocalAnnotation, removeLocalNote, setLocalNoteResolved, toggleLocalReaction } from "@/lib/review-local";
import { updateAssetFile } from "@/lib/asset-api-client";
import {
  addAnnotationAction, deleteAnnotationAction, postNoteAction, reactToCommentAction,
  recolorAnnotationAction, requestRevisionAction, setNoteResolvedAction, transitionStageAction,
  updateAnnotationElementsAction, type ActionState,
} from "./actions";

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
};

function csrfToken(): string {
  const match = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return match ? decodeURIComponent(match.slice("csrftoken=".length)) : "";
}

const extensionFor = (mimeType: string) => {
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  return subtype === "quicktime" ? "mov" : subtype === "mpeg" ? "mp3" : subtype;
};

export function useReviewWriter(view: ReviewView, author: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = view.target;
  const mediaId = view.version?.id ?? null;

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
        author,
        parentId: input.parentId,
        mentions: input.mentions,
        recording: input.recording ? { url: input.recording.url, mimeType: input.recording.mimeType, kind: input.recording.kind } : null,
        annotation: input.annotation ? { elements: [input.annotation] } : null,
      });
      return Boolean(note);
    }
    return run(async () => {
      const created = await postNoteAction({
        ...target,
        text: input.text.trim() || (input.recording?.kind === "voice" ? "Voice comment" : "Screen recording"),
        startMs: input.startMs,
        parentId: input.parentId,
        mentionedUserIds: input.mentions.map((mention) => mention.id),
      });
      if (created.error || !created.commentId) return { error: created.error ?? "The comment was not created." };
      if (input.recording) await attachRecording(created.commentId, input.recording);
      if (input.annotation) {
        const drawn = await addAnnotationAction(target.workspaceId, target.projectId, target.versionId, input.annotation, input.startMs ?? 0);
        if (drawn.error) return drawn;
      }
      return undefined;
    });
  }, [attachRecording, author, mediaId, run, target]);

  const setResolved = useCallback((note: ReviewNote, resolved: boolean) => {
    if (!target || note.local) { if (mediaId) setLocalNoteResolved(mediaId, note.id, resolved); return; }
    void run(() => setNoteResolvedAction(target.workspaceId, target.projectId, target.versionId, note.id, resolved));
  }, [mediaId, run, target]);

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

  /**
   * Moves the file's task stage, which is the status the board and the Files list both
   * read. Review and the board therefore share one state rather than each keeping its own.
   */
  const setTaskStage = useCallback((stageId: string | null) => {
    const assetFileId = view.version?.assetFileId;
    if (!view.workspaceId || !assetFileId) { setError("This cut is not in the asset library, so it has no board status to set."); return Promise.resolve(false); }
    return run(async () => { await updateAssetFile(view.workspaceId!, assetFileId, { task_stage_id: stageId }); });
  }, [run, view.version?.assetFileId, view.workspaceId]);

  return { error, setError, busy, compose, setResolved, react, removeNote, draw, eraseAnnotation, moveAnnotation, recolorAnnotation, moveToStage, requestChanges, setTaskStage };
}

export type ReviewWriter = ReturnType<typeof useReviewWriter>;
