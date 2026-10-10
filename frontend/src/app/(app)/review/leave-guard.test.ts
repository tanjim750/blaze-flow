import { describe, expect, it } from "vitest";
import { shouldIntercept } from "./leave-guard";

const here = new URL("http://localhost:3000/review?media=a") as unknown as Location;
const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, attrs: Record<string, string> = {}) => {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value);
  // jsdom resolves `href` against its own location, so pin it to the review page.
  Object.defineProperty(anchor, "href", { value: new URL(href, here.href).href });
  return anchor;
};

describe("leave guard", () => {
  it("catches in-app navigation away from this cut", () => {
    expect(shouldIntercept(link("/files"), click, here)).toBe(true);
    expect(shouldIntercept(link("/review?media=b"), click, here)).toBe(true);
    expect(shouldIntercept(link("/projects", { target: "_top" }), click, here)).toBe(true);
  });

  it("lets downloads, new tabs, other sites and same-page links through", () => {
    expect(shouldIntercept(link("/api/workspaces/w/asset-files/f/download/", { download: "" }), click, here)).toBe(false);
    expect(shouldIntercept(link("/api/x/attachments/1/"), click, here)).toBe(false);
    expect(shouldIntercept(link("/files", { target: "_blank" }), click, here)).toBe(false);
    expect(shouldIntercept(link("/files"), { ...click, metaKey: true }, here)).toBe(false);
    expect(shouldIntercept(link("https://example.com/"), click, here)).toBe(false);
    expect(shouldIntercept(link("/review?media=a"), click, here)).toBe(false);
    expect(shouldIntercept(link("#notes"), click, here)).toBe(false);
  });
});
