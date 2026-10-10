import { describe, expect, it } from "vitest";
import { mobileTitle } from "./mobile-title";

describe("mobileTitle", () => {
  it("names main pages", () => {
    expect(mobileTitle("/")).toBe("Home");
    expect(mobileTitle("/tasks")).toBe("Tasks");
    expect(mobileTitle("/money/invoices/x")).toBe("Money");
    expect(mobileTitle("/portal/projects/abc")).toBe("Project");
    expect(mobileTitle("/portal")).toBe("Portal");
  });
  it("does not match a prefix of another word", () => {
    expect(mobileTitle("/filesystem")).toBe("Blaze Flow");
  });
});
