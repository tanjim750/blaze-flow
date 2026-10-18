"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Mockups honour prefers-reduced-motion: motion drops transform animations for those users. */
export function MockupMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
