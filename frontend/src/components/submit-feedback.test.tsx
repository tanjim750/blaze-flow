import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SubmitFeedback } from "./submit-feedback";

const frames = () => act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));

function Form({ disables }: { disables: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (disables) setBusy(true); }}>
      <button type="submit" disabled={busy}>Save</button>
      <button type="button" onClick={() => setBusy(false)}>done</button>
    </form>
  );
}

describe("SubmitFeedback", () => {
  it("spins the submitter while it is disabled, and stops when it is enabled again", async () => {
    const { container } = render(<><SubmitFeedback /><Form disables /></>);
    const [save, done] = container.querySelectorAll("button");
    await act(async () => { save.click(); });
    await frames();
    expect(save.getAttribute("aria-busy")).toBe("true");
    await act(async () => { done.click(); });
    await frames();
    expect(save.hasAttribute("aria-busy")).toBe(false);
  });

  it("never spins a button that did not start any work", async () => {
    const { container } = render(<><SubmitFeedback /><Form disables={false} /></>);
    const save = container.querySelector("button")!;
    await act(async () => { save.click(); });
    await frames();
    expect(save.hasAttribute("aria-busy")).toBe(false);
  });
});
