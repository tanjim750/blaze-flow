import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots, { PRIVATE_PREFIXES } from "@/app/robots";
import sitemap from "@/app/sitemap";
import { marketingMetadata } from "./marketing-metadata";
import { pageTitle, publicRoutes, siteConfig } from "./site-config";

describe("siteConfig", () => {
  it("prices plans in USD with a 14-day trial, Pro matching the highlighted plan", () => {
    expect(siteConfig.pricing).toMatchObject({ currency: "USD", symbol: "$", proMonthly: 39.99, trialDays: 14 });
    expect(siteConfig.plans.find((p) => p.highlighted)?.monthly).toBe(siteConfig.pricing.proMonthly);
  });

  it("builds page titles from the brand name", () => {
    expect(pageTitle("Pricing")).toBe(`Pricing · ${siteConfig.name}`);
    expect(pageTitle()).toContain(siteConfig.name);
  });

  it("gives each page canonical, Open Graph and Twitter metadata", () => {
    const meta = marketingMetadata({ title: "Features", path: "/features" });
    expect(meta.title).toBe(`Features · ${siteConfig.name}`);
    expect(meta.alternates?.canonical).toBe("/features");
    expect(JSON.stringify(meta.openGraph)).toContain("/og.png");
    expect(JSON.stringify(meta.twitter)).toContain("/og.png");
  });
});

describe("sitemap and robots", () => {
  it("lists only the public pages", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toHaveLength(publicRoutes.length);
    for (const url of urls) expect(url.startsWith(siteConfig.url)).toBe(true);
    expect(urls.some((url) => /platform|review|files|tasks|welcome/.test(url))).toBe(false);
  });

  it("allows the public pages and keeps crawlers out of the app", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule.allow).toEqual(publicRoutes.map((route) => route.path));
    expect(rule.disallow).toEqual(PRIVATE_PREFIXES);
    for (const prefix of ["/platform", "/api/", "/review", "/files", "/welcome"]) expect(PRIVATE_PREFIXES).toContain(prefix);
    expect(robots().sitemap).toBe(`${siteConfig.url}/sitemap.xml`);
  });

  it("keeps every disallowed prefix off the public list", () => {
    for (const route of publicRoutes) {
      if (route.path === "/") continue;
      expect(PRIVATE_PREFIXES.some((prefix) => route.path.startsWith(prefix))).toBe(false);
    }
  });
});

describe("one place for the brand name", () => {
  // The product may be renamed: marketing code must read the name from siteConfig.
  const roots = [join(__dirname, "../app/(pro)"), join(__dirname, "../components/pro"), join(__dirname, "../components/marketing"), join(__dirname, "../app/og.png")];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
  it.each(roots.flatMap(files))("%s does not hard-code the product name", (path) => {
    expect(readFileSync(path, "utf8")).not.toContain(siteConfig.name);
  });
});
