"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: { primary: "ui-button-primary", secondary: "ui-button-secondary", ghost: "ui-button-ghost", danger: "ui-button-danger" },
    size: { sm: "ui-button-sm", md: "ui-button-md", icon: "ui-button-icon" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

export function Button({ className, variant, size, asChild, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
