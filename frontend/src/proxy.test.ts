// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, MARKETING_HOME, proxy, SESSION_COOKIE } from "./proxy";

const request = (cookie?: string) =>
  new NextRequest("http://localhost:3000/", { headers: cookie ? { cookie } : {} });

describe("proxy: who sees what at /", () => {
  it("rewrites signed-out visitors to the marketing homepage, keeping the URL", () => {
    const response = proxy(request());
    expect(response.headers.get("x-middleware-rewrite")).toBe(`http://localhost:3000${MARKETING_HOME}`);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets anyone with a session cookie through to their dashboard", () => {
    const response = proxy(request(`${SESSION_COOKIE}=abc123; csrftoken=x`));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("ignores unrelated cookies", () => {
    expect(proxy(request("csrftoken=x; blazeflow_rail=1")).headers.get("x-middleware-rewrite")).toContain(MARKETING_HOME);
  });

  it("only runs on the root path and bare 8-character paths, never on /platform or the API", () => {
    expect(config.matcher).toEqual(["/", "/:code([A-Za-z0-9]{8})"]);
  });
});

describe("proxy: short-link domain", () => {
  const at = (url: string) => new NextRequest(url, { headers: { host: new URL(url).host } });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("rewrites /<code> on the short domain to /r/<code>, keeping the short URL", () => {
    vi.stubEnv("SHORT_LINK_BASE_URL", "https://xyz.io");
    const response = proxy(at("https://xyz.io/Z70ayQFE"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://xyz.io/r/Z70ayQFE");
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves 8-letter app routes alone on the main domain", () => {
    vi.stubEnv("SHORT_LINK_BASE_URL", "https://xyz.io");
    const response = proxy(at("https://krewsys.com/projects"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does nothing with the default base URL, which is served by /r/[code]", () => {
    vi.stubEnv("SHORT_LINK_BASE_URL", "");
    expect(proxy(at("https://krewsys.com/Z70ayQFE")).headers.get("x-middleware-rewrite")).toBeNull();
  });
});
