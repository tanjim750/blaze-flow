import { describe, expect, it } from "vitest";
import { accountName, accountTitle } from "./user";

describe("account title", () => {
  it("uses the first name, or the email handle", () => {
    expect(accountName({ first_name: "Shamim", last_name: "R", email: "s@x.co" })).toBe("Shamim");
    expect(accountName({ first_name: " ", last_name: "", email: "sam.k@x.co" })).toBe("sam.k");
  });
  it("adds 's, or a bare apostrophe after a trailing s", () => {
    expect(accountTitle("Shamim")).toBe("Shamim's account");
    expect(accountTitle("James")).toBe("James' account");
    expect(accountTitle("")).toBe("Your account");
  });
});
