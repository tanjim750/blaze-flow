"use client";

import { useSyncExternalStore } from "react";
import type { AnnotationElement } from "./api";
import type { ReviewNote } from "./review-notes";
import { initialsFrom, relativeAge } from "./review-notes";
import { timecode } from "./timecode";

/**
 * Review data for media the API has nowhere to store it against.
 *
 * A video uploaded through Files is a `ProjectFile`. Notes, annotations and reactions all
 * hang off a `MediaVersion`, which a library file does not have until it is published into
 * a project, so there is no endpoint to post them to. Rather than hide the whole review
 * experience for those files — the spec is explicit that a library upload and a project
 * upload should behave identically once opened — the page runs against this store and says
 * on screen that the notes are local.
 *
 * Deliberately in memory and nowhere else. The asset library was previously mirrored into
 * `localStorage`, where stale rows outlived the page and masqueraded as saved data long
 * after the write behind them had failed; the same trap applies here with more force,
 * because these notes have no server copy to be corrected by. Losing them on reload is the
 * honest behaviour for a draft, and blob URLs for recordings would not survive one anyway.
 *
 * The shapes match `ReviewNote` and `Annotation` exactly, so when a backend route does
 * arrive the review page needs no change — only the writer swaps.
 */

export type LocalAnnotation = {
  id: string;
  review_comment_id: string | null;
  author_user_id: string | null;
  start_time_ms: number | null;
  end_time_ms: number | null;
  elements: AnnotationElement[];
  revision_count: number;
  created_at: string;
  updated_at: string;
};

type MediaReview = { notes: ReviewNote[]; annotations: LocalAnnotation[] };
type State = Record<string, MediaReview>;

const EMPTY_MEDIA: MediaReview = { notes: [], annotations: [] };
let state: State = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Local review data for one media file, keyed by the `File` id the page is addressed by. */
export function useLocalReview(mediaId: string | null): MediaReview {
  return useSyncExternalStore(
    subscribe,
    () => (mediaId ? state[mediaId] ?? EMPTY_MEDIA : EMPTY_MEDIA),
    () => EMPTY_MEDIA,
  );
}

function mutate(mediaId: string, change: (media: MediaReview) => MediaReview) {
  state = { ...state, [mediaId]: change(state[mediaId] ?? EMPTY_MEDIA) };
  emit();
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export type LocalNoteInput = {
  text: string;
  startMs: number | null;
  author: string;
  parentId?: string | null;
  mentions?: { id: string; name: string }[];
  recording?: { url: string; mimeType: string; kind: "voice" | "screen" } | null;
  /** Drawn on the frame as the note was written; stored with it, not on the video. */
  annotation?: { elements: AnnotationElement[] } | null;
};

export function addLocalNote(mediaId: string, input: LocalNoteInput): ReviewNote {
  const now = new Date().toISOString();
  const note: ReviewNote = {
    id: id("local-note"),
    author: input.author,
    authorId: null,
    guestSessionId: null,
    initials: initialsFrom(input.author),
    timecode: input.startMs === null ? null : timecode(input.startMs),
    startMs: input.startMs,
    text: input.text,
    age: relativeAge(now),
    resolved: false,
    reactions: [],
    attachments: [],
    mentions: input.mentions ?? [],
    replies: [],
    local: true,
    recording: input.recording ?? null,
  };
  mutate(mediaId, (media) => {
    const notes = input.parentId
      ? media.notes.map((item) => item.id === input.parentId ? { ...item, replies: [...item.replies, note] } : item)
      : [...media.notes, note];
    const annotations = input.annotation
      ? [...media.annotations, {
          id: id("local-annotation"), review_comment_id: note.id, author_user_id: null,
          start_time_ms: input.startMs, end_time_ms: null, elements: input.annotation.elements,
          revision_count: 0, created_at: now, updated_at: now,
        }]
      : media.annotations;
    return { notes, annotations };
  });
  return note;
}

export function setLocalNoteResolved(mediaId: string, noteId: string, resolved: boolean) {
  mutate(mediaId, (media) => ({ ...media, notes: media.notes.map((note) => note.id === noteId ? { ...note, resolved } : note) }));
}

export function removeLocalNote(mediaId: string, noteId: string) {
  mutate(mediaId, (media) => ({
    notes: media.notes.filter((note) => note.id !== noteId).map((note) => ({ ...note, replies: note.replies.filter((reply) => reply.id !== noteId) })),
    annotations: media.annotations.filter((annotation) => annotation.review_comment_id !== noteId),
  }));
}

/** Toggles the viewer's own reaction. Counts are local, so this is a simple +1/-1. */
export function toggleLocalReaction(mediaId: string, noteId: string, emoji: string) {
  mutate(mediaId, (media) => ({
    ...media,
    notes: media.notes.map((note) => {
      if (note.id !== noteId) return note;
      const existing = note.reactions.find((reaction) => reaction.emoji === emoji);
      if (!existing) return { ...note, reactions: [...note.reactions, { emoji, count: 1 }] };
      return {
        ...note,
        reactions: existing.count > 1
          ? note.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.count - 1 } : reaction)
          : note.reactions.filter((reaction) => reaction.emoji !== emoji),
      };
    }),
  }));
}

export function addLocalAnnotation(mediaId: string, elements: AnnotationElement[], startMs: number | null) {
  const now = new Date().toISOString();
  mutate(mediaId, (media) => ({
    ...media,
    annotations: [...media.annotations, {
      id: id("local-annotation"), review_comment_id: null, author_user_id: null,
      start_time_ms: startMs, end_time_ms: null, elements,
      revision_count: 0, created_at: now, updated_at: now,
    }],
  }));
}

export function removeLocalAnnotation(mediaId: string, annotationId: string) {
  mutate(mediaId, (media) => ({ ...media, annotations: media.annotations.filter((item) => item.id !== annotationId) }));
}

/** Test seam: drops everything, so one spec cannot leak notes into the next. */
export function resetLocalReview() { state = {}; emit(); }
