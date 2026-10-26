import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
  headers: async () => new Headers(),
}));

import { request } from "./api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("request (B8 resilience)", () => {
  it("retries a read once when the API is briefly unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(503, { detail: "briefly unavailable" })).mockResolvedValueOnce(json(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await request<{ id: string }>("/auth/me/");
    expect(result).toEqual({ ok: true, data: { id: "u1" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network error, then reports status 0", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await request("/workspaces/");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a write or a real error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(503));
    vi.stubGlobal("fetch", fetchMock);
    await request("/projects/", { method: "POST", body: "{}" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear().mockResolvedValue(json(500));
    await request("/projects/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
