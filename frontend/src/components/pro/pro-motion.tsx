"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Honour the visitor's reduced-motion setting for every motion component on the page. */
export function ProMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
