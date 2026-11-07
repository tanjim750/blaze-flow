import { describe, expect, it } from "vitest";
import { invoiceTotals } from "@/lib/money-view";
import { editPayload } from "./invoice-view";

const draft = (over = {}) => ({ lines: [{ key: "a", id: "a", kind: "project_fee" as const, description: "Fee", amount: "1000" }, { key: "n", kind: "manual" as const, description: "Rush", amount: "50.5" }], discount: "50", taxRate: "20", dueDate: "2026-12-01", notes: "Thanks", ...over });

describe("draft invoice editor", () => {
  it("matches the API's totals: lines, less discount, plus tax", () => {
    expect(invoiceTotals([{ amount: "1000" }, { amount: "50.50" }], "50", "20")).toEqual({ subtotal: 105050, discount: 5000, tax: 20010, total: 120060 });
    expect(invoiceTotals([{ amount: "10" }], "999", "0").total).toBe(0);
  });
  it("sends existing line ids, new lines without one, and normalised amounts", () => {
    expect(editPayload(draft())).toEqual({ edit: { lines: [{ id: "a", description: "Fee", amount: "1000.00" }, { description: "Rush", amount: "50.50" }], discount_amount: "50.00", tax_rate: "20", due_date: "2026-12-01", notes: "Thanks" } });
  });
  it("refuses blank descriptions, bad amounts and silly tax rates", () => {
    expect(editPayload(draft({ lines: [{ key: "x", kind: "manual", description: " ", amount: "1" }] }))).toEqual({ error: "Every line needs a description." });
    expect("error" in editPayload(draft({ taxRate: "150" }))).toBe(true);
    expect("error" in editPayload(draft({ discount: "lots" }))).toBe(true);
  });
});
