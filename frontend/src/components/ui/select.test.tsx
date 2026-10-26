import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => cleanup());
import { Select } from "./select";

const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }];

describe("Select", () => {
  it("opens a themed listbox, picks with the keyboard and mirrors the value into the form", () => {
    const { container } = render(<form><Select name="pick" aria-label="Pick" placeholder="Choose…" options={options} required /></form>);
    const trigger = screen.getByRole("combobox", { name: "Pick" });
    expect(trigger).toHaveTextContent("Choose…");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(trigger).toHaveTextContent("Bravo");
    expect(container.querySelector<HTMLInputElement>("input[name=pick]")!.value).toBe("b");
  });

  it("filters long lists with a search box and marks the selected option", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Project ${i}` }));
    render(<Select aria-label="Project" defaultValue="3" options={many} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
    expect(screen.getByRole("option", { name: "Project 3" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "Search options" }), { target: { value: "11" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
