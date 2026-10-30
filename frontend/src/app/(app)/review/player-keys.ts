/**
 * Whether the review player should leave a keydown alone.
 *
 * The transport shortcuts listen on `window`, so without this they stole keys from
 * whatever had focus: Space on a focused "Resolve" button toggled playback instead of
 * pressing the button, and ←/→ on the volume slider or the Comments/Fields tabs stepped
 * frames instead of moving the control. A focused control keeps the keys it natively
 * owns; everywhere else (the page, the video) the shortcuts still work.
 */
const TEXT_ENTRY = "textarea, select, [contenteditable]:not([contenteditable='false']), input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file])";

/** Controls that Space (and Enter) activate. */
const SPACE_OWNERS = [
  "button", "a[href]", "summary", "input", "select", "textarea",
  "[role=button]", "[role=link]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=tab]",
  "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]", "[role=slider]",
].join(", ");

/** Controls where the arrow keys (and Home/End/Page keys) move something. */
const ARROW_OWNERS = [
  "input", "select", "textarea",
  "[role=slider]", "[role=spinbutton]", "[role=scrollbar]", "[role=tab]", "[role=tablist]",
  "[role=menu]", "[role=menubar]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
  "[role=radio]", "[role=radiogroup]", "[role=listbox]", "[role=option]", "[role=combobox]",
  "[role=tree]", "[role=treeitem]", "[role=grid]",
].join(", ");

/** Popups with type-ahead, where a letter key selects an item. */
const TYPEAHEAD_OWNERS = "[role=menu], [role=menubar], [role=listbox], [role=combobox]";

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function playerShouldIgnoreKey(event: Pick<KeyboardEvent, "key" | "target" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented">): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
  const node = event.target;
  if (!(node instanceof Element)) return false;
  if (node.closest(TEXT_ENTRY)) return true;
  if (event.key === " " || event.key === "Enter") return Boolean(node.closest(SPACE_OWNERS));
  if (ARROW_KEYS.has(event.key)) return Boolean(node.closest(ARROW_OWNERS));
  if (event.key.length === 1) return Boolean(node.closest(TYPEAHEAD_OWNERS));
  return false;
}
