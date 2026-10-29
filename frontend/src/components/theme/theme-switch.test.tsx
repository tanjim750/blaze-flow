import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitch } from "./theme-switch";

describe("ThemeSwitch", () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear(); document.documentElement.className = "";
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  });

  it("renders a radiogroup with System selected by default", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /system/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("selecting Light persists and applies the theme", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: /light/i }));
    expect(localStorage.getItem("krewsys-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(screen.getByRole("radio", { name: /light/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("arrow keys move the selection", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("radio", { name: /dark/i }));
    fireEvent.keyDown(screen.getByRole("radio", { name: /dark/i }), { key: "ArrowRight" });
    expect(localStorage.getItem("krewsys-theme")).toBe("light");
  });
});
