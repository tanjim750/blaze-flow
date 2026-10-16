/*
 * From Skiper UI (free tier), added with `npx shadcn add @skiper-ui/skiper58`.
 *
 * Local changes, kept deliberately small so a re-add is easy to diff:
 *  - the vendor demo export was dropped; it rendered Skiper UI's own marketing page
 *  - imports `motion/react`, the package this app already uses, rather than
 *    pulling in `framer-motion` as a second copy of the same library
 *  - the per-character spans are hidden from assistive tech behind a single
 *    aria-label, so the word is announced once instead of letter by letter
 */
"use client";

import { motion } from "motion/react";
import React from "react";

import { cn } from "@/lib/utils";

const STAGGER = 0.035;

const TextRoll: React.FC<{
  children: string;
  className?: string;
  center?: boolean;
}> = ({ children, className, center = false }) => {
  return (
    <motion.span
      initial="initial"
      whileHover="hovered"
      className={cn("relative block overflow-hidden", className)}
      style={{
        lineHeight: 0.75,
      }}
      // The effect needs one span per character, which assistive tech would otherwise
      // announce letter by letter. Label the whole word and hide the pieces.
      aria-label={children}
      role="text"
    >
      <div aria-hidden="true">
        {children.split("").map((l, i) => {
          const delay = center
            ? STAGGER * Math.abs(i - (children.length - 1) / 2)
            : STAGGER * i;

          return (
            <motion.span
              variants={{
                initial: {
                  y: 0,
                },
                hovered: {
                  y: "-100%",
                },
              }}
              transition={{
                ease: "easeInOut",
                delay,
              }}
              className="inline-block"
              key={i}
            >
              {l}
            </motion.span>
          );
        })}
      </div>
      <div className="absolute inset-0" aria-hidden="true">
        {children.split("").map((l, i) => {
          const delay = center
            ? STAGGER * Math.abs(i - (children.length - 1) / 2)
            : STAGGER * i;

          return (
            <motion.span
              variants={{
                initial: {
                  y: "100%",
                },
                hovered: {
                  y: 0,
                },
              }}
              transition={{
                ease: "easeInOut",
                delay,
              }}
              className="inline-block"
              key={i}
            >
              {l}
            </motion.span>
          );
        })}
      </div>
    </motion.span>
  );
};

export { TextRoll };
