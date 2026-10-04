import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectThread } from "./thread";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const viewer = { kind: "team", channels: ["client", "team"], can_post: true, can_link_files: true, can_link_cuts: true, has_client: true };
const message = (id: string, body: string, extra: Record<string, unknown> = {}) => ({
  id, channel: "client", author: { id: "u2", name: "Sam Lee", is_client: true }, body, mentions: [], reply_to: null, attachments: [],
  mine: false, can_edit: false, edited_at: null, deleted: false, created_at: "2026-10-04T10:00:00Z", ...extra,
});
const thread = (overrides: Record<string, unknown> = {}) => ({
  project: { id: "p1", name: "Spring Launch" }, channel: "client", viewer, messages: [message("m1", "Can the logo be bigger?")],
  changed: [], has_more: false, unread: { client: 0, team: 2 }, server_time: "2026-10-04T10:05:00Z",
  mentionable: [{ id: "u1", name: "Alex Morgan", is_client: false }, { id: "u3", name: "Maya Chen", is_client: false }], ...overrides,
});

describe("ProjectThread", () => {
  it("shows the shared channel with client badges and the team channel's unread count", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(thread())));
    render(<ProjectThread workspaceId="w1" projectId="p1" />);
    expect(await screen.findByText("Can the logo be bigger?")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Team only/ })).toHaveTextContent("2");
    expect(screen.getByText(/Shared with the client/)).toBeInTheDocument();
  });

  it("labels the team channel clearly", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => json(thread(url.includes("channel=team") ? { channel: "team", messages: [] } : {}))));
    render(<ProjectThread workspaceId="w1" projectId="p1" initialChannel="team" />);
    expect(await screen.findByText(/Clients never see this channel/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to team/ })).toBeInTheDocument();
  });

  it("sends a reply with the mention that survived editing", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/messages/")) return json(message("m2", "@Maya Chen yes", { mentions: ["u3"], author: { id: "u1", name: "Alex Morgan", is_client: false }, mine: true, can_edit: true, created_at: "2026-10-04T10:06:00Z" }), 201);
      return json(thread());
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectThread workspaceId="w1" projectId="p1" />);
    await screen.findByText("Can the logo be bigger?");
    fireEvent.click(screen.getByRole("button", { name: "Reply to Sam Lee" }));
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "@Ma", selectionStart: 3 } });
    fireEvent.mouseDown(await screen.findByRole("button", { name: /Maya Chen/ }));
    fireEvent.change(box, { target: { value: "@Maya Chen yes", selectionStart: 14 } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("@Maya Chen")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([url, init]) => init?.method === "POST" && String(url).endsWith("/messages/"))!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ channel: "client", body: "@Maya Chen yes", reply_to_id: "m1", mention_user_ids: ["u3"] });
  });

  it("lets read-only members read but not post", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(thread({ viewer: { ...viewer, can_post: false } }))));
    render(<ProjectThread workspaceId="w1" projectId="p1" />);
    expect(await screen.findByText(/Your role doesn.t include posting/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reply to/ })).not.toBeInTheDocument();
  });

  it("offers edit and delete on your own messages and shows a deleted one as such", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return json(thread({ messages: [message("m1", "mine", { mine: true, can_edit: true })] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectThread workspaceId="w1" projectId="p1" />);
    await screen.findByText("mine");
    fireEvent.click(screen.getByRole("button", { name: "Delete message" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Message deleted")).toBeInTheDocument();
  });

  it("portal variant only shows the shared channel", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(thread({ viewer: { ...viewer, kind: "client", channels: ["client"] }, unread: { client: 0 } }))));
    render(<ProjectThread workspaceId="w1" projectId="p1" variant="portal" />);
    await screen.findByText("Can the logo be bigger?");
    expect(screen.queryByRole("tab", { name: /Team only/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Clients never see/)).not.toBeInTheDocument();
  });
});
