import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { AnnotationElement } from "@/lib/api";
import type { ReviewView } from "@/lib/review-view";
import type { ReviewNote } from "@/lib/review-notes";
import { DEFAULT_HOLD, displayWindow, type HoldChoice } from "@/lib/annotation-window";
import { addLocalNote, resetLocalReview, useLocalReview } from "@/lib/review-local";
import { Comments } from "./comments";
import type { ReviewWriter } from "./writer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }) }));

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); resetLocalReview(); });

const circle: AnnotationElement = { id: "el", element_type: "ELLIPSE", geometry: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 }, style: {}, payload: {} };
const view = {
  workspaceId: "ws", target: { workspaceId: "ws", projectId: "p", versionId: "v" }, version: { id: "media-1" }, comparison: null,
  members: [], canComment: true, access: { comment: true, resolve: true, annotate: true, react: true },
} as unknown as ReviewView;

function Harness({ compose, notes = [] }: { compose: ReviewWriter["compose"]; notes?: ReviewNote[] }) {
  const [hold, setHold] = useState<HoldChoice>(DEFAULT_HOLD);
  const writer = { compose, react: vi.fn(), setResolved: vi.fn(), removeNote: vi.fn(), setError: vi.fn(), busy: false, error: null } as unknown as ReviewWriter;
  return (
    <Comments
      view={view} writer={writer} compareWriter={writer} notes={notes} positionMs={2000} focusedId={null}
      pendingAnnotation={circle} onClearAnnotation={() => {}} hold={hold} onHold={setHold} durationMs={30_000}
      onSeek={() => {}} onCompareSeek={() => {}} canWriteTeam={false} clientPreview={false} hiddenTeamNotes={0}
      onClientPreview={() => {}} onComposerChange={() => {}}
    />
  );
}

const write = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

describe("drawing duration picker", () => {
  it("defaults to 5s and posts the drawing's end with the note", async () => {
    const compose = vi.fn(async () => true);
    render(<Harness compose={compose} />);
    expect(screen.getByRole("radio", { name: "5s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Visible 00:02–00:07 during playback.")).toBeInTheDocument();
    write("testing circle");
    send();
    await waitFor(() => expect(compose).toHaveBeenCalled());
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({ text: "testing circle", startMs: 2000, annotationEndMs: 7000, endMs: null }));
  });

  it("holds for a preset, or just the frame", async () => {
    const compose = vi.fn(async () => true);
    render(<Harness compose={compose} />);
    fireEvent.click(screen.getByRole("radio", { name: "Frame" }));
    expect(screen.getByText("Shows on 00:02 only, while paused there.")).toBeInTheDocument();
    write("this frame");
    send();
    await waitFor(() => expect(compose).toHaveBeenCalledWith(expect.objectContaining({ annotationEndMs: 2000, endMs: null })));
  });

  it("makes a range note from a typed out point, and refuses one before the in point", async () => {
    const compose = vi.fn(async () => true);
    render(<Harness compose={compose} />);
    fireEvent.click(screen.getByRole("radio", { name: "Range" }));
    const out = screen.getByRole("textbox", { name: "Out point in seconds" });
    fireEvent.change(out, { target: { value: "1" } });
    fireEvent.blur(out);
    expect(screen.getByRole("alert")).toHaveTextContent("The out point has to come after 00:02.");
    fireEvent.change(out, { target: { value: "9.5" } });
    fireEvent.blur(out);
    expect(screen.getByText("Visible 00:02–00:09 during playback · range note.")).toBeInTheDocument();
    write("whole shot");
    send();
    await waitFor(() => expect(compose).toHaveBeenCalledWith(expect.objectContaining({ annotationEndMs: 9500, endMs: 9500 })));
  });

  it("shows a note's drawing span in its row", () => {
    const notes: ReviewNote[] = [
      { id: "n", author: "Alex", authorId: null, guestSessionId: null, initials: "A", timecode: "00:02", startMs: 2000, text: "testing circle", age: "now", resolved: false, reactions: [], attachments: [], mentions: [], replies: [], drawingWindow: displayWindow(2000, 7000) },
      { id: "r", author: "Alex", authorId: null, guestSessionId: null, initials: "A", timecode: "00:10", startMs: 10_000, endMs: 14_000, text: "range", age: "now", resolved: false, reactions: [], attachments: [], mentions: [], replies: [] },
    ];
    render(<Harness compose={vi.fn()} notes={notes} />);
    expect(screen.getByRole("button", { name: "00:02–00:07" })).toHaveAttribute("title", "Drawing stays on screen 00:02–00:07 (5s)");
    expect(screen.getByRole("button", { name: "00:10–00:14" })).toHaveClass("is-range");
  });
});

describe("session-only notes", () => {
  it("keep the drawing window and range on the device", () => {
    const { result } = renderHook(() => useLocalReview("media-1"));
    let note: ReviewNote | null = null;
    act(() => { note = addLocalNote("media-1", { text: "x", startMs: 2000, endMs: 9000, author: "Alex", annotation: { elements: [circle], endMs: 9000 } }); });
    expect(note!.endMs).toBe(9000);
    expect(result.current.annotations[0]).toMatchObject({ review_comment_id: note!.id, start_time_ms: 2000, end_time_ms: 9000 });
    act(() => { addLocalNote("media-1", { text: "y", startMs: 4000, author: "Alex", annotation: { elements: [circle], endMs: 1000 } }); });
    // A backwards end is dropped, so the drawing falls back to the default hold.
    expect(result.current.annotations[1].end_time_ms).toBeNull();
  });
});
