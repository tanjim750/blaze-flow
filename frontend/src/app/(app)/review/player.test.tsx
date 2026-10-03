import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewNote } from "@/lib/review-notes";
import { Player, type PlayerHandle } from "./player";

vi.mock("sonner", () => ({ toast: vi.fn() }));
import { toast } from "sonner";

const ranges = (...pairs: [number, number][]) => ({
  length: pairs.length, start: (i: number) => pairs[i][0], end: (i: number) => pairs[i][1],
});

/** jsdom's media element does nothing, so the test plays the browser's part. */
function fakeMedia(element: HTMLVideoElement, { duration = 20, seekable = ranges([0, 20]) } = {}) {
  let current = 0;
  const state = { seeking: false, error: null as { code: number } | null, readyState: 0 };
  Object.defineProperties(element, {
    duration: { configurable: true, get: () => duration },
    readyState: { configurable: true, get: () => state.readyState },
    seeking: { configurable: true, get: () => state.seeking },
    error: { configurable: true, get: () => state.error },
    seekable: { configurable: true, get: () => seekable },
    buffered: { configurable: true, get: () => ranges([0, 5]) },
    videoWidth: { configurable: true, get: () => 1920 },
    videoHeight: { configurable: true, get: () => 1080 },
    currentTime: {
      configurable: true,
      get: () => current,
      set: (value: number) => { current = value; state.seeking = true; },
    },
  });
  return {
    state,
    loadMetadata() { state.readyState = 1; fireEvent(element, new Event("loadedmetadata")); },
    /** Finishes the pending seek, optionally landing somewhere other than requested. */
    finishSeek(landAt?: number) {
      if (landAt !== undefined) current = landAt;
      state.seeking = false;
      fireEvent(element, new Event("seeked"));
    },
    fail(code: number) { state.error = { code }; fireEvent(element, new Event("error")); },
  };
}

const note = (startMs: number | null): ReviewNote => ({
  id: `n-${startMs}`, author: "Alex Morgan", authorId: "u1", guestSessionId: null, initials: "AM",
  timecode: startMs === null ? null : "00:00", startMs, text: "Note", age: "now", resolved: false,
  reactions: [], attachments: [], mentions: [], replies: [],
});

function setup(notes: ReviewNote[] = []) {
  const handle = createRef<PlayerHandle>();
  const onTime = vi.fn();
  const utils = render(
    <Player
      handle={handle} sources={[{ id: "proxy", label: "Proxy", src: "/api/preview/" }]} title="Cut"
      notes={notes} annotations={[]} pending={null} canDraw={false}
      onTime={onTime} onMeta={() => undefined} onDraw={() => undefined}
      onDeleteAnnotation={() => undefined} onFocusNote={() => undefined}
    />,
  );
  const element = utils.container.querySelector("video")!;
  return { ...utils, handle, onTime, element, media: fakeMedia(element) };
}

const clock = (container: HTMLElement) => container.querySelector(".rvp-clock strong")!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => { vi.useRealTimers(); vi.mocked(toast).mockClear(); });

describe("Player seeking", () => {
  it("moves the clock on `seeked`, from where the element actually is", () => {
    const { container, handle, onTime, media } = setup();
    act(() => media.loadMetadata());
    act(() => handle.current!.seek(12_000));
    expect(clock(container)).toBe("00:00");
    expect(onTime).not.toHaveBeenCalledWith(12_000);
    act(() => media.finishSeek());
    expect(clock(container)).toBe("00:12");
    expect(onTime).toHaveBeenLastCalledWith(12_000);
    expect(toast).not.toHaveBeenCalled();
  });

  it("says so when the jump snaps back instead of faking the position", () => {
    const { container, handle, media } = setup();
    act(() => media.loadMetadata());
    act(() => handle.current!.seek(12_000));
    act(() => media.finishSeek(0));
    expect(clock(container)).toBe("00:00");
    expect(toast).toHaveBeenCalledWith("Couldn't jump to that point", expect.anything());
  });

  it("refuses a jump outside the seekable range with a message", () => {
    const { handle, element, media } = setup();
    Object.defineProperty(element, "seekable", { configurable: true, get: () => ranges([0, 3]) });
    act(() => media.loadMetadata());
    act(() => handle.current!.seek(12_000));
    expect(element.currentTime).toBe(0);
    expect(toast).toHaveBeenCalledWith("Seeking unavailable, loading the full cut…", expect.anything());
  });

  it("queues a seek requested before the metadata arrives", () => {
    const { handle, element, media } = setup();
    act(() => handle.current!.seek(8_000));
    expect(element.currentTime).toBe(0);
    act(() => media.loadMetadata());
    expect(element.currentTime).toBe(8);
  });

  it("jumps to a 0:00 marker", () => {
    const { element, media } = setup([note(0)]);
    act(() => media.loadMetadata());
    element.currentTime = 9;
    act(() => media.finishSeek());
    fireEvent.click(screen.getByRole("button", { name: /Jump to 00:00/ }));
    expect(element.currentTime).toBe(0);
  });

  it("shows the buffering spinner only after a short delay", () => {
    const { container, element, media } = setup();
    act(() => media.loadMetadata());
    act(() => { fireEvent(element, new Event("waiting")); });
    expect(container.querySelector(".rvp-buffering")).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector(".rvp-buffering")).not.toBeNull();
    act(() => { fireEvent(element, new Event("canplay")); });
    expect(container.querySelector(".rvp-buffering")).toBeNull();
  });

  it("draws the buffered range on the scrubber", () => {
    const { container, media } = setup();
    act(() => media.loadMetadata());
    const span = container.querySelector<HTMLElement>(".rvp-buffered");
    expect(span?.style.width).toBe("25%");
  });
});

describe("Player errors", () => {
  it("shows error-specific copy and reloads in place on Retry", () => {
    const { element, media } = setup();
    act(() => media.loadMetadata());
    act(() => media.fail(2));
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    media.state.error = null;
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(element.load).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells a missing proxy apart from a network failure", () => {
    const { media } = setup();
    act(() => media.fail(4));
    expect(screen.getByRole("alert")).toHaveTextContent("Preview not available");
  });
});
