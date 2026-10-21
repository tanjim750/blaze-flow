import { describe, expect, it } from "vitest";
import { briefIsEmpty, briefToEditorHtml, briefToPlainText, isRichBrief, plainTextToHtml } from "./rich-brief";

describe("rich brief helpers", () => {
  it("tells rich briefs from old plain-text ones", () => {
    expect(isRichBrief("<p>Hi</p>")).toBe(true);
    expect(isRichBrief("  <h2 style=\"text-align: center\">Hi</h2>")).toBe(true);
    expect(isRichBrief("Use <brand> colours")).toBe(false);
    expect(isRichBrief("<b>not a block</b>")).toBe(false);
    expect(isRichBrief(null)).toBe(false);
  });

  it("turns plain text into escaped paragraphs for the editor", () => {
    expect(plainTextToHtml("One\nline\n\nTwo <x> & y")).toBe("<p>One<br>line</p><p>Two &lt;x&gt; &amp; y</p>");
    expect(briefToEditorHtml("<p>Kept</p>")).toBe("<p>Kept</p>");
    expect(briefToEditorHtml("  ")).toBe("");
  });

  it("flattens a brief to one line of text", () => {
    expect(briefToPlainText("<h2>Goal</h2><p>Hook &amp; hold</p><ul><li><p>3s</p></li></ul>")).toBe("Goal Hook & hold 3s");
    expect(briefToPlainText("Plain\n\ntext")).toBe("Plain text");
    expect(briefIsEmpty("<p></p>")).toBe(true);
    expect(briefIsEmpty("<p>x</p>")).toBe(false);
  });
});
