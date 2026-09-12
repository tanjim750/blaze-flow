"use client";

import { useSyncExternalStore } from "react";

export type LibraryKind = "video" | "audio" | "image" | "document" | "source" | "other";
/** The workspace stage a file sits in, or null for "no stage yet". */
export type LibraryStage = { id: string; name: string; color: string };
export type LibraryFolder = { id: string; name: string; clientId: string | null; projectId: string | null; parentFolderId: string | null; createdAt: string; createdBy: string };
/**
 * `id` is the asset-library row; `fileId` is the underlying `File` that holds the bytes.
 * They are different things and the distinction matters: `fileId` is what a media version
 * and a task attachment also point at, so it is the id review is addressed by. It is null
 * only while an upload is still in flight and the server has not named the file yet.
 */
/**
 * `PENDING` until the scanner clears it, then `READY`. A card watches this — together with
 * whether a poster has landed — to know it is still being processed.
 */
export type LibraryFileStatus = "PENDING" | "READY" | "FAILED" | "DUPLICATING";
export type LibraryFile = { id: string; fileId: string | null; name: string; kind: LibraryKind; mimeType: string; size: number; durationMs: number | null; status: LibraryFileStatus; url: string | null; preview: string | null; uploadedBy: string; uploadedAt: string; folderId: string | null; clientId: string | null; projectId: string | null; stageId: string | null };
/**
 * `pending` holds the ids of rows with a server write in flight. Only those rows — and rows
 * the server has never heard of — are allowed to override server data. See `merge` in
 * `asset-library.tsx`.
 */
export type LibraryState = { folders: LibraryFolder[]; files: LibraryFile[]; deletedIds: string[]; pending?: string[] };

const empty: LibraryState = { folders: [], files: [], deletedIds: [], pending: [] };

/**
 * Sample content for the signed-out / no-API story. It is handed to the library explicitly
 * when there is no workspace; it is never mixed into a real one.
 */
