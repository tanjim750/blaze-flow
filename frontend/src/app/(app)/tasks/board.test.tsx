import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TasksView } from "@/lib/tasks-view";
import { TasksBoard } from "./board";

const view = {
  workspaceId: "workspace",
  notice: null,
  clients: [{ id: "client", name: "Acme", description: null, website: null, email: null, phone: null, address_line_1: null, address_line_2: null, city: null, state_region: null, postal_code: null, country_code: null, metadata: null, status: "ACTIVE", created_at: "2026-09-10" }],
  projects: [{ id: "project", workspace_id: "workspace", client_team_id: "client", name: "Summer Campaign", description: null, status: "ACTIVE", priority: "HIGH", start_at: null, due_at: null, created_at: "2026-09-10", updated_at: "2026-09-10" }],
  members: [],
  stages: [
    { id: "todo-stage", name: "To Do", color: "#89909d", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: false, task_count: 0 },
    { id: "revisions-stage", name: "Revisions", color: "#ff5865", sort_order: 1, wip_limit: 3, is_done: false, automation_enabled: true, task_count: 1 },
  ],
  workflowSettings: { wip_warning: true, auto_notify_client: true, lock_done_editing: true },
  files: [],
  tasks: [{ id: "task", workspace_id: "workspace", client_team_id: "client", project_id: "project", task_stage_id: "revisions-stage", title: "Edit Summer Campaign V3", description: "Tighten the opening", status: "REVISIONS", priority: "HIGH", start_at: null, due_at: "2026-09-18T12:00:00Z", completed_at: null, sort_order: 0, created_at: "2026-09-10", updated_at: "2026-09-10", assignees: [] }],
} satisfies TasksView;

afterEach(cleanup);
describe("TasksBoard", () => {
  it("uses one task collection across Kanban, List, and project views", () => {
    const rendered = render(<TasksBoard view={view} />);
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    expect(screen.getAllByText("Revisions").find((item) => item.tagName === "STRONG")?.parentElement).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    rendered.rerender(<TasksBoard view={view} projectId="project" compact />);
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
  });

  it("keeps filters while switching views", () => {
    render(<TasksBoard view={view} />);
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "todo-stage" } });
    expect(screen.queryByText("Edit Summer Campaign V3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("No matching tasks")).toBeInTheDocument();
  });

  it("shows a file in the stage column it was assigned", () => {
    const staged = {
      ...view,
      files: [{ id: "file", workspace_id: "workspace", client_team_id: "client", project_id: "project", folder_id: null, task_stage_id: "todo-stage", file: { id: "f", name: "daily life.mov", mime_type: "video/quicktime", size_bytes: 10, checksum_sha256: "x", status: "READY" }, created_at: "2026-09-12" }],
    } as unknown as TasksView;
    const rendered = render(<TasksBoard view={staged} />);

    // The card is in the To Do column, and that column counts it alongside its tasks.
    const card = screen.getByText("daily life.mov").closest("article");
    expect(card).toHaveClass("task-card-file");
    expect(card?.closest("section")).toHaveTextContent("To Do");
    expect(screen.getAllByText("To Do").find((item) => item.tagName === "STRONG")?.parentElement).toHaveTextContent("1");

    // It is draggable, which is how a stage change is made from here.
    expect(card).toHaveAttribute("draggable");
    rendered.unmount();
  });
});
