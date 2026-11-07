"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { onUploadLanded } from "@/lib/upload-store";

/** Debounce so a batch of uploads finishing together costs one refresh. */
export const REFRESH_DEBOUNCE_MS = 400;

/**
 * Mounted once in the root layout. When an upload lands (or finishes processing) it refreshes
 * the current route, which also drops Next's client router cache, so the file shows up on the
 * page being viewed and on any Files page the user navigates back to, without a reload.
 */
export function UploadRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onUploadLanded(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; router.refresh(); }, REFRESH_DEBOUNCE_MS);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [router]);
  return null;
}
