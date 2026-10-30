import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadLinksPanel } from "./upload-links-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const link = {
  id: "l1", project_id: "p1", label: "Send us your footage", instructions: "", token: "tok", path: "/upload/tok",
  due_at: null, expires_at: null, max_file_bytes: null, allowed_kinds: ["video"], status: "active",
  created_by: { id: "u1", name: "Alex", email: "alex@x" }, created_at: "2026-10-03T10:00:00Z", revoked_at: null,
  upload_count: 2, last_upload_at: null,
};
const upload = {
  id: "c1", project_id: "p1", project_file_id: "f1", folder_id: "d1", file_name: "take1.mov", mime_type: "video/quicktime",
  size_bytes: 5 * 1024 * 1024, kind: "video", status: "READY", removed: false, uploader_name: "Rachel Kim",
  uploader_email: "rachel@brand.com", via: "link", upload_link_label: "Send us your footage", batch_id: "b1", created_at: "2026-10-03T11:00:00Z",
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("UploadLinksPanel", () => {
  it("lists live links with a copyable URL and the files received with their sender", async () => {
    const fetchMock = vi.fn((url: string) => json(url.includes("upload-links") ? [link] : [upload]));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadLinksPanel workspaceId="w1" projectId="p1" projectName="Spring Launch" />);
    const row = (await screen.findByText("Send us your footage", { selector: "strong" })).closest("li")!;
    expect(within(row).getByText("Active · 2 files")).toBeInTheDocument();
    expect(within(row).getByText("Video")).toBeInTheDocument();
    expect((within(row).getByLabelText("Link for Send us your footage") as HTMLInputElement).value).toMatch(/\/upload\/tok$/);
    expect(screen.getByText("take1.mov")).toBeInTheDocument();
    expect(screen.getByText("Rachel Kim")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open folder" })).toHaveAttribute("href", "/files?folder=d1");
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/w1/projects/p1/upload-links/", expect.anything());
  });

  it("creates a link with the chosen limits", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ ...link, id: "l2", label: "Brand files", upload_count: 0 }, 201);
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadLinksPanel workspaceId="w1" projectId="p1" projectName="Spring Launch" />);
    fireEvent.click(await screen.findByRole("button", { name: "New upload link" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Brand files" } });
    fireEvent.change(screen.getByLabelText(/Max file size/), { target: { value: "500" } });
    fireEvent.click(screen.getByLabelText("Documents"));
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(screen.getByText("Brand files", { selector: "strong" })).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ label: "Brand files", max_file_bytes: 500 * 1024 * 1024, allowed_kinds: ["document"], due_at: null });
  });

  it("explains a missing permission instead of showing a form", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ detail: "nope" }, 403)));
    render(<UploadLinksPanel workspaceId="w1" projectId="p1" projectName="Spring Launch" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only people who can edit this project can create upload links.");
    expect(screen.queryByRole("button", { name: "New upload link" })).not.toBeInTheDocument();
  });
});
