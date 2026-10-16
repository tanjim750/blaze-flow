"use client";

import { Film } from "lucide-react";
import { useState } from "react";

/**
 * A cut's poster in the Review Queue: letterboxed into its 16:9 slot (`contain`, never
 * cropped), so a 9:16 story keeps its shape. Falls back to the plate when there is no
 * poster yet or it fails to load.
 */
export function DashboardPoster({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="review-thumbnail review-plate" aria-hidden="true"><Film size={14} /></span>;
  return <span className="review-thumbnail has-poster" aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- server posters are auth-proxied, same-origin and already sized; next/image adds nothing here */}
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
  </span>;
}
