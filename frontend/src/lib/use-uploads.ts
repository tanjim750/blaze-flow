"use client";

import { useSyncExternalStore } from "react";
import { getUploads, subscribe, type UploadItem } from "./upload-store";

const empty: UploadItem[] = [];
/** The global upload queue, live. */
export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribe, getUploads, () => empty);
}
