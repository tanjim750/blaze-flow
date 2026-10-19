"use client";

import { useCallback, type PointerEvent, type ReactNode } from "react";
import { MotionConfig, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useFinePointer, useReducedMotionSafe } from "./motion-prefs";
import { STROKES } from "./strokes";

/*
 * The small vocabulary the public site is drawn with: hand-drawn strokes that draw
 * themselves in, cards that tilt toward the mouse in 3D, stickers that pop on with a spring,
 * and a spring "rise" for blocks entering the viewport. All of it is skipped for
 * prefers-reduced-motion, and tilt only exists where there is a real mouse.
 */

export const springy = { type: "spring", stiffness: 260, damping: 20 } as const;
export const soft = { type: "spring", stiffness: 140, damping: 20 } as const;

/** Motion settings for every marketing page: motion drops transform animation for reduced-motion visitors. */
export function MarketingMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** A hand-drawn stroke that draws itself in the first time it scrolls into view. */
export function Scribble({ d, className, viewBox = "0 0 120 120", width = 3, delay = 0, duration = 0.9 }: { d: string; className?: string; viewBox?: string; width?: number; delay?: number; duration?: number }) {
  const reduce = useReducedMotionSafe();
  return (
    <svg className={cn("mk-scribble", className)} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">
      <motion.path
        d={d}
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration, ease: "easeInOut", delay }}
      />
    </svg>
  );
}

/** Wraps a word or two in a hand-drawn mark: a circle, or a wavy underline. */
export function Marked({ children, kind = "wave", delay = 0.35 }: { children: ReactNode; kind?: "wave" | "circle"; delay?: number }) {
  const stroke = STROKES[kind];
  return (
    <span className={cn("mk-marked", `is-${kind}`)}>
      {children}
      <Scribble className="mk-marked-stroke" viewBox={stroke.viewBox} d={stroke.d} width={kind === "circle" ? 4 : 5} delay={delay} />
    </span>
  );
}

/** A card that tilts toward the mouse in 3D, on springs. Flat on touch screens and for reduced motion. */
export function Tilt({ children, className, max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotionSafe();
  const fine = useFinePointer();
  const active = fine && !reduce;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), springy);
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), springy);
  const onMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - box.left) / box.width - 0.5);
    y.set((event.clientY - box.top) / box.height - 0.5);
  }, [x, y]);
  const reset = useCallback(() => { x.set(0); y.set(0); }, [x, y]);
  return (
    <div className={cn("mk-tilt", className)} onPointerMove={active ? onMove : undefined} onPointerLeave={active ? reset : undefined}>
      <motion.div className="mk-tilt-inner" style={active ? { rotateX: rx, rotateY: ry } : undefined}>{children}</motion.div>
    </div>
  );
}

/** A block that springs up into place the first time it enters the viewport. */
export function Rise({ children, className, delay = 0, rotate = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; rotate?: number; as?: "div" | "li" | "article" }) {
  const reduce = useReducedMotionSafe();
  const Tag = as === "li" ? motion.li : as === "article" ? motion.article : motion.div;
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: 36, rotate: rotate ? rotate * 3 : 0 }}
      whileInView={{ opacity: 1, y: 0, rotate }}
      viewport={{ once: true, margin: "-8%" }}
      transition={{ ...soft, delay }}
    >
      {children}
    </Tag>
  );
}

/** A sticker that pops on with a bouncy spring after the page loads. */
export function Sticker({ children, className, delay = 0.5 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.span
      className={cn("mk-sticker", className)}
      initial={reduce ? false : { scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ ...springy, delay }}
    >
      {children}
    </motion.span>
  );
}
