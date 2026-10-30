"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "@/components/icons";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>{children}</DialogPrimitive.Root>;
}
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  // CSS enter/exit keyed on Radix's data-state (globals.css): Radix keeps the node mounted
  // until the exit animation ends, so this matches the old motion version without shipping
  // the animation library in every page's first load.
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="ui-dialog-overlay" /><DialogPrimitive.Content asChild><section className={cn("ui-dialog-content", className)}>{children}</section></DialogPrimitive.Content></DialogPrimitive.Portal>;
}
export function DialogClose(){return <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close dialog"><X/></DialogPrimitive.Close>}
