import { cleanup, fireEvent, render, renderHook, act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiQaPanel, useBandScope, type AiQa } from "./ai-qa-panel";
import { FINDINGS_PAGE, bandScopeKey, filterCounts, scopeCounts, type AiBand, type AiFinding, type AiReview } from "@/lib/ai-qa";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
afterEach(() => { cleanup(); window.localStorage.clear(); });

const finding = (i: number, band: AiBand): AiFinding => ({
  id: `f${i}`, category: "POSSIBLE_SPELLING_ERROR", band, detected_text: `WORD${i}`, suggested_text: "word",
  edited_suggestion: "", context_text: "", explanation: "", ocr_confidence: 0.9, decision_confidence: 0.9,
  region: { x: (i % 10) / 10, y: Math.floor(i / 10) / 12, width: 0.05, height: 0.02 }, start_time_ms: null, end_time_ms: null,
  status: "PENDING", comment_id: null, reviewed_at: null, created_at: "",
});
// The beta's real shape: 112 findings, 9 high / 42 medium / 61 low.
const FINDINGS = [...Array(9)].map((_, i) => finding(i, "high"))
  .concat([...Array(42)].map((_, i) => finding(100 + i, "medium")), [...Array(61)].map((_, i) => finding(200 + i, "low")));
const review: AiReview = {
  id: "r", media_version_id: "m", status: "SUCCEEDED", stage: "done", progress: {}, language: "en-GB", engine: "some-provider", engine_label: "with a hosted model",
  engine_version: "", error_code: "", error_message: "", requested_by: null, mode: "PROOFREAD", approved_copy: null,
  summary: { total: 112, by_category: {}, by_band: { high: 9, medium: 42, low: 61 }, by_status: {} }, usage: {}, started_at: null, completed_at: null, created_at: "",
} as AiReview;
const qa = (findings = FINDINGS): AiQa => ({
  available: true, state: { supported: true, can_run: true, engine: "some-provider", latest: review }, review, findings, error: null,
  start: vi.fn(), retry: vi.fn(), cancel: vi.fn(), update: vi.fn(),
});

function Harness({ userId = "u1" }: { userId?: string }) {
  const [scope, setScope] = useBandScope(userId);
  return <AiQaPanel qa={qa()} target={{ workspaceId: "w", projectId: "p", versionId: "v" }} versionLabel="V1" title="poster.png"
    selectedId={null} onSelect={() => undefined} scope={scope} onScope={setScope} />;
}
const cards = () => within(screen.getByTestId("ai-qa-findings")).queryAllByText(/^WORD\d+$/);

describe("AI QA list with 100+ findings", () => {
  it("shows only high confidence by default, with a reveal button that names what is hidden", () => {
    render(<Harness />);
    expect(cards()).toHaveLength(9);
    expect(screen.getByRole("tab", { name: /To review/ })).toHaveTextContent("To review9");
    fireEvent.click(screen.getByRole("button", { name: "Show 42 medium and 61 low confidence findings" }));
    expect(screen.getByRole("tab", { name: /To review/ })).toHaveTextContent("To review112");
    expect(cards()).toHaveLength(FINDINGS_PAGE);
  });

  it("pages long lists instead of rendering every card at once", () => {
    window.localStorage.setItem(bandScopeKey("u1"), "all");
    render(<Harness />);
    expect(cards()).toHaveLength(FINDINGS_PAGE);
    fireEvent.click(screen.getByTestId("ai-qa-more"));
    expect(cards()).toHaveLength(FINDINGS_PAGE * 2);
    while (screen.queryByTestId("ai-qa-more")) fireEvent.click(screen.getByTestId("ai-qa-more"));
    expect(cards()).toHaveLength(112);
  });

  it("remembers the choice per user", () => {
    const { result } = renderHook(() => useBandScope("u1"));
    act(() => result.current[1]("all"));
    expect(window.localStorage.getItem(bandScopeKey("u1"))).toBe("all");
    expect(renderHook(() => useBandScope("u1")).result.current[0]).toBe("all");
    expect(renderHook(() => useBandScope("u2")).result.current[0]).toBe("high");
  });

  it("keeps the batch action for high-confidence findings and shows the provider's label", () => {
    render(<Harness />);
    expect(screen.getByTestId("ai-qa-batch")).toHaveTextContent("Add 9 high-confidence as comments");
    expect(screen.getByText(/Checked V1 · with a hosted model/)).toBeInTheDocument();
  });

  it("counts visible and hidden open findings", () => {
    expect(scopeCounts(FINDINGS, "high")).toEqual({ visible: 9, hidden: 103, medium: 42, low: 61 });
    expect(scopeCounts(FINDINGS, "all")).toEqual({ visible: 112, hidden: 0, medium: 0, low: 0 });
    expect(filterCounts(FINDINGS, "high").open).toBe(9);
    expect(filterCounts(FINDINGS).open).toBe(112);
  });
});
