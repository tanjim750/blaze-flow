import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatShellSkeleton } from "./skeleton";

afterEach(cleanup);

describe("ChatShellSkeleton", () => {
  it("keeps the real chat chrome on screen with channel rows and 3–5 message bubbles", () => {
    const { container } = render(<ChatShellSkeleton withThread />);
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search or jump/)).toBeDisabled();
    expect(screen.getByText("With client")).toBeInTheDocument();
    expect(container.querySelectorAll(".ch-sk-row").length).toBeGreaterThanOrEqual(3);
    const bubbles = container.querySelectorAll(".ch-sk-bubble");
    expect(bubbles.length).toBeGreaterThanOrEqual(3);
    expect(bubbles.length).toBeLessThanOrEqual(5);
    expect(container.querySelector(".sk-body")).not.toBeNull();
    expect(screen.queryByText(/Loading chat/)).not.toBeInTheDocument();
  });
});
