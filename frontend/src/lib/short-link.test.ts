import { describe, expect, it } from "vitest";
import { isShortCode, shortLinkHost } from "./short-link";

describe("short links", () => {
  it("recognises 8-character base62 codes only", () => {
    expect(isShortCode("Z70ayQFE")).toBe(true);
    expect(isShortCode("Z70ayQF")).toBe(false);
    expect(isShortCode("Z70ayQF-")).toBe(false);
    expect(isShortCode("x".repeat(43))).toBe(false);
  });

  it("only treats a path-less base URL as a short-link domain", () => {
    expect(shortLinkHost("https://xyz.io")).toBe("xyz.io");
    expect(shortLinkHost("https://XYZ.io/")).toBe("xyz.io");
    expect(shortLinkHost("https://krewsys.com/r")).toBeNull();
    expect(shortLinkHost("")).toBeNull();
    expect(shortLinkHost("not a url")).toBeNull();
  });
});
