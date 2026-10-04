import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openUniversalReview, REVIEW_FROM_KEY, UniversalReviewLayout } from "./universal-review";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("UniversalReviewLayout", () => {
  it("opens review as a full page and carries the current page as the way back", () => {
    window.history.replaceState(null, "", "/files?folder=f1&q=hero");
    render(
      <UniversalReviewLayout pathname="/files">
        <button onClick={() => openUniversalReview({ href: "/review?media=file-1", title: "Hero cut.mov" })}>Open video</button>
      </UniversalReviewLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open video" }));
    expect(push).toHaveBeenCalledWith("/review?media=file-1&from=%2Ffiles%3Ffolder%3Df1%26q%3Dhero");
    expect(window.sessionStorage.getItem(REVIEW_FROM_KEY)).toBe("/files?folder=f1&q=hero");
    // No split pane or iframe any more: review is never squeezed beside the page.
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("keeps an explicit way back that the link already has", () => {
    render(
      <UniversalReviewLayout pathname="/tasks">
        <button onClick={() => openUniversalReview({ href: "/review?media=f&from=%2Ftasks%3Fq%3Dx" })}>Open</button>
      </UniversalReviewLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/review?media=f&from=%2Ftasks%3Fq%3Dx");
  });

  it("ignores anything that is not a review link", () => {
    render(
      <UniversalReviewLayout pathname="/files">
        <button onClick={() => openUniversalReview({ href: "https://evil.example/review?media=x" })}>Open</button>
      </UniversalReviewLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("remembers where a plain review link was clicked from", () => {
    window.history.replaceState(null, "", "/?view=editor");
    render(
      <UniversalReviewLayout pathname="/">
        <a href="/review?media=file-2" onClick={(event) => event.preventDefault()}>Note</a>
      </UniversalReviewLayout>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Note" }));
    expect(window.sessionStorage.getItem(REVIEW_FROM_KEY)).toBe("/?view=editor");
  });
});
