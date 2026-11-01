import { describe, expect, it } from "vitest";
import { invoiceNumberPreview, invoiceSettingsError } from "./studio-settings";

describe("invoice settings validation", () => {
  const ok = { currency: "gbp", payment_terms_days: "30", invoice_prefix: "ACME" };
  it("accepts valid values", () => expect(invoiceSettingsError(ok)).toBeNull());
  it("rejects bad currency, terms and prefix", () => {
    expect(invoiceSettingsError({ ...ok, currency: "£" })).toMatch(/currency such as/);
    expect(invoiceSettingsError({ ...ok, payment_terms_days: "400" })).toMatch(/0–365/);
    expect(invoiceSettingsError({ ...ok, payment_terms_days: "1.5" })).toMatch(/whole/);
    expect(invoiceSettingsError({ ...ok, invoice_prefix: "  " })).toMatch(/prefix/);
  });
  it("previews the number format", () => {
    expect(invoiceNumberPreview("ACME")).toBe("ACME-0001");
    expect(invoiceNumberPreview("")).toBe("INV-0001");
  });
});
