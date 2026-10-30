import { describe, expect, it, vi } from "vitest";
import { dedupe, invalidate } from "./dedupe";

describe("dedupe", () => {
  it("shares one request between callers inside the ttl", async () => {
    const load = vi.fn(async () => ({ ok: true, n: 1 }));
    let t = 0; const now = () => t;
    const [a, b] = await Promise.all([dedupe("k1", 5000, load, now), dedupe("k1", 5000, load, now)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    t = 6000;
    await dedupe("k1", 5000, load, now);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache failures and can be invalidated", async () => {
    const fail = vi.fn(async () => ({ ok: false }));
    await dedupe("k2", 5000, fail); await dedupe("k2", 5000, fail);
    expect(fail).toHaveBeenCalledTimes(2);
    const ok = vi.fn(async () => ({ ok: true }));
    await dedupe("u:1", 5000, ok); invalidate("u:"); await dedupe("u:1", 5000, ok);
    expect(ok).toHaveBeenCalledTimes(2);
  });
});
