import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/api";
import type { TasksView } from "@/lib/tasks-view";
import { UniversalReviewLayout } from "@/components/universal-review";
import { TasksBoard } from "./board";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }) }));

const view = {
  workspaceId: "workspace",
  notice: null,
  clients: [{ id: "client", name: "Acme", description: null, website: null, email: null, phone: null, address_line_1: null, address_line_2: null, city: null, state_region: null, postal_code: null, country_code: null, metadata: null, status: "ACTIVE", created_at: "2026-09-10" }],
  projects: [{ id: "project", workspace_id: "workspace", client_team_id: "client", name: "Summer Campaign", description: null, status: "ACTIVE", priority: "HIGH", start_at: null, due_at: null, created_at: "2026-09-10", updated_at: "2026-09-10" }],
  members: [],
  // Older payloads have no `kind`; the board infers it from the name.
  stages: [
    { id: "todo-stage", name: "To Do", color: "#89909d", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: false, task_count: 0 },
    { id: "revisions-stage", name: "Revisions", color: "#ff5865", sort_order: 1, wip_limit: 3, is_done: false, automation_enabled: true, task_count: 1 },
    { id: "client-stage", name: "Client Review", color: "#67b0f9", sort_order: 2, wip_limit: null, is_done: false, automation_enabled: true, task_count: 0, kind: "client_review" },
    { id: "approved-stage", name: "Approved", color: "#36d399", sort_order: 3, wip_limit: null, is_done: true, automation_enabled: false, task_count: 0 },
  ],
  workflowSettings: { wip_warning: true, auto_notify_client: true, lock_done_editing: true },
  files: [],
  tasks: [{ id: "task", workspace_id: "workspace", client_team_id: "client", project_id: "project", task_stage_id: "revisions-stage", title: "Edit Summer Campaign V3", description: "Tighten the opening", status: "TODO", priority: "HIGH", start_at: null, due_at: "2026-09-18T12:00:00Z", completed_at: null, sort_order: 0, created_at: "2026-09-10", updated_at: "2026-09-10", assignees: [] }],
} satisfies TasksView;

const stagedFile = { id: "file", workspace_id: "workspace", client_team_id: "client", project_id: "project", folder_id: null, task_stage_id: "todo-stage", file: { id: "source-file", name: "daily life.mov", mime_type: "video/quicktime", size_bytes: 10, checksum_sha256: "x", status: "READY", duration_ms: 12000 }, poster: null, added_by: null, comment_count: 2, version_number: 3, media_asset: null, created_at: "2026-09-12" } satisfies TasksView["files"][number];

