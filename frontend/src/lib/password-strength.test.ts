import { describe, expect, it } from "vitest";
import { passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("guides empty and short passwords", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").label).toBe("Too short");
  });
  it("flags numeric, common and personal passwords", () => {
    expect(passwordStrength("12345678901").label).toBe("Weak");
    expect(passwordStrength("mypassword99").label).toBe("Weak");
    expect(passwordStrength("adalovelace!!", ["ada"]).hint).toMatch(/name/);
  });
  it("rewards length and variety", () => {
    expect(passwordStrength("tangerine").score).toBe(2);
    expect(passwordStrength("Tangerine-Kite-42").score).toBe(4);
  });
});
