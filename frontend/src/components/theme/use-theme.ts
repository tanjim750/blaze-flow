"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { applyTheme, readThemePreference, resolveTheme, setThemePreference, THEME_EVENT, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const onStorage = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY) { applyTheme(readThemePreference()); onChange(); } };
  const onSystem = () => { if (readThemePreference() === "system") applyTheme("system"); onChange(); };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media?.addEventListener?.("change", onSystem);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener?.("change", onSystem);
  };
}

/** The saved preference and the theme it resolves to; `setTheme` saves and applies. */
export function useTheme(): { theme: ThemePreference; resolvedTheme: ResolvedTheme; setTheme: (theme: ThemePreference) => void } {
  const theme = useSyncExternalStore(subscribe, readThemePreference, () => "system" as ThemePreference);
  const resolvedTheme = useSyncExternalStore(subscribe, () => resolveTheme(readThemePreference()), () => "dark" as ResolvedTheme);
  const setTheme = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return { theme, resolvedTheme, setTheme };
}

/** Mounted once at the root: keeps <html> in sync with the OS while on "System". */
export function ThemeSync() {
  useTheme();
  useEffect(() => { applyTheme(readThemePreference()); }, []);
  return null;
}
