/**
 * Theme preference (Dark / Light / System).
 *
 * The choice is stored in localStorage and mirrored to a cookie, and applied as a `dark` or
 * `light` class on <html> (plus `color-scheme`, so native inputs and scrollbars match).
 * `THEME_INIT_SCRIPT` runs inline in <head> before first paint, so a page never flashes
 * the wrong theme; "system" follows `prefers-color-scheme` live.
 */
export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "krewsys-theme";
export const THEME_COOKIE = "krewsys-theme";
export const THEME_EVENT = "krewsys-theme-change";
export const DEFAULT_THEME: ThemePreference = "system";
export const THEME_OPTIONS: readonly ThemePreference[] = ["dark", "light", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(THEME_STORAGE_KEY); } catch { /* storage blocked */ }
  if (isThemePreference(stored)) return stored;
  const cookie = readCookie();
  return isThemePreference(cookie) ? cookie : DEFAULT_THEME;
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  root.dataset.themePreference = preference;
  return resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* storage blocked */ }
  document.cookie = `${THEME_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: preference }));
}

/** Inline, dependency-free copy of `readThemePreference` + `applyTheme` for <head>. */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},p=null;try{p=localStorage.getItem(k)}catch(e){}if(p!=="dark"&&p!=="light"&&p!=="system"){var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);p=m?m[1]:"system"}if(p!=="dark"&&p!=="light"&&p!=="system")p="system";var r=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;var d=document.documentElement;d.classList.remove("dark","light");d.classList.add(r);d.style.colorScheme=r;d.dataset.themePreference=p}catch(e){}})();`;
