import { describe, expect, it } from "vitest";
import { currencyChip, currencyCodes, currencyInfo, currencyOptions } from "./currencies";
import { formatMoney, parseMoneyInput } from "./money";

describe("workspace currency formatting", () => {
  it("uses each currency's own symbol and minor units", () => {
    expect(formatMoney("1250.5", "USD")).toBe("US$1,250.50");
    expect(formatMoney("1250.5", "EUR")).toBe("€1,250.50");
    expect(formatMoney(1250, "JPY")).toBe("JP¥1,250");
    expect(formatMoney("1250.5", "BDT")).toBe("৳1,250.50");
    expect(formatMoney("1250.5", "PHP")).toBe("₱1,250.50");
    expect(formatMoney("1250.5", "INR")).toBe("₹1,250.50");
    expect(formatMoney("10", "KWD")).toMatch(/^KWD\s10\.000$/);
  });
  it("knows code, name, symbol and decimals", () => {
    expect(currencyInfo("bdt")).toEqual({ code: "BDT", name: "Bangladeshi Taka", symbol: "৳", digits: 2 });
    expect(currencyInfo("JPY").digits).toBe(0);
    expect(currencyChip("BDT")).toBe("BDT · ৳");
    expect(currencyCodes()).toEqual(expect.arrayContaining(["GBP", "USD", "EUR", "BDT", "PHP", "INR", "JPY"]));
  });
  it("labels options so search matches a name such as peso", () => {
    const php = currencyOptions().find((o) => o.value === "PHP");
    expect(php?.label).toBe("PHP — Philippine Peso (₱)");
  });
  it("parses amounts typed with any currency sign or code", () => {
    expect(parseMoneyInput("৳1,250")).toEqual({ amount: "1250.00" });
    expect(parseMoneyInput("BDT 99.5")).toEqual({ amount: "99.50" });
    expect(parseMoneyInput("₱ 10")).toEqual({ amount: "10.00" });
    expect(parseMoneyInput("ten")).toHaveProperty("error");
  });
});
