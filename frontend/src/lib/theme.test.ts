import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_INIT_SCRIPT, applyTheme, readThemePreference, resolveTheme, setThemePreference } from "./theme";

function mockSystem(light: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("light") ? light : !light, media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

describe("theme", () => {
  beforeEach(() => { localStorage.clear(); document.cookie = "krewsys-theme=; max-age=0; path=/"; document.documentElement.className = ""; mockSystem(false); });
  afterEach(() => vi.restoreAllMocks());

  it("defaults to system", () => { expect(readThemePreference()).toBe("system"); });

  it("resolves system from prefers-color-scheme", () => {
    mockSystem(true); expect(resolveTheme("system")).toBe("light");
    mockSystem(false); expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("persists to localStorage and cookie, applies class and color-scheme, and notifies", () => {
    const spy = vi.fn(); window.addEventListener("krewsys-theme-change", spy);
    setThemePreference("light");
    expect(localStorage.getItem("krewsys-theme")).toBe("light");
    expect(document.cookie).toContain("krewsys-theme=light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(spy).toHaveBeenCalled();
    expect(readThemePreference()).toBe("light");
  });

  it("applyTheme switches back to dark", () => {
    applyTheme("light"); expect(applyTheme("dark")).toBe("dark");
    expect(document.documentElement.className).toBe("dark");
  });

  it("init script falls back to the cookie and ignores junk", () => {
    document.cookie = "krewsys-theme=light; path=/";
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    localStorage.setItem("krewsys-theme", "neon"); document.cookie = "krewsys-theme=; max-age=0; path=/";
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });
});
