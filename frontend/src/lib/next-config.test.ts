import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config proxy", () => {
  it("lets slow upload /complete calls finish instead of hanging up at 30s", () => {
    expect(nextConfig.experimental?.proxyTimeout).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});
