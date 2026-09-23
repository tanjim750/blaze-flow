import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { openUniversalReview, UniversalReviewLayout } from "./universal-review";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("UniversalReviewLayout", () => {
  it("opens programmatic video requests in the shared review workspace", () => {
    render(
      <UniversalReviewLayout pathname="/files">
        <button onClick={() => openUniversalReview({ href: "/review?media=file-1", title: "Hero cut.mov" })}>Open video</button>
      </UniversalReviewLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open video" }));

    expect(screen.getByTitle("Review Hero cut.mov")).toHaveAttribute("src", "/review-embed?media=file-1");
    expect(screen.getByRole("link", { name: "Open full review" })).toHaveAttribute("href", "/review?media=file-1");
    expect(screen.getByRole("slider", { name: "Resize review workspace" })).toBeInTheDocument();
  });

  it("intercepts ordinary review links so server-rendered pages use the same UI", async () => {
    render(
      <UniversalReviewLayout pathname="/deliverables">
        <a href="/review?media=file-2"><h2>Client master.mp4</h2></a>
      </UniversalReviewLayout>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Client master.mp4" }));

    expect(screen.getByTitle("Review Client master.mp4")).toHaveAttribute("src", "/review-embed?media=file-2");
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    await waitFor(() => expect(screen.queryByTitle("Review Client master.mp4")).not.toBeInTheDocument());
  });

  it("gets out of the way when the explicit full review route opens", async () => {
    const rendered = render(
      <UniversalReviewLayout pathname="/files">
        <button onClick={() => openUniversalReview({ href: "/review?media=file-3", title: "Full cut.mov" })}>Open video</button>
      </UniversalReviewLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open video" }));
    expect(screen.getByTitle("Review Full cut.mov")).toBeInTheDocument();

    rendered.rerender(<UniversalReviewLayout pathname="/review"><div>Full review page</div></UniversalReviewLayout>);

    await waitFor(() => expect(screen.queryByTitle("Review Full cut.mov")).not.toBeInTheDocument());
    expect(screen.getByText("Full review page")).toBeInTheDocument();
  });
});
