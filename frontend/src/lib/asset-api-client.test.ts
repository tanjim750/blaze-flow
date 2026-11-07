import { describe, expect, it } from "vitest";
import { syncedTasksMessage } from "./asset-api-client";

describe("syncedTasksMessage", () => {
  it("is null when no task followed the file", () => {
    expect(syncedTasksMessage({ synced_tasks: [] })).toBeNull();
    expect(syncedTasksMessage(undefined)).toBeNull();
  });
  it("names one task and counts several", () => {
    expect(syncedTasksMessage({ synced_tasks: [{ id: "1", title: "Hero cut" }] }, "Approved")).toBe("Task “Hero cut” moved to Approved too");
    expect(syncedTasksMessage({ synced_tasks: [{ id: "1", title: "a" }, { id: "2", title: "b" }] })).toBe("2 linked tasks moved too");
  });
});
