import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import type { Editor } from "@tiptap/react";
import { BriefEditor, normaliseLink } from "./brief-editor";
import { RichBrief } from "./rich-brief";

async function mount(value = "") {
  const onChange = vi.fn();
  render(<BriefEditor id="b" label="Brief" placeholder="Write…" value={value} onChange={onChange} />);
  await act(async () => { await Promise.resolve(); });
  const box = screen.getByRole("textbox", { name: "Brief" }) as HTMLElement & { editor: Editor };
  return { box, editor: box.editor, onChange };
}

function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (fn) => fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

describe("BriefEditor", () => {
  it("has a labelled toolbar with every formatting tool", async () => {
    await mount();
    const names = ["Undo", "Redo", "Heading 1", "Heading 2", "Heading 3", "Bold", "Italic", "Underline", "Strikethrough",
      "Bulleted list", "Numbered list", "Checklist", "Quote", "Link", "Align left", "Align centre", "Align right", "Justify"];
    for (const name of names) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("toolbar buttons format the selection and report HTML", async () => {
    const { editor, onChange } = await mount("<p>Hello</p>");
    act(() => { editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenLastCalledWith("<p><strong>Hello</strong></p>");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Align centre" }));
    expect(onChange).toHaveBeenLastCalledWith('<h2 style="text-align: center;"><strong>Hello</strong></h2>');
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // Quick successive edits undo as one step, like Word.
    expect(editor.getHTML()).toBe("<p><strong>Hello</strong></p>");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(editor.getHTML()).toBe('<h2 style="text-align: center;"><strong>Hello</strong></h2>');
  });

  it("supports Ctrl/Cmd shortcuts", async () => {
    const { box, editor } = await mount("<p>Hello</p>");
    act(() => { editor.commands.selectAll(); });
    fireEvent.keyDown(box, { key: "i", ctrlKey: true });
    fireEvent.keyDown(box, { key: "u", ctrlKey: true });
    expect(editor.getHTML()).toBe("<p><em><u>Hello</u></em></p>");
  });

  it("turns markdown-style typing into lists, headings and quotes", async () => {
    const { editor } = await mount();
    act(() => { editor.commands.focus(); type(editor, "- Hook"); });
    expect(editor.getHTML().replace(/<p><\/p>$/, "")).toBe("<ul><li><p>Hook</p></li></ul>");
    act(() => { editor.commands.setContent("<p></p>"); editor.commands.focus(); type(editor, "## Goal"); });
    expect(editor.getHTML().replace(/<p><\/p>$/, "")).toBe("<h2>Goal</h2>");
    act(() => { editor.commands.setContent("<p></p>"); editor.commands.focus(); type(editor, "1. One"); });
    expect(editor.getHTML().replace(/<p><\/p>$/, "")).toBe("<ol><li><p>One</p></li></ol>");
    act(() => { editor.commands.setContent("<p></p>"); editor.commands.focus(); type(editor, "> Said"); });
    expect(editor.getHTML().replace(/<p><\/p>$/, "")).toBe("<blockquote><p>Said</p></blockquote>");
  });

  it("adds links only for web and mail addresses", async () => {
    const { editor } = await mount("<p>Site</p>");
    act(() => { editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const input = screen.getByLabelText("Link address");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/web address/);
    fireEvent.change(input, { target: { value: "blaze.test/brief" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(editor.getHTML()).toContain('href="https://blaze.test/brief"');
    expect(normaliseLink("me@studio.test")).toBe("mailto:me@studio.test");
    expect(normaliseLink("data:text/html,x")).toBeNull();
  });

  it("reports an emptied brief as an empty string", async () => {
    const { editor, onChange } = await mount("<p>x</p>");
    act(() => { editor.commands.clearContent(true); });
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("RichBrief", () => {
  it("renders rich briefs as HTML and plain briefs as text", () => {
    const { container, rerender } = render(<RichBrief value='<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" disabled checked></label><div><p>Done</p></div></li></ul>' />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    rerender(<RichBrief value={"Use <brand> colours\nnext line"} />);
    expect(container.textContent).toBe("Use <brand> colours\nnext line");
    expect(container.querySelector(".is-plain")).not.toBeNull();
  });
});