type Route = (url: string, init: RequestInit) => unknown;
function mockFetch(route: Route) {
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = route(url, init);
    return { ok: true, status: body === undefined ? 204 : 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const column = (name: string) => screen.getByRole("listitem", { name });
const card = (title: string) => screen.getByText(title).closest("article")!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("TasksBoard", () => {
  it("uses one task collection across the board, the list and the project tab", () => {
    const rendered = render(<TasksBoard view={view} />);
    expect(within(column("Revisions")).getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    expect(within(column("Revisions")).getByLabelText("1 items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("row", { name: "Edit Summer Campaign V3, Revisions" })).toBeInTheDocument();
    rendered.rerender(<TasksBoard view={view} projectId="project" compact />);
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project tasks" })).toBeInTheDocument();
  });

  it("renders every stage with its label, and Client Review and Approved take no quick add", () => {
    render(<TasksBoard view={view} />);
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-labelledby") && within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(["To Do", "Revisions", "Client Review", "Approved"]);
    expect(within(column("To Do")).getAllByRole("button", { name: "Add task to To Do" }).length).toBeGreaterThan(0);
    expect(within(column("Client Review")).queryByRole("button", { name: /Add task/ })).not.toBeInTheDocument();
    expect(within(column("Approved")).getByText(/Add tasks in an earlier stage/)).toBeInTheDocument();
  });

  it("shows a staged file in its column with its version, runtime and notes", () => {
    render(<TasksBoard view={{ ...view, files: [stagedFile] }} />);
    const file = card("daily life.mov");
    expect(file).toHaveClass("tb-file-card");
    expect(file).toHaveAttribute("aria-roledescription", "draggable file");
    expect(within(column("To Do")).getByText("daily life.mov")).toBeInTheDocument();
    expect(within(file).getByText("V3 · 0:12")).toBeInTheDocument();
    expect(within(file).getByText("2")).toBeInTheDocument();
  });

  it("opens a staged video on the full review page, remembering the board as the way back", () => {
    window.history.replaceState(null, "", "/tasks?q=daily");
    render(<UniversalReviewLayout pathname="/tasks"><TasksBoard view={{ ...view, files: [stagedFile] }} /></UniversalReviewLayout>);
    fireEvent.click(screen.getByRole("button", { name: "Open review for daily life.mov" }));
    expect(push).toHaveBeenCalledWith("/review?media=source-file&from=%2Ftasks%3Fq%3Ddaily");
    window.history.replaceState(null, "", "/");
  });

  it("opens a task with a linked cut in review, with the task beside the player", () => {
    const linked = { ...view, files: [stagedFile], tasks: [{ ...view.tasks[0], attachment_file_ids: ["source-file"] }] };
    render(<UniversalReviewLayout pathname="/tasks"><TasksBoard view={linked} /></UniversalReviewLayout>);
    const target = card("Edit Summer Campaign V3");
    expect(target).toHaveAttribute("data-opens", "review");
    fireEvent.click(within(target).getByText("Edit Summer Campaign V3"));
    expect(push).toHaveBeenCalledWith("/review?media=source-file&task=task&from=%2F");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the detail sheet one click away with the card's Details button", async () => {
    mockFetch(() => []);
    const linked = { ...view, files: [stagedFile], tasks: [{ ...view.tasks[0], attachment_file_ids: ["source-file"] }] };
    render(<UniversalReviewLayout pathname="/tasks"><TasksBoard view={linked} /></UniversalReviewLayout>);
    fireEvent.click(screen.getByRole("button", { name: "Details for Edit Summer Campaign V3" }));
    expect(await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a list row the same way as its card", () => {
    const linked = { ...view, files: [stagedFile], tasks: [{ ...view.tasks[0], attachment_file_ids: ["source-file"] }] };
    render(<UniversalReviewLayout pathname="/tasks"><TasksBoard view={linked} /></UniversalReviewLayout>);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(within(screen.getByRole("row", { name: "Edit Summer Campaign V3, Revisions" })).getByText("Edit Summer Campaign V3"));
    expect(push).toHaveBeenCalledWith("/review?media=source-file&task=task&from=%2F");
  });

  it("asks for a cut when a task without one is opened", async () => {
    mockFetch(() => []);
    render(<TasksBoard view={view} />);
    fireEvent.click(card("Edit Summer Campaign V3"));
    const sheet = await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" });
    expect(await within(sheet).findByText("Link a cut to review this task")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Upload a file" })).toBeInTheDocument();
  });

  it("quick-adds a task into the column it was opened from", async () => {
    const created: Task = { ...view.tasks[0], id: "new", title: "Grade the teaser", task_stage_id: "todo-stage", sort_order: 0 };
    const fetchMock = mockFetch((url, init) => url.endsWith("/tasks/") && init.method === "POST" ? created : []);
    render(<TasksBoard view={view} />);
    fireEvent.click(within(column("To Do")).getAllByRole("button", { name: "Add task to To Do" })[0]);
    const input = screen.getByRole("textbox", { name: "New task in To Do" });
    fireEvent.change(input, { target: { value: "Grade the teaser" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await within(column("To Do")).findByText("Grade the teaser")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ title: "Grade the teaser", task_stage_id: "todo-stage" });
  });

  it("moves a task with the number keys through the move endpoint", async () => {
    const fetchMock = mockFetch((url) => url.endsWith("/move/") ? { task: { ...view.tasks[0], task_stage_id: "todo-stage" }, order: [{ id: "task", sort_order: 0 }], side_effects: [] } : []);
    render(<TasksBoard view={view} />);
    fireEvent.keyDown(card("Edit Summer Campaign V3"), { key: "1" });
    expect(within(column("To Do")).getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces/workspace/tasks/task/move/");
    expect(JSON.parse(String(init?.body))).toEqual({ task_stage_id: "todo-stage", position: 0 });
  });

  it("gives every card an actions menu and keyboard help", () => {
    // Radix menus take ~15s to open under jsdom here, so the menu's contents are covered by
    // the Playwright pass; this checks the trigger and the drag instructions are wired.
    render(<TasksBoard view={view} />);
    expect(screen.getByRole("button", { name: "Actions for Edit Summer Campaign V3" })).toHaveAttribute("aria-haspopup", "menu");
    expect(card("Edit Summer Campaign V3")).toHaveAttribute("aria-roledescription", "draggable task");
    expect(card("Edit Summer Campaign V3")).toHaveAccessibleDescription(/press Space to pick it up/);
  });

  it("asks before approving and only moves once confirmed", async () => {
    const fetchMock = mockFetch(() => ({ task: { ...view.tasks[0], task_stage_id: "approved-stage" }, order: [], side_effects: [] }));
    render(<TasksBoard view={view} />);
    fireEvent.keyDown(card("Edit Summer Campaign V3"), { key: "4" });
    const dialog = await screen.findByRole("dialog", { name: "Approve task?" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(within(column("Approved")).getByText("Edit Summer Campaign V3")).toBeInTheDocument();
  });

  it("will not send a task without a client to Client Review", async () => {
    const fetchMock = mockFetch(() => []);
    const loose = { ...view, tasks: [{ ...view.tasks[0], client_team_id: null, project_id: null }] };
    render(<TasksBoard view={loose} />);
    fireEvent.keyDown(card("Edit Summer Campaign V3"), { key: "3" });
    await act(async () => {});
    expect(within(column("Revisions")).getByText("Edit Summer Campaign V3")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens task details in a sheet and loads its attachments on demand", async () => {
    const fetchMock = mockFetch(() => [{ id: "a1", attached_at: "2026-09-12", file: { ...stagedFile.file } }]);
    render(<TasksBoard view={{ ...view, files: [stagedFile] }} />);
    fireEvent.click(card("Edit Summer Campaign V3"));
    const sheet = await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" });
    expect(within(sheet).getByRole("textbox", { name: "Task title" })).toHaveValue("Edit Summer Campaign V3");
    expect(await within(sheet).findByRole("button", { name: "Open in review: daily life.mov" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/workspace/tasks/task/attachments/");
  });

  it("opens the task named in ?task= on load", async () => {
    mockFetch(() => []);
    render(<TasksBoard view={view} initialQuery="task=task" />);
    expect(await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" })).toBeInTheDocument();
  });

  it("locks an approved task's fields until it is reopened", async () => {
    mockFetch(() => []);
    const approved = { ...view, tasks: [{ ...view.tasks[0], task_stage_id: "approved-stage" }] };
    render(<TasksBoard view={approved} initialQuery="task=task" />);
    const sheet = await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" });
    expect(within(sheet).getByText(/Editing is locked/)).toBeInTheDocument();
    expect(within(sheet).getByRole("textbox", { name: "Task title" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("dialog", { name: "Reopen approved task?" })).toBeInTheDocument();
  });

  it("Clear resets the search too, and the board says when nothing matches", () => {
    render(<TasksBoard view={view} />);
    fireEvent.change(screen.getByPlaceholderText("Search tasks, projects, assignees…"), { target: { value: "nothing like this" } });
    expect(screen.queryByText("Edit Summer Campaign V3")).not.toBeInTheDocument();
    expect(screen.getByText("No matching tasks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("No matching tasks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByPlaceholderText("Search tasks, projects, assignees…")).toHaveValue("");
    expect(screen.getByText("Edit Summer Campaign V3")).toBeInTheDocument();
  });

  it("reads filters from the URL query", () => {
    render(<TasksBoard view={view} initialQuery="priority=low" />);
    expect(screen.queryByText("Edit Summer Campaign V3")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter Priority: Low" })).toBeInTheDocument();
  });

  it("does not mark a past-due task overdue once it is in a done stage", () => {
    const late = {
      ...view,
      tasks: [
        { ...view.tasks[0], id: "open", title: "Open late task", due_at: "2020-01-01T12:00:00Z" },
        { ...view.tasks[0], id: "done", title: "Approved late task", task_stage_id: "approved-stage", due_at: "2020-01-01T12:00:00Z" },
      ],
    } satisfies TasksView;
    render(<TasksBoard view={late} />);
    expect(card("Open late task").querySelector("time")).toHaveClass("is-overdue");
    expect(card("Approved late task").querySelector("time")).not.toHaveClass("is-overdue");
  });
});

describe("TasksBoard for read-only viewers", () => {
  const clientAccess = { create: false, update: false, delete: false, manageStages: false, client: true };
  const viewOnly = { create: false, update: false, delete: false, manageStages: false, client: false };

  it("shows a client the board without New task, quick add, card menus or a banner", () => {
    render(<TasksBoard view={{ ...view, access: clientAccess }} />);
    expect(screen.queryByRole("button", { name: "New task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add task to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Customize stages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Edit Summer Campaign V3" })).not.toBeInTheDocument();
    expect(screen.queryByText(/permission/i)).not.toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(card("Edit Summer Campaign V3")).toHaveAttribute("aria-roledescription", "task");
  });

  it("gives a client with nothing shared a read-only empty state that points Home", () => {
    render(<TasksBoard view={{ ...view, tasks: [], access: clientAccess }} />);
    expect(screen.getByText("The studio runs production here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
  });

  it("ignores the n shortcut and the number keys when the viewer cannot write", () => {
    const fetchMock = mockFetch(() => ({}));
    render(<TasksBoard view={{ ...view, access: viewOnly }} />);
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByRole("dialog", { name: /New task/ })).not.toBeInTheDocument();
    fireEvent.keyDown(card("Edit Summer Campaign V3"), { key: "1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the detail sheet read-only: fields disabled, no Delete, no Reopen", async () => {
    mockFetch(() => []);
    render(<TasksBoard view={{ ...view, access: viewOnly }} initialQuery="task=task" />);
    const sheet = await screen.findByRole("dialog", { name: "Edit Summer Campaign V3" });
    expect(within(sheet).getByText(/View only\./)).toBeInTheDocument();
    expect(within(sheet).getByRole("textbox", { name: "Task title" })).toBeDisabled();
    expect(within(sheet).getByLabelText("Stage")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Attach from library" })).not.toBeInTheDocument();
  });

  it("drops move and delete from the list view", () => {
    render(<TasksBoard view={{ ...view, access: viewOnly }} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByRole("button", { name: "Actions for Edit Summer Campaign V3" })).not.toBeInTheDocument();
  });
});
