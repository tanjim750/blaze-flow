import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFinePointer, useLiteMotion, useReducedMotionSafe } from "./motion-prefs";

function mockMedia(matching: string[]) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matching.some((m) => query.includes(m)), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

describe("marketing motion budget", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs full motion on a large screen with a mouse and decent hardware", () => {
    mockMedia(["pointer: fine"]);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    expect(renderHook(() => useLiteMotion()).result.current).toBe(false);
    expect(renderHook(() => useFinePointer()).result.current).toBe(true);
  });

  it("goes lite on small screens", () => {
    mockMedia(["max-width: 699px"]);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    expect(renderHook(() => useLiteMotion()).result.current).toBe(true);
  });

  it("goes lite on low-power devices and for data saver", () => {
    mockMedia([]);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 2 });
    expect(renderHook(() => useLiteMotion()).result.current).toBe(true);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8, connection: { saveData: true } });
    expect(renderHook(() => useLiteMotion()).result.current).toBe(true);
  });

  it("treats prefers-reduced-motion as lite, and reports it", () => {
    mockMedia(["prefers-reduced-motion: reduce"]);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    expect(renderHook(() => useReducedMotionSafe()).result.current).toBe(true);
    expect(renderHook(() => useLiteMotion()).result.current).toBe(true);
  });
});
