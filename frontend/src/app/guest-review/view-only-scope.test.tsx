import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestReviewer } from "./reviewer";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const DENIED = JSON.stringify({ detail: "This guest link does not grant that permission." });

function review(viewer: Record<string, unknown>, versions = [{ id: "m1", title: "hero.mp4", version_number: 1, open_notes: 0, decision: null }]) {
  return JSON.stringify({
    project: { id: "p1", name: "Campaign", description: "" },
    viewer: { name: "Vee", can_decide: false, can_comment: false, expires_at: null, ...viewer },
    media_versions: versions,
  });
}

function seed() {
  localStorage.setItem("blazeflow_guest:Abc12345", JSON.stringify({ token: "Abc12345", projectId: "p1", guestSessionId: "g1", accessKey: "k", name: "Vee", expiresAt: Date.now() + 1e9 }));
}

describe("view-only guest links", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it("does not ask for notes or drawings the link cannot read, and shows no error banner", async () => {
    seed();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/guest/reviews/p1/")) return new Response(review({ can_read_comments: false, can_read_annotations: false }), { status: 200 });
      if (url.includes("/playback/")) return new Response(JSON.stringify({ detail: "preparing" }), { status: 409 });
      return new Response(DENIED, { status: 403 });
    });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    await screen.findAllByText("Campaign");
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/playback/"))).toBe(true));
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("/comments/"))).toBe(false);
    expect(urls.some((u) => u.includes("/annotations/"))).toBe(false);
    expect(screen.queryByText(/does not grant that permission/i)).toBeNull();
  });

  it("treats a permission 403 on notes quietly (links from older APIs)", async () => {
    seed();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/guest/reviews/p1/")) return new Response(review({}), { status: 200 });
      if (url.includes("/playback/")) return new Response(JSON.stringify({ detail: "preparing" }), { status: 409 });
      return new Response(DENIED, { status: 403 });
    });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    await screen.findAllByText("Campaign");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/does not grant that permission/i)).toBeNull();
  });

  it("a file-scoped link lists only the file the API returns", async () => {
    seed();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/guest/reviews/p1/")) return new Response(review({ scoped_to_file: true, can_read_comments: true }), { status: 200 });
      if (url.includes("/comments/")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ detail: "preparing" }), { status: 409 });
    });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    await screen.findAllByText("Campaign");
    expect(screen.getAllByText(/hero\.mp4/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/storyboard/)).toBeNull();
  });
});
