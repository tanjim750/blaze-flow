import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TasksView } from "@/lib/tasks-view";
import { TasksBoard } from "./board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
const tracked = vi.fn();
vi.mock("@/lib/asset-api-client", async (load) => ({
  ...(await load<typeof import("@/lib/asset-api-client")>()),
  uploadAssetFileTracked: (...args: unknown[]) => tracked(...args),
}));

const view = {
  workspaceId: "workspace", notice: null, clients: [], members: [], files: [],
  projects: [{ id: "project", workspace_id: "workspace", client_team_id: null, name: "parasym november", description: null, status: "ACTIVE", priority: "HIGH", start_at: null, due_at: null, created_at: "2026-11-04", updated_at: "2026-11-04" }],
  stages: [{ id: "review", name: "Review", color: "#67b0f9", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: false, task_count: 1 }],
  workflowSettings: { wip_warning: true, auto_notify_client: true, lock_done_editing: true },
  tasks: [{ id: "task", workspace_id: "workspace", client_team_id: null, project_id: "project", task_stage_id: "review", title: "Cut Special Creative", description: null, status: "TODO", priority: "HIGH", start_at: null, due_at: null, completed_at: null, sort_order: 0, created_at: "2026-11-04", updated_at: "2026-11-04", assignees: [] }],
} satisfies TasksView;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); tracked.mockReset(); });

describe("task drawer upload", () => {
  it("sends through the upload tray and frees the button when the upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })));
    tracked.mockRejectedValueOnce(new Error("The upload was interrupted."));
    render(<TasksBoard view={view} />);
    fireEvent.click(screen.getByText("Cut Special Creative"));
    const sheet = await screen.findByRole("dialog", { name: "Cut Special Creative" });
    const input = await within(sheet).findByLabelText("Upload a file to link");
    fireEvent.change(input, { target: { files: [new File(["x"], "cut.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(tracked).toHaveBeenCalledWith("workspace", expect.any(File), { client_team_id: null, project_id: "project", folder_id: null }, "Cut Special Creative", expect.any(Function)));
    expect(await within(sheet).findByRole("button", { name: "Upload a file" })).toBeEnabled();
  });
});
