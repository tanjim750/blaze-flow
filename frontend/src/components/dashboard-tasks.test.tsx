import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardTasks } from "./dashboard-tasks";

vi.mock("@/app/(app)/tasks/actions", () => ({ setTaskCompletedAction: vi.fn().mockResolvedValue({ error: null, message: "Task completed." }) }));

const tasks = [
  { id: "today", name: "Review hero", project: "Launch", priority: "High", time: "4:00 PM", status: "Due today", tone: "warning" as const, bucket: "Today" as const },
  { id: "later", name: "Export social", project: "Launch", priority: "Medium", time: "Tomorrow", status: "Upcoming", tone: "neutral" as const, bucket: "Upcoming" as const },
];

describe("DashboardTasks", () => {
  it("filters buckets and tracks a local completion", () => {
    render(<DashboardTasks tasks={tasks} />);
    expect(screen.getByText("Review hero")).toBeInTheDocument();
    expect(screen.queryByText("Export social")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Review hero" }));
    expect(screen.getByText("Done")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));
    expect(screen.getByText("Export social")).toBeInTheDocument();
  });
});
