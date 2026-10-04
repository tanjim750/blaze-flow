import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StagePill as FilesStagePill } from "@/components/files/files-ui";
import { StagePill as BoardStagePill } from "@/components/tasks/stage-ui";

afterEach(cleanup);

describe("one stage pill", () => {
  it("Files and Tasks render the same component and class", () => {
    render(<>
      <FilesStagePill stage={{ name: "Internal QA", color: "#4ba3ff", kind: "review" }} />
      <BoardStagePill stage={{ id: "s", name: "Review", color: "#4ba3ff", kind: "review", isDone: false, wipLimit: null, automationEnabled: true }} />
    </>);
    const files = screen.getByText("Internal QA");
    const board = screen.getByText("Review");
    expect(files).toHaveClass("bf-stage-pill");
    expect(board).toHaveClass("bf-stage-pill");
    expect(files.className).toBe(board.className);
  });

  it("shows a custom stage as neutral with its own colour as the dot", () => {
    render(<FilesStagePill stage={{ name: "Colour grade", color: "#ff00aa" }} />);
    const pill = screen.getByText("Colour grade");
    expect(pill).toHaveClass("is-custom");
    expect(pill.style.getPropertyValue("--pill-dot")).toBe("#ff00aa");
  });
});
