import { describe, expect, it } from "vitest";
import { trackDownload, cancelAllDownloads, getDownloads } from "./download-store";
describe("folder download tracking", () => {
  it("cancels every page-managed download with one action and releases completed entries", () => {
    const a = trackDownload("A"), b = trackDownload("B");
    expect(getDownloads()).toHaveLength(2);
    cancelAllDownloads(); expect(a.signal.aborted).toBe(true); expect(b.signal.aborted).toBe(true);
    a.finish(); b.finish(); expect(getDownloads()).toHaveLength(0);
  });
});
