import { describe, expect, it } from "vitest";
import { MIN_HOLD_MS, batchable, filterCounts, findingWindow, matchesFilter, pollDelay, progressLabel, readability, regionAt, sortFindings, stageLabel, stageStep, suggestion, timeRangeLabel, type AiFinding, type AiReview } from "./ai-qa";

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

describe("video findings", () => {
  const track = [
    { t: 1000, x: 0.1, y: 0.4, width: 0.2, height: 0.05 },
    { t: 1500, x: 0.15, y: 0.4, width: 0.2, height: 0.05 },
    { t: 2000, x: 0.2, y: 0.4, width: 0.2, height: 0.05 },
  ];
  it("follows a moving word along its track", () => {
    const finding = { region: track[0], track };
    expect(regionAt(finding, 500)?.x).toBe(0.1);
    expect(regionAt(finding, 1600)?.x).toBe(0.15);
    expect(regionAt(finding, 9000)?.x).toBe(0.2);
    expect(regionAt({ region: track[0], track: [] }, 0)?.x).toBe(0.1);
  });
  it("holds a brief sighting long enough to see", () => {
    expect(findingWindow({ start_time_ms: 2000, end_time_ms: 2000 })).toEqual({ startMs: 2000, endMs: 2000 + MIN_HOLD_MS });
    expect(findingWindow({ start_time_ms: 1000, end_time_ms: 5000 })).toEqual({ startMs: 1000, endMs: 5000 });
    expect(findingWindow({ start_time_ms: null, end_time_ms: null })).toBeNull();
  });
  it("labels ranges and frame progress", () => {
    expect(timeRangeLabel({ start_time_ms: 12400, end_time_ms: 15000 })).toBe("0:12.4–0:15.0");
    expect(timeRangeLabel({ start_time_ms: 62000, end_time_ms: 62000 })).toBe("1:02.0");
    expect(progressLabel({ progress: { kind: "video", frames_done: 40, frames_total: 120 } } as never)).toBe("frame 40 of 120");
    expect(progressLabel({ progress: {} } as never)).toBeNull();
  });
  it("orders video findings by time", () => {
    const at = (id: string, start: number, band: "high" | "low") => ({ id, start_time_ms: start, band, region: {} }) as never;
    expect(sortFindings([at("b", 5000, "high"), at("a", 1000, "low")]).map((f: { id: string }) => f.id)).toEqual(["a", "b"]);
  });
});
