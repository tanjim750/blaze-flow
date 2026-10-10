import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardTasks } from "./dashboard-tasks";

vi.mock("@/app/(app)/tasks/actions", () => ({ setTaskCompletedAction: vi.fn().mockResolvedValue({ error: null, message: "Task completed." }) }));

const task = (id: string, name: string, bucket: "Today" | "Upcoming" | "Overdue", mine: boolean) =>
  ({ id, name, project: "Launch", priority: "High", time: "4:00 PM", status: "To Do", tone: "neutral" as const, bucket, mine });

const tasks = [
  task("today", "Review hero", "Today", true),
  task("later", "Export social", "Upcoming", true),
  task("theirs", "Grade hero", "Today", false),
];

afterEach(cleanup);

describe("DashboardTasks", () => {
  it("filters buckets and tracks a local completion", () => {
    render(<DashboardTasks tasks={tasks} membershipId="m-1" />);
    expect(screen.getByText("Review hero")).toBeInTheDocument();
    expect(screen.queryByText("Export social")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Review hero" }));
    expect(screen.getByText("Done")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Upcoming/ }));
    expect(screen.getByText("Export social")).toBeInTheDocument();
  });

  it("shows only the viewer's tasks by default, with a switch to everyone's", () => {
    render(<DashboardTasks tasks={tasks} membershipId="m-1" />);
    expect(screen.getByRole("heading", { name: "My tasks" })).toBeInTheDocument();
    expect(screen.queryByText("Grade hero")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All my tasks/ })).toHaveAttribute("href", "/tasks?assignee=m-1");

    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(screen.getByRole("heading", { name: "All tasks" })).toBeInTheDocument();
    expect(screen.getByText("Grade hero")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All tasks/ })).toHaveAttribute("href", "/tasks");
  });

  it("lists everyone's tasks and hides the switch when the viewer has no membership", () => {
    render(<DashboardTasks tasks={tasks} membershipId={null} />);
    expect(screen.queryByRole("button", { name: "Mine" })).not.toBeInTheDocument();
    expect(screen.getByText("Grade hero")).toBeInTheDocument();
  });

  it("says you're clear for today and offers the upcoming ones", () => {
    render(<DashboardTasks tasks={[task("later", "Export social", "Upcoming", true)]} membershipId="m-1" />);
    expect(screen.getByText("You're clear for today")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View upcoming (1)" }));
    expect(screen.getByText("Export social")).toBeInTheDocument();
  });

  it("reports a failed task load instead of an empty list", () => {
    render(<DashboardTasks tasks={[]} membershipId="m-1" error="Tasks could not be loaded: boom" />);
    expect(screen.getByText("Tasks didn't load")).toBeInTheDocument();
    expect(screen.queryByText("You're clear for today")).not.toBeInTheDocument();
  });
});
