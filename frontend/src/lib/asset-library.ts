"use client";

import { useSyncExternalStore } from "react";

export type LibraryKind = "video" | "audio" | "image" | "document" | "source" | "other";
export type LibraryFolder = { id: string; name: string; clientId: string | null; projectId: string | null; parentFolderId: string | null; createdAt: string; createdBy: string };
export type LibraryFile = { id: string; name: string; kind: LibraryKind; mimeType: string; size: number; url: string | null; preview: string | null; uploadedBy: string; uploadedAt: string; folderId: string | null; clientId: string | null; projectId: string | null };
export type LibraryState = { folders: LibraryFolder[]; files: LibraryFile[]; deletedIds: string[] };

const KEY = "blazeflow.asset-library.v1";
const seed: LibraryState = { folders: [
  { id: "demo-footage", name: "Footage", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-05T10:00:00Z", createdBy: "Blaze Flow" },
  { id: "demo-graphics", name: "Graphics", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-06T10:00:00Z", createdBy: "Blaze Flow" },
  { id: "demo-sound", name: "Sound Effects", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-07T10:00:00Z", createdBy: "Blaze Flow" },
], files: [
  { id: "demo-video-1", name: "interview-camera-a.mp4", kind: "video", mimeType: "video/mp4", size: 482344960, url: null, preview: null, uploadedBy: "Aaron Jackson", uploadedAt: "2026-09-05T11:00:00Z", folderId: "demo-footage", clientId: null, projectId: null },
  { id: "demo-video-2", name: "b-roll-01.mov", kind: "video", mimeType: "video/quicktime", size: 894232100, url: null, preview: null, uploadedBy: "Aaron Jackson", uploadedAt: "2026-09-05T11:10:00Z", folderId: "demo-footage", clientId: null, projectId: null },
  { id: "demo-image-1", name: "campaign-lockup.png", kind: "image", mimeType: "image/png", size: 2840000, url: null, preview: "/images/asset-vfx.svg", uploadedBy: "Sarah Lin", uploadedAt: "2026-09-06T12:00:00Z", folderId: "demo-graphics", clientId: null, projectId: null },
  { id: "demo-audio-1", name: "city-ambience.wav", kind: "audio", mimeType: "audio/wav", size: 18400000, url: null, preview: null, uploadedBy: "Elena Rostova", uploadedAt: "2026-09-07T12:00:00Z", folderId: "demo-sound", clientId: null, projectId: null },
], deletedIds: [] };
let snapshot = seed;
const listeners = new Set<() => void>();
const normalize = (value: LibraryState | null): LibraryState => value ? { folders: value.folders ?? [], files: value.files ?? [], deletedIds: value.deletedIds ?? [] } : seed;
if (typeof window !== "undefined") { try { snapshot = normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { snapshot = seed; } }
const emit = () => { if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(snapshot)); listeners.forEach((listener) => listener()); };
export function useAssetLibrary() { return useSyncExternalStore((listener) => { listeners.add(listener); const storage = () => { try { snapshot = normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { snapshot = seed; } listener(); }; window.addEventListener("storage", storage); return () => { listeners.delete(listener); window.removeEventListener("storage", storage); }; }, () => snapshot, () => seed); }
export function updateLibrary(update: (state: LibraryState) => LibraryState) { snapshot = update(snapshot); emit(); }
export function replaceLibrary(state: LibraryState) { snapshot = normalize(state); emit(); }
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
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
