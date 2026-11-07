import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __test, startUpload, type Transport, type UploadResult } from "@/lib/upload-store";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { UploadRefresh, REFRESH_DEBOUNCE_MS } from "./upload-refresh";

let resolvers: ((result: UploadResult) => void)[] = [];
const transport: Transport = () => new Promise((resolve) => { resolvers.push(resolve); });

beforeEach(() => { __test.reset(); resolvers = []; refresh.mockReset(); __test.setTransport(transport); });

describe("UploadRefresh", () => {
  it("refreshes the route once when uploads land, so the new file appears without a reload", async () => {
    vi.useFakeTimers();
    try {
      render(<UploadRefresh />);
      act(() => { startUpload({ url: "/u", file: new File(["a"], "a.mp4"), source: "files" }); startUpload({ url: "/u", file: new File(["b"], "b.mp4"), source: "files" }); });
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => { resolvers.forEach((r) => r({ ok: true, data: {} })); });
      await act(async () => { vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS + 10); });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
