import { afterEach, describe, expect, it } from "vitest";
import { clearDraft, draftKey, hasContent, loadDraft, patchDraft, unsavedWarning } from "./review-drafts";

afterEach(() => window.localStorage.clear());

describe("review drafts", () => {
  it("keeps a draft per cut and restores it", () => {
    patchDraft("v2", { text: "Logo is late", anchorMs: 4200, visibility: "team" });
    patchDraft("v3", { text: "Other cut" });
    expect(loadDraft("v2")).toMatchObject({ text: "Logo is late", anchorMs: 4200, visibility: "team", pinned: true });
    expect(loadDraft("v3")?.text).toBe("Other cut");
  });

  it("merges the drawing and the text without either clobbering the other", () => {
    patchDraft("v2", { text: "Here" });
    patchDraft("v2", { annotation: { element_type: "POINT", geometry: { x: 0.1, y: 0.2 }, style: {}, payload: {} } });
    const draft = loadDraft("v2");
    expect(draft?.text).toBe("Here");
    expect(draft?.annotation?.element_type).toBe("POINT");
  });

  it("drops the entry once nothing is left to keep", () => {
    patchDraft("v2", { text: "x" });
    patchDraft("v2", { text: "   " });
    expect(window.localStorage.getItem(draftKey("v2"))).toBeNull();
    patchDraft("v2", { text: "y" });
    clearDraft("v2");
    expect(loadDraft("v2")).toBeNull();
  });

  it("ignores corrupt or empty entries", () => {
    window.localStorage.setItem(draftKey("bad"), "{not json");
    expect(loadDraft("bad")).toBeNull();
    window.localStorage.setItem(draftKey("empty"), JSON.stringify({ text: "", pinned: false }));
    expect(loadDraft("empty")).toBeNull();
    expect(hasContent({ text: "", annotation: null })).toBe(false);
  });

  it("says what leaving would cost, or nothing", () => {
    expect(unsavedWarning({ text: false, annotation: false, recording: false, revision: false, localNotes: 0 })).toBeNull();
    expect(unsavedWarning({ text: true, annotation: false, recording: false, revision: false, localNotes: 0 })).toMatch(/comment is saved as a draft/);
    expect(unsavedWarning({ text: false, annotation: false, recording: false, revision: false, localNotes: 2 })).toMatch(/2 notes on this file are only kept for this session/);
    expect(unsavedWarning({ text: false, annotation: false, recording: true, revision: false, localNotes: 0 })).toMatch(/recording/);
  });
});
