import { afterEach, describe, expect, it, vi } from "vitest";
import { announceNavigation, NAV_START_EVENT } from "./app-router";

describe("announceNavigation", () => {
  const seen = vi.fn();
  afterEach(() => { window.removeEventListener(NAV_START_EVENT, seen); seen.mockReset(); });
  it("announces a navigation to another page and ignores the current one or other origins", () => {
    window.addEventListener(NAV_START_EVENT, seen);
    announceNavigation("/tasks?x=1");
    expect(seen).toHaveBeenCalledTimes(1);
    announceNavigation(window.location.pathname + window.location.search);
    announceNavigation("https://elsewhere.example/a");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
