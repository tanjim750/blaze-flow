import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageTransition } from "./page-transition";

const animate = vi.fn(() => ({ cancel: vi.fn() }));

beforeEach(() => {
  animate.mockClear();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [] });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
});
afterEach(() => vi.restoreAllMocks());

const flush = () => act(async () => { await Promise.resolve(); });

describe("PageTransition", () => {
  it("does not animate the first, server-rendered paint", () => {
    render(<PageTransition routeKey="/">home</PageTransition>);
    expect(animate).not.toHaveBeenCalled();
  });

  it("plays once per pathname and never on a re-render of the same route", async () => {
    const view = render(<PageTransition routeKey="/">home</PageTransition>);
    view.rerender(<PageTransition routeKey="/tasks">tasks</PageTransition>);
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
    view.rerender(<PageTransition routeKey="/tasks">tasks, filtered</PageTransition>);
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("leaves a skeleton alone and animates the page that replaces it", async () => {
    const view = render(<PageTransition routeKey="/">home</PageTransition>);
    view.rerender(<PageTransition routeKey="/files"><div className="sk-body" /></PageTransition>);
    await flush();
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<PageTransition routeKey="/files"><div>files</div></PageTransition>);
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("skips the entrance under prefers-reduced-motion", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const view = render(<PageTransition routeKey="/">home</PageTransition>);
    view.rerender(<PageTransition routeKey="/tasks">tasks</PageTransition>);
    await flush();
    expect(animate).not.toHaveBeenCalled();
  });

  it("never animates the shell: it renders only the content <main>", () => {
    const view = render(<PageTransition routeKey="/" className="flush">x</PageTransition>);
    expect(view.container.firstElementChild?.tagName).toBe("MAIN");
    expect(view.container.firstElementChild?.className).toBe("flush");
  });
});
