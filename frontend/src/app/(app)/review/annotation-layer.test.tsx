import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnnotationElement } from "@/lib/api";
import { AnnotationLayer, type LayerAnnotation, type LayerTool } from "./annotation-layer";

afterEach(cleanup);
beforeAll(() => {
  if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
});

const rect: AnnotationElement = { element_type: "RECTANGLE", geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, style: { color: "#ffcf5a" }, payload: {} };

function Harness({ tool, initial = [], saved = [], onEditSaved, onDeleteSaved }: { tool: LayerTool | null; initial?: AnnotationElement[]; saved?: LayerAnnotation[]; onEditSaved?: (id: string, els: AnnotationElement[]) => void; onDeleteSaved?: (id: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <AnnotationLayer annotations={saved} draft={draft} draftOpacity={1} tool={tool} color="#9b7bff" canDraw onDraft={setDraft} onEditSaved={onEditSaved} onDeleteSaved={onDeleteSaved} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}
function setup(props: Parameters<typeof Harness>[0]) {
  const utils = render(<Harness {...props} />);
  const host = utils.container.querySelector<HTMLElement>(".rvp-layer")!;
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
  const svg = host.querySelector("svg")!;
  const draft = () => JSON.parse(utils.getByTestId("draft").textContent!) as AnnotationElement[];
  const drag = (from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(svg, { clientX: from[0], clientY: from[1], buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: to[0], clientY: to[1], buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: to[0], clientY: to[1], pointerId: 1 });
  };
  return { ...utils, svg, draft, drag };
}

describe("AnnotationLayer", () => {
  it("keeps the tool armed so several shapes join one drawing, in the chosen colour", () => {
    const { drag, draft } = setup({ tool: "ELLIPSE" });
    drag([100, 100], [300, 200]);
    drag([500, 100], [700, 300]);
    expect(draft()).toHaveLength(2);
    expect(draft()[0]).toMatchObject({ element_type: "ELLIPSE", geometry: { x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, style: { color: "#9b7bff" } });
  });

  it("selects a shape, drags it, resizes it from a corner and deletes it", () => {
    const { drag, draft, container } = setup({ tool: "SELECT", initial: [rect] });
    drag([200, 100], [300, 150]); // move by +0.1, +0.1
    expect(draft()[0].geometry).toMatchObject({ width: 0.2, height: 0.2 });
    expect(draft()[0].geometry.x).toBeCloseTo(0.2); expect(draft()[0].geometry.y).toBeCloseTo(0.2);
    expect(container.querySelectorAll(".rvp-grip")).toHaveLength(4);
    drag([400, 200], [500, 300]); // se corner (0.4, 0.4) → (0.5, 0.6)
    expect(draft()[0].geometry.width).toBeCloseTo(0.3); expect(draft()[0].geometry.height).toBeCloseTo(0.4);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(draft()).toHaveLength(0);
  });

  it("Escape deselects without deleting", () => {
    const { drag, container, draft } = setup({ tool: "SELECT", initial: [rect] });
    drag([200, 100], [200, 100]);
    expect(container.querySelector(".rvp-selection")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".rvp-selection")).toBeNull();
    expect(draft()).toHaveLength(1);
  });

  it("undoes and redoes with ⌘Z / ⇧⌘Z", () => {
    const { drag, draft } = setup({ tool: "RECTANGLE" });
    drag([100, 100], [300, 200]);
    drag([400, 100], [600, 200]);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(draft()).toHaveLength(1);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(draft()).toHaveLength(0);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(draft()).toHaveLength(1);
  });

  it("places text inline and edits it on double-click", () => {
    const { svg, draft, container } = setup({ tool: "TEXT" });
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 250, buttons: 1 });
    const input = container.querySelector<HTMLInputElement>(".rvp-text-input")!;
    fireEvent.change(input, { target: { value: "Fix logo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(draft()[0]).toMatchObject({ element_type: "TEXT", payload: { text: "Fix logo" }, style: { color: "#9b7bff" } });
    expect(container.querySelector("text")!.textContent).toBe("Fix logo");
    act(() => { fireEvent.doubleClick(svg, { clientX: 310, clientY: 250 }); });
    const again = container.querySelector<HTMLInputElement>(".rvp-text-input")!;
    expect(again.value).toBe("Fix logo");
    fireEvent.change(again, { target: { value: "Fix the logo" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(draft()[0].payload.text).toBe("Fix the logo");
    expect(draft()).toHaveLength(1);
  });

  it("moves the viewer's own saved drawing and reports the edit; others' drawings stay put", () => {
    const onEditSaved = vi.fn();
    const saved: LayerAnnotation[] = [
      { id: "mine", elements: [rect], opacity: 1, editable: true },
      { id: "theirs", elements: [{ ...rect, geometry: { x: 0.6, y: 0.6, width: 0.2, height: 0.2 } }], opacity: 1, editable: false },
    ];
    const { drag } = setup({ tool: "SELECT", saved, onEditSaved });
    drag([200, 100], [300, 100]);
    expect(onEditSaved).toHaveBeenCalledWith("mine", [expect.objectContaining({ geometry: expect.objectContaining({ x: expect.closeTo(0.2, 5) }) })]);
    drag([700, 350], [800, 400]);
    expect(onEditSaved).toHaveBeenCalledTimes(1);
  });

  it("is click-through when no tool is armed", () => {
    const { container } = setup({ tool: null, initial: [rect] });
    expect(container.querySelector(".rvp-layer.is-armed")).toBeNull();
  });
});
