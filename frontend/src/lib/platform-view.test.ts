import { describe, expect, it } from "vitest";
import { chartMax, formatBytes, formatMoney, parseRange, percent, planLabel, query, relativeTime, share } from "./platform-view";

describe("platform view helpers", () => {
  it("formats GBP MRR from minor units", () => {
    expect(formatMoney(2900 * 3)).toBe("£87");
    expect(formatMoney(2950)).toBe("£29.50");
  });
  it("formats rates and shares", () => {
    expect(percent(0.1234)).toBe("12.3%");
    expect(percent(null)).toBe("—");
    expect(share(3, 12)).toBe(25);
    expect(share(1, 0)).toBe(0);
  });
  it("only accepts known ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("12")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
  it("builds tidy queries", () => {
    expect(query({ q: "a b", empty: "", none: null, offset: 0 })).toBe("?q=a+b&offset=0");
    expect(query({})).toBe("");
  });
  it("describes relative time", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(relativeTime("2026-10-11T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-11T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime(null, now)).toBe("never");
  });
  it("labels plans including trials", () => {
    expect(planLabel(null)).toBe("FREE");
    expect(planLabel({ plan: "PRO", status: "TRIALING", trial_ends_at: null, current_period_end: null, cancel_at_period_end: false })).toBe("PRO trial");
    expect(planLabel({ plan: "PRO", status: "PAST_DUE", trial_ends_at: null, current_period_end: null, cancel_at_period_end: false })).toBe("PRO · past due");
  });
  it("never divides a chart by zero", () => {
    expect(chartMax([0, 0])).toBe(1);
    expect(chartMax([2, 5])).toBe(5);
  });
});
