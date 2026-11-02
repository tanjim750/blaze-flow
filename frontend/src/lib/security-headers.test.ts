import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "./security-headers";

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value;

describe("securityHeaders", () => {
  it("sends the hardening headers in production", () => {
    const h = securityHeaders({ NODE_ENV: "production" });
    expect(get(h, "X-Frame-Options")).toBe("SAMEORIGIN");
    expect(get(h, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(h, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(h, "Permissions-Policy")).toContain("camera=()");
    expect(get(h, "Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    const csp = get(h, "Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("honours HSTS_MAX_AGE and extra connect origins", () => {
    const h = securityHeaders({ NODE_ENV: "production", HSTS_MAX_AGE: "3600", CSP_EXTRA_CONNECT_SRC: "https://o1.ingest.sentry.io" });
    expect(get(h, "Strict-Transport-Security")).toBe("max-age=3600; includeSubDomains");
    expect(get(h, "Content-Security-Policy")).toContain("https://o1.ingest.sentry.io");
  });
  it("skips HSTS and allows eval for the dev server", () => {
    const h = securityHeaders({ NODE_ENV: "development" });
    expect(get(h, "Strict-Transport-Security")).toBeUndefined();
    expect(buildCsp({ dev: true })).toContain("'unsafe-eval'");
  });
});
