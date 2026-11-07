import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoGrow } from "./comments";

const css = readFileSync(join(__dirname, "review.css"), "utf8");
const rule = (selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`, "m"));
  expect(at, `${selector} rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("comment composer overflow", () => {
  it("pins the composer column to the panel width", () => {
    expect(rule(".rv-panel .rvc-composer")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
  it("breaks long unbroken words and scrolls past the max height", () => {
    const textarea = rule(".rv-panel .rvc-composer .rvc-line textarea");
    expect(textarea).toMatch(/overflow-wrap:\s*anywhere/);
    expect(textarea).toMatch(/max-height:\s*140px/);
    expect(textarea).toMatch(/overflow-y:\s*auto/);
    expect(textarea).toMatch(/min-width:\s*0/);
  });
  it("never lets the timecode or send button shrink away", () => {
    expect(rule(".rvc-line-tools")).toMatch(/flex:\s*none/);
    expect(rule(".rvc-send-btn")).toMatch(/flex:\s*none/);
  });
  it("auto-grows a textarea up to its max height", () => {
    const el = document.createElement("textarea");
    el.style.maxHeight = "140px";
    document.body.appendChild(el);
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 60 });
    autoGrow(el);
    expect(el.style.height).toBe("60px");
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 900 });
    autoGrow(el);
    expect(el.style.height).toBe("140px");
  });
});
