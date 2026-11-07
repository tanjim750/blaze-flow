import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/api";
import type { ReviewView } from "@/lib/review-view";
import type { ReviewNote } from "@/lib/review-notes";
import { Comments } from "./comments";
import { TaskPanel } from "./task-panel";
import type { ReviewWriter } from "./writer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const task: Task = { id: "task", workspace_id: "ws", client_team_id: null, project_id: "p", task_stage_id: "todo", title: "Cut the teaser", description: "", status: "TODO", priority: "MEDIUM", start_at: null, due_at: null, completed_at: null, sort_order: 0, created_at: "2026-09-10", updated_at: "2026-09-10", assignees: [] };
const stages = [{ id: "todo", name: "To Do", color: "#888", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: false, task_count: 1 }];
const context = { task, linkedFiles: [], onScreenIsLinked: true, clientId: null, projectName: "Spring" };
const people = [{ id: "m-maya", name: "Maya Editor" }, { id: "m-alex", name: "Alex Owner" }];

describe("review task panel", () => {
  it("lets a member with task.update change the assignee through the task endpoint", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(async () => ({ ok: true, status: 200, json: async () => ({ ...task, assignees: [{ id: "m-maya", name: "Maya Editor", email: "maya@x" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskPanel context={context} stages={stages} workspaceId="ws" mediaId="f" assignees={people} returnTo={null} onNavigate={() => {}} />);
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "m-maya" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces/ws/tasks/task/");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ assignee_id: "m-maya" });
    await waitFor(() => expect(screen.getByLabelText("Assignee")).toHaveValue("m-maya"));
  });

  it("shows the assignee as text, and the stage locked, without task.update", () => {
    const access = { create: false, update: false, delete: false, manageStages: false, client: false };
    render(<TaskPanel context={{ ...context, task: { ...task, assignees: [{ id: "m-maya", name: "Maya Editor", email: "" }] } }} stages={stages} workspaceId="ws" mediaId="f" access={access} assignees={people} returnTo={null} onNavigate={() => {}} />);
    expect(screen.queryByRole("combobox", { name: "Assignee" })).not.toBeInTheDocument();
    expect(screen.getByText("Maya Editor")).toBeInTheDocument();
    expect(screen.getByLabelText("Stage")).toBeDisabled();
  });
});

const note: ReviewNote = { id: "n1", author: "Sam", authorId: "u", guestSessionId: null, initials: "S", timecode: "00:02", startMs: 2000, text: "Trim the end", age: "1h", resolved: false, reactions: [], attachments: [], mentions: [], replies: [] };
const writer = { react: vi.fn(), setResolved: vi.fn(), removeNote: vi.fn(), busy: false, error: null } as unknown as ReviewWriter;
const baseView = {
  workspaceId: "ws", target: { workspaceId: "ws", projectId: "p", versionId: "v" }, version: null, comparison: null, members: [],
} as unknown as ReviewView;
const props = { writer, compareWriter: writer, notes: [note], positionMs: 0, focusedId: null, pendingAnnotation: null, onClearAnnotation: () => {}, onSeek: () => {}, onCompareSeek: () => {}, canWriteTeam: true, clientPreview: false, hiddenTeamNotes: 0, onClientPreview: () => {}, onComposerChange: () => {} };

describe("review comments for a view-only member", () => {
  it("says view-only instead of offering a composer, and hides Reply, Resolve and reactions", () => {
    const view = { ...baseView, canComment: false, access: { comment: false, resolve: false, annotate: false, react: false } } as ReviewView;
    render(<Comments view={view} {...props} />);
    expect(screen.getByText("You have view-only access.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Comment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "React with thumbs up" })).not.toBeInTheDocument();
    expect(screen.getByText("Trim the end")).toBeInTheDocument();
  });

  it("keeps Resolve for a commenter with manage rights", () => {
    const view = { ...baseView, canComment: false, access: { comment: false, resolve: true, annotate: false, react: true } } as ReviewView;
    render(<Comments view={view} {...props} />);
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });
});
