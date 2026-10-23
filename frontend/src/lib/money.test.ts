import { describe, expect, it } from "vitest";
import { formatMoney, fromMinor, parseMoneyInput, percentOf, subtractMoney, sumMoney, toMinor } from "./money";

describe("money arithmetic", () => {
  it("works in minor units so decimals add up exactly", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["1000", "250.00", 150, null, undefined, ""])).toBe("1400.00");
    expect(subtractMoney("1400.00", "400")).toBe("1000.00");
    expect(subtractMoney("10", "12.5")).toBe("-2.50");
    expect(toMinor("1,250.505")).toBe(125051);
    expect(toMinor("nonsense")).toBe(0);
    expect(fromMinor(5)).toBe("0.05");
  });
  it("computes a percentage share", () => {
    expect(percentOf("979.50", "1400")).toBe(70);
    expect(percentOf("1", "3")).toBe(33.3);
    expect(percentOf("5", "0")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with Intl in the given currency", () => {
    expect(formatMoney("1250.5", "GBP")).toBe("£1,250.50");
    expect(formatMoney(1250, "USD")).toBe("US$1,250.00");
    expect(formatMoney("1250", "EUR", { locale: "de-DE" })).toBe("1.250,00\u00a0€");
    expect(formatMoney("-20", "GBP")).toBe("-£20.00");
  });
  it("drops zero pence only when asked", () => {
    expect(formatMoney("8330.00", "GBP", { whole: true })).toBe("£8,330");
    expect(formatMoney("8330.40", "GBP", { whole: true })).toBe("£8,330.40");
  });
  it("renders a dash for no amount and never throws on a bad code", () => {
    expect(formatMoney(null, "GBP")).toBe("—");
    expect(formatMoney("", "GBP")).toBe("—");
    expect(() => formatMoney("10", "NOT-A-CODE")).not.toThrow();
    expect(formatMoney("10", "NOT-A-CODE")).toContain("10.00");
  });
});

describe("parseMoneyInput", () => {
  it("accepts typed amounts and clears on blank", () => {
    expect(parseMoneyInput("£1,250")).toEqual({ amount: "1250.00" });
    expect(parseMoneyInput(" 99.5 ")).toEqual({ amount: "99.50" });
    expect(parseMoneyInput("")).toEqual({ amount: null });
  });
  it("rejects negatives, extra decimals and words", () => {
    for (const bad of ["-5", "1.234", "ten", "1.2.3"]) expect(parseMoneyInput(bad)).toHaveProperty("error");
  });
});
