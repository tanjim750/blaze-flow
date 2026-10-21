// @vitest-environment node
import { describe, expect, it } from "vitest";
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

  it("only ever runs on the root path, never on app routes, /platform or the API", () => {
    expect(config.matcher).toBe("/");
  });
});
