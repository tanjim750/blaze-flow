"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>{children}</DialogPrimitive.Root>;
}
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return <DialogPrimitive.Portal forceMount><AnimatePresence><DialogPrimitive.Overlay asChild><motion.div className="ui-dialog-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduce?0:.18}} /></DialogPrimitive.Overlay><DialogPrimitive.Content asChild><motion.section className={cn("ui-dialog-content",className)} initial={{opacity:0,y:reduce?0:18,scale:reduce?1:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reduce?0:10,scale:reduce?1:.985}} transition={{duration:reduce?0:.22,ease:[.22,1,.36,1]}}>{children}</motion.section></DialogPrimitive.Content></AnimatePresence></DialogPrimitive.Portal>;
}
export function DialogClose(){return <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close dialog"><X/></DialogPrimitive.Close>}
