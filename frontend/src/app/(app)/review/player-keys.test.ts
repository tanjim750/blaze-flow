import { afterEach, describe, expect, it } from "vitest";
import { playerShouldIgnoreKey } from "./player-keys";

function keyOn(html: string, selector: string | null, key: string, extra: Partial<KeyboardEvent> = {}) {
  document.body.innerHTML = html;
  const target = selector ? document.querySelector(selector)! : document.body;
  return playerShouldIgnoreKey({ key, target, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, ...extra });
}

afterEach(() => { document.body.innerHTML = ""; });

describe("playerShouldIgnoreKey", () => {
  it("lets shortcuts through when nothing in particular has focus", () => {
    expect(keyOn("", null, " ")).toBe(false);
    expect(keyOn("", null, "ArrowRight")).toBe(false);
    expect(keyOn("", null, "k")).toBe(false);
  });

  it("leaves Space to a focused button or link", () => {
    expect(keyOn("<button>Resolve</button>", "button", " ")).toBe(true);
    expect(keyOn("<a href='/x'>Open</a>", "a", " ")).toBe(true);
    expect(keyOn("<div role='menuitem'>Rename</div>", "[role=menuitem]", " ")).toBe(true);
  });

  it("still steps frames with the arrows from a plain button, e.g. after clicking Play", () => {
    expect(keyOn("<button>Play</button>", "button", "ArrowRight")).toBe(false);
  });

  it("leaves the arrows to sliders, tabs and menus", () => {
    expect(keyOn("<input type='range'>", "input", "ArrowLeft")).toBe(true);
    expect(keyOn("<div role='slider' tabindex='0'></div>", "[role=slider]", "ArrowRight")).toBe(true);
    expect(keyOn("<div role='tablist'><button role='tab'>Fields</button></div>", "[role=tab]", "ArrowRight")).toBe(true);
    expect(keyOn("<div role='menu'><div role='menuitem'>A</div></div>", "[role=menuitem]", "ArrowDown")).toBe(true);
  });

  it("never fires while typing", () => {
    expect(keyOn("<textarea></textarea>", "textarea", "k")).toBe(true);
    expect(keyOn("<input type='text'>", "input", " ")).toBe(true);
    expect(keyOn("<div contenteditable='true'><span>x</span></div>", "span", "j")).toBe(true);
  });

  it("leaves letters to menu type-ahead but not to plain buttons", () => {
    expect(keyOn("<div role='menu'><div role='menuitem'>Mute</div></div>", "[role=menuitem]", "m")).toBe(true);
    expect(keyOn("<button>Play</button>", "button", "m")).toBe(false);
  });

  it("ignores modified or already-handled keys", () => {
    expect(keyOn("", null, "f", { metaKey: true })).toBe(true);
    expect(keyOn("", null, " ", { defaultPrevented: true })).toBe(true);
  });
});
