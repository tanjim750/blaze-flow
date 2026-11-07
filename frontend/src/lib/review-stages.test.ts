import { describe, expect, it } from "vitest";
import { approvalStageId } from "./review-stages";

const builtIn = [
  { id: "q", name: "Queued", slug: "queued" },
  { id: "p", name: "In Progress", slug: "in-progress" },
  { id: "r", name: "In Review", slug: "in-review" },
  { id: "v", name: "Revision", slug: "revision" },
  { id: "a", name: "Approval", slug: "approval" },
  { id: "ok", name: "Approved", slug: "approved" },
];

describe("approvalStageId", () => {
  it("picks Approved, not the earlier Approval stage", () => {
    expect(approvalStageId(builtIn)).toBe("ok");
  });

  it("prefers the approved slug even when the stage was renamed", () => {
    const renamed = builtIn.map((stage) => stage.id === "ok" ? { ...stage, name: "Signed off" } : stage);
    expect(approvalStageId(renamed)).toBe("ok");
  });

  it("falls back to an unambiguous done stage", () => {
    expect(approvalStageId([{ id: "a", name: "Approval", slug: "approval" }, { id: "d", name: "Delivered", slug: "delivered" }])).toBe("d");
  });

  it("never treats a lone Approval (awaiting) stage as approved", () => {
    expect(approvalStageId([{ id: "a", name: "Approval", slug: "approval" }])).toBeNull();
  });
});
