"use client";
/**
 * The one sonner toaster for the signed-in app, mounted in `app/(app)/layout.tsx` so every
 * screen (Tasks board, Files panel, …) can call `toast()` from "sonner". Follows the Dark/Light
 * theme; styles in `app-toaster.css`. Do not mount a second `<Toaster>` anywhere
 * else in the app group, or every toast shows twice.
 */
import { Toaster } from "sonner";
import "./app-toaster.css";
import { useTheme } from "@/components/theme/use-theme";

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} position="bottom-right" closeButton toastOptions={{ className: "bf-toast" }} />;
}
