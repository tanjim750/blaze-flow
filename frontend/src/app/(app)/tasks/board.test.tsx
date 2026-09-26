import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TasksView } from "@/lib/tasks-view";
import { UniversalReviewLayout } from "@/components/universal-review";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
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

  it("starts a new task in the column where it was added", () => {
    render(<TasksBoard view={view} />);

    fireEvent.click(screen.getByRole("button", { name: "Add task to Revisions" }));

    expect(screen.getByRole("heading", { name: "New task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Stage")).toHaveValue("revisions-stage");
  });

  it("opens task details beside the board and loads its attachments on demand", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<TasksBoard view={view} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Summer Campaign V3" }));

    expect(screen.getByRole("heading", { name: "Edit Summer Campaign V3" })).toBeInTheDocument();
    expect(await screen.findByText("No attachments yet")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace/tasks/task/attachments/", { credentials: "include" });
  });

  it("opens a staged video in the adjacent review workspace", () => {
    const staged = {
      ...view,
      files: [{ id: "file", workspace_id: "workspace", client_team_id: "client", project_id: "project", folder_id: null, task_stage_id: "todo-stage", file: { id: "source-file", name: "daily life.mov", mime_type: "video/quicktime", size_bytes: 10, checksum_sha256: "x", status: "READY", duration_ms: null }, poster: null, added_by: null, comment_count: 0, version_number: 1, media_asset: null, created_at: "2026-09-12" }],
    } satisfies TasksView;
    render(<UniversalReviewLayout pathname="/tasks"><TasksBoard view={staged} /></UniversalReviewLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Open review for daily life.mov" }));

    expect(screen.getByTitle("Review daily life.mov")).toHaveAttribute("src", "/review-embed?media=source-file");
    expect(screen.getByRole("link", { name: "Open full review" })).toHaveAttribute("href", "/review?media=source-file");
  });

  it("Clear resets the search too, and the board says when nothing matches", () => {
    render(<TasksBoard view={view} />);
    fireEvent.change(screen.getByPlaceholderText("Search tasks, projects, assignees…"), { target: { value: "nothing like this" } });
    expect(screen.queryByText("Edit Summer Campaign V3")).not.toBeInTheDocument();
    expect(screen.getByText("No matching tasks")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByPlaceholderText("Search tasks, projects, assignees…")).toHaveValue("");
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
  });

  it("does not mark a past-due task overdue once it is in a done stage", () => {
    const done = {
      ...view,
      stages: [...view.stages, { id: "approved-stage", name: "Approved", color: "#36d399", sort_order: 2, wip_limit: null, is_done: true, automation_enabled: false, task_count: 1 }],
      tasks: [
        { ...view.tasks[0], id: "open", title: "Open late task", due_at: "2020-01-01T12:00:00Z" },
        { ...view.tasks[0], id: "done", title: "Approved late task", task_stage_id: "approved-stage", due_at: "2020-01-01T12:00:00Z" },
      ],
    } satisfies TasksView;
    render(<TasksBoard view={done} />);
    const dateOf = (name: string) => screen.getByText(name).closest("article")!.querySelector("time")!;
    expect(dateOf("Open late task")).toHaveClass("overdue");
    expect(dateOf("Approved late task")).not.toHaveClass("overdue");
  });
});
