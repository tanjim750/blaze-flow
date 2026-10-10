import { describe, expect, it } from "vitest";
import { batchable, filterCounts, matchesFilter, pollDelay, readability, sortFindings, stageLabel, stageStep, suggestion, type AiFinding, type AiReview } from "./ai-qa";

const finding = (over: Partial<AiFinding>): AiFinding => ({
  id: "f", category: "POSSIBLE_SPELLING_ERROR", band: "high", detected_text: "PREMUIM", suggested_text: "PREMIUM",
  edited_suggestion: "", context_text: "", explanation: "", ocr_confidence: 0.98, decision_confidence: 0.92,
  region: { x: 0.1, y: 0.3, width: 0.2, height: 0.05 }, start_time_ms: null, end_time_ms: null,
  status: "PENDING", comment_id: null, reviewed_at: null, created_at: "", ...over,
});

const review = (over: Partial<AiReview>): AiReview => ({
  id: "r", media_version_id: "m", status: "QUEUED", stage: "queued", progress: {}, language: "en-GB", engine: "paddleocr",
  engine_version: "", error_code: "", error_message: "", requested_by: null,
  summary: { total: 0, by_category: {}, by_band: {}, by_status: {} }, usage: {}, started_at: null, completed_at: null, created_at: "", ...over,
});

describe("ai-qa helpers", () => {
  it("filters by status and category", () => {
    const list = [finding({ id: "a" }), finding({ id: "b", category: "OCR_UNCERTAIN", band: "low" }), finding({ id: "c", status: "DISMISSED" }), finding({ id: "d", status: "COMMENT_CREATED" })];
    expect(list.filter((f) => matchesFilter(f, "open")).map((f) => f.id)).toEqual(["a", "b"]);
    expect(filterCounts(list)).toEqual({ open: 2, spelling: 2, uncertain: 1, commented: 1, dismissed: 1, all: 4 });
  });

  it("sorts high confidence first, then by position", () => {
    const list = [finding({ id: "low", band: "low" }), finding({ id: "lower", region: { x: 0, y: 0.9, width: 0.1, height: 0.1 } }), finding({ id: "top", region: { x: 0, y: 0.1, width: 0.1, height: 0.1 } })];
    expect(sortFindings(list).map((f) => f.id)).toEqual(["top", "lower", "low"]);
  });

  it("only batches open, high-confidence spelling findings", () => {
    expect(batchable([finding({ id: "a" }), finding({ id: "b", band: "medium" }), finding({ id: "c", status: "COMMENT_CREATED" }), finding({ id: "d", category: "OCR_UNCERTAIN" })]).map((f) => f.id)).toEqual(["a"]);
  });

  it("describes stages and readability in words", () => {
    expect(stageLabel(review({}))).toBe("Queued");
    expect(stageLabel(review({ status: "PROCESSING", stage: "checking" }))).toBe("Checking spelling");
    expect(stageStep(review({ status: "SUCCEEDED" }))).toBe(3);
    expect(readability(0.95)).toBe("Text read clearly");
    expect(readability(0.5)).toBe("Text hard to read");
  });

  it("prefers the reviewer's edited suggestion and backs off polling", () => {
    expect(suggestion(finding({ edited_suggestion: "Premium" }))).toBe("Premium");
    expect(pollDelay(1_000)).toBe(2_000);
    expect(pollDelay(60_000)).toBe(5_000);
  });
});
