import { describe, expect, it } from "vitest";
import { chipLabel, titleFromNote } from "./note-tasks";

describe("note tasks", () => {
  it("titles a task from the note's first line, trimmed", () => {
    expect(titleFromNote("Logo pops too early\nand the grade")).toBe("Logo pops too early");
    expect(titleFromNote("   ")).toBe("Review note");
    expect(titleFromNote("x".repeat(200))).toHaveLength(120);
  });
  it("labels the chip with the stage, or done", () => {
    const link = { id: "t", title: "Fix logo", stage: "In progress", done: false, href: "/tasks?task=t" };
    expect(chipLabel(link)).toBe("Task: Fix logo (In progress)");
    expect(chipLabel({ ...link, done: true })).toBe("Task: Fix logo (done)");
    expect(chipLabel({ ...link, stage: null })).toBe("Task: Fix logo");
  });
});