export const demoLibrary: LibraryState = { folders: [
  { id: "demo-footage", name: "Footage", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-05T10:00:00Z", createdBy: "Blaze Flow" },
  { id: "demo-graphics", name: "Graphics", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-06T10:00:00Z", createdBy: "Blaze Flow" },
  { id: "demo-sound", name: "Sound Effects", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-07T10:00:00Z", createdBy: "Blaze Flow" },
], files: [
  { id: "demo-video-1", fileId: null, name: "interview-camera-a.mp4", kind: "video", mimeType: "video/mp4", size: 482344960, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Aaron Jackson", uploadedAt: "2026-09-05T11:00:00Z", folderId: "demo-footage", clientId: null, projectId: null, stageId: null },
  { id: "demo-video-2", fileId: null, name: "b-roll-01.mov", kind: "video", mimeType: "video/quicktime", size: 894232100, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Aaron Jackson", uploadedAt: "2026-09-05T11:10:00Z", folderId: "demo-footage", clientId: null, projectId: null, stageId: null },
  { id: "demo-image-1", fileId: null, name: "campaign-lockup.png", kind: "image", mimeType: "image/png", size: 2840000, durationMs: null, status: "READY", url: null, preview: "/images/asset-vfx.svg", uploadedBy: "Sarah Lin", uploadedAt: "2026-09-06T12:00:00Z", folderId: "demo-graphics", clientId: null, projectId: null, stageId: null },
  { id: "demo-audio-1", fileId: null, name: "city-ambience.wav", kind: "audio", mimeType: "audio/wav", size: 18400000, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Elena Rostova", uploadedAt: "2026-09-07T12:00:00Z", folderId: "demo-sound", clientId: null, projectId: null, stageId: null },
], deletedIds: [], pending: [] };

/*
 * Deliberately in memory only. This used to be mirrored into localStorage, where it
 * outlived the page and kept overriding server rows — so a write that failed silently still
 * looked applied after a reload, and the demo content above leaked into real workspaces.
 * A reload now always shows what the server actually has.
 */
let snapshot: LibraryState = empty;
const listeners = new Set<() => void>();
const normalize = (value: LibraryState | null): LibraryState => value
  ? { folders: value.folders ?? [], files: value.files ?? [], deletedIds: value.deletedIds ?? [], pending: value.pending ?? [] }
  : empty;
const emit = () => { listeners.forEach((listener) => listener()); };
export function useAssetLibrary() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => empty); }
export function updateLibrary(update: (state: LibraryState) => LibraryState) { snapshot = update(snapshot); emit(); }
export function snapshotLibrary(): LibraryState { return snapshot; }
export function replaceLibrary(state: LibraryState) { snapshot = normalize(state); emit(); }

/** Marks or clears an in-flight write so `merge` knows whose local row still wins. */
export function markPending(ids: Iterable<string>, inFlight: boolean) {
  const touched = new Set(ids);
  const current = new Set(snapshot.pending ?? []);
  touched.forEach((id) => (inFlight ? current.add(id) : current.delete(id)));
  snapshot = { ...snapshot, pending: [...current] };
  emit();
}

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
/**
 * Whether a file is still being worked on: scanned, or its thumbnail encoded.
 *
 * A poster is only ever produced for video and images, so nothing else is kept waiting on
 * one. `FAILED` is finished, unhappily, and must not spin forever.
 */
export function isProcessing(file: LibraryFile): boolean {
  if (file.status === "DUPLICATING" || file.status === "PENDING") return true;
  if (file.status !== "READY") return false;
  return (file.kind === "video" || file.kind === "image") && !file.preview;
}

export function kindFor(file: Pick<File, "type" | "name">): LibraryKind { const type = file.type.toLowerCase(), ext = file.name.split(".").pop()?.toLowerCase(); if (type.startsWith("video/")) return "video"; if (type.startsWith("audio/")) return "audio"; if (type.startsWith("image/")) return "image"; if (type.includes("pdf") || type.includes("document") || ["pdf", "doc", "docx", "txt", "rtf"].includes(ext || "")) return "document"; if (["psd", "ai", "aep", "prproj", "blend", "fig", "sketch"].includes(ext || "")) return "source"; return "other"; }
export function libraryForProject(state: LibraryState, projectId: string) { return { folders: state.folders.filter((item) => item.projectId === projectId), files: state.files.filter((item) => item.projectId === projectId) }; }
export function descendantFolderIds(folders: LibraryFolder[], folderId: string) {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    folders.forEach((folder) => {
      if (folder.parentFolderId && (folder.parentFolderId === folderId || descendants.has(folder.parentFolderId)) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    });
  }
  return descendants;
}

export function assignFolderTree(state: LibraryState, folder: LibraryFolder, clientId: string | null, projectId: string | null, parentFolderId: string | null) {
  const knownFolders = state.folders.some((item) => item.id === folder.id) ? state.folders : [...state.folders, folder];
  const affected = descendantFolderIds(knownFolders, folder.id).add(folder.id);
  return {
    ...state,
    folders: knownFolders.map((item) => affected.has(item.id) ? { ...item, clientId, projectId, ...(item.id === folder.id ? { parentFolderId } : {}) } : item),
    files: state.files.map((file) => file.folderId && affected.has(file.folderId) ? { ...file, clientId, projectId } : file),
  };
}

export function assignLibraryEntities(state: LibraryState, ids: Iterable<string>, clientId: string | null, projectId: string | null, folderId: string | null) {
  const selected = new Set(ids);
  let next = state;
  const selectedFolders = state.folders.filter((folder) => selected.has(folder.id));
  const roots = selectedFolders.filter((folder) => !hasSelectedAncestor(folder, state.folders, selected));
  const movedFolderIds = new Set<string>();
  roots.forEach((folder) => { movedFolderIds.add(folder.id); descendantFolderIds(state.folders, folder.id).forEach((id) => movedFolderIds.add(id)); next = assignFolderTree(next, folder, clientId, projectId, folderId); });
  return { ...next, files: next.files.map((file) => selected.has(file.id) && !(file.folderId && movedFolderIds.has(file.folderId)) ? { ...file, clientId, projectId, folderId } : file) };
}

// A stage lives on files only, so a selected folder cascades to every file beneath it.
export function stageFileIds(state: LibraryState, ids: Iterable<string>) {
  const selected = new Set(ids);
  const affectedFolders = new Set<string>();
  state.folders.forEach((folder) => { if (selected.has(folder.id)) { affectedFolders.add(folder.id); descendantFolderIds(state.folders, folder.id).forEach((id) => affectedFolders.add(id)); } });
  return state.files.filter((file) => selected.has(file.id) || (file.folderId && affectedFolders.has(file.folderId))).map((file) => file.id);
}

export function applyLibraryStage(state: LibraryState, ids: Iterable<string>, stageId: string | null) {
  const targets = new Set(stageFileIds(state, ids));
  return { ...state, files: state.files.map((file) => targets.has(file.id) ? { ...file, stageId } : file) };
}

function hasSelectedAncestor(folder: LibraryFolder, folders: LibraryFolder[], selected: Set<string>) { let parentId = folder.parentFolderId; while (parentId) { if (selected.has(parentId)) return true; parentId = folders.find((item) => item.id === parentId)?.parentFolderId ?? null; } return false; }

export function deleteLibraryEntities(state: LibraryState, ids: Iterable<string>) {
  const removed = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    state.folders.forEach((folder) => {
      if (folder.parentFolderId && removed.has(folder.parentFolderId) && !removed.has(folder.id)) {
        removed.add(folder.id);
        changed = true;
      }
    });
  }
  return {
    folders: state.folders.filter((folder) => !removed.has(folder.id)),
    files: state.files.filter((file) => !removed.has(file.id) && !(file.folderId && removed.has(file.folderId))),
    deletedIds: [...new Set([...state.deletedIds, ...removed])],
  };
}
