import { afterEach, expect, it, vi } from "vitest";
import { downloadGuestAttachment } from "./guest-client";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("authorizes a small signed-link request, then lets the browser download without fetching a Blob", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ url: "https://r2.example/signed" })));
  vi.stubGlobal("fetch", fetcher);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  expect(await downloadGuestAttachment("p", "a", "test-key", "a.pdf")).toBe("https://r2.example/signed");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toContain("?download_link=1");
  expect(click).toHaveBeenCalledOnce();
});
