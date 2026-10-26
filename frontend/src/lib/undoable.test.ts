import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleUndoable } from "./undoable";

describe("scheduleUndoable", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("commits once the window passes", () => {
    const commit = vi.fn();
    const pending = scheduleUndoable(commit, 5000);
    vi.advanceTimersByTime(4999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pending.undo()).toBe(false);
  });

  it("Undo inside the window cancels the write", () => {
    const commit = vi.fn();
    const pending = scheduleUndoable(commit, 5000);
    expect(pending.undo()).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(commit).not.toHaveBeenCalled();
  });

  it("flush commits immediately and only once", () => {
    const commit = vi.fn();
    const pending = scheduleUndoable(commit, 5000);
    pending.flush();
    pending.flush();
    vi.advanceTimersByTime(10000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pending.settled()).toBe(true);
  });
});
