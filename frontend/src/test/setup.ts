import "@testing-library/jest-dom/vitest";

// jsdom ships no object-URL implementation, and the upload and download paths
// both call it, so give tests an inert stand-in.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
}




// Floating UI (under every Radix popover, so the themed Select too) probes each ancestor
// with `matches(":popover-open")` / `matches(":modal")` on every position update. jsdom's
// selector engine cannot parse those, throws, and never caches the failure, which made a
// test that opens a Select inside a large tree take minutes. Answer them directly.
if (typeof Element !== "undefined") {
  const nativeMatches = Element.prototype.matches;
  Element.prototype.matches = function matches(this: Element, selector: string) {
    if (selector === ":popover-open" || selector === ":modal") return false;
    return nativeMatches.call(this, selector);
  };
}
