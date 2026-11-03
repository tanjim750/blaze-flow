import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestReviewer } from "./reviewer";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

function review(viewer: Record<string, unknown>) {
  return JSON.stringify({
    project: { id: "p1", name: "Campaign", description: "" },
    viewer: { name: "Vee", can_decide: false, can_comment: true, can_read_comments: true, can_read_annotations: true, expires_at: null, ...viewer },
    media_versions: [{ id: "m1", title: "hero.mp4", version_number: 2, open_notes: 0, decision: null }],
  });
}

function seed() {
  localStorage.setItem("blazeflow_guest:Abc12345", JSON.stringify({ token: "Abc12345", projectId: "p1", guestSessionId: "g1", accessKey: "k", name: "Vee", expiresAt: Date.now() + 1e9 }));
}

function serve(viewer: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/guest/reviews/p1/")) return new Response(review(viewer), { status: 200 });
    if (url.includes("/playback/")) return new Response(JSON.stringify({ url: "https://cdn.test/hero.mp4" }), { status: 200 });
    if (url.includes("/decision/") && init?.method === "POST") return new Response(JSON.stringify({ id: "d1" }), { status: 201 });
    return new Response("[]", { status: 200 });
  });
}

describe("guest review: drawing and decisions", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { cleanup(); });

  it("gives a commenting link the same drawing tools as internal review", async () => {
    seed();
    serve({ can_annotate: true });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    expect(await screen.findByRole("group", { name: "Annotation tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draw arrow" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Drawing colour" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo drawing" })).toBeTruthy();
  });

  it("hides the tools when the link has comments turned off", async () => {
    seed();
    serve({ can_comment: false, can_annotate: true });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    await screen.findByTestId("guest-view-only");
    expect(screen.queryByRole("group", { name: "Annotation tools" })).toBeNull();
  });

  it("hides Approve / Request changes when the link has approvals off", async () => {
    seed();
    serve({ can_decide: false });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    await screen.findAllByText("Campaign");
    expect(screen.queryByRole("button", { name: /Request changes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("sends a change request without a note", async () => {
    seed();
    const fetchMock = serve({ can_decide: true });
    render(<GuestReviewer token="Abc12345" cut={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /Request changes/ }));
    const send = screen.getByRole("button", { name: "Send change request" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes("/decision/") && i?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/decision/") && i?.method === "POST")!;
    const body = JSON.parse(String(init?.body));
    expect(body.decision).toBe("changes_requested");
    expect(body.message).toBeUndefined();
  });
});
