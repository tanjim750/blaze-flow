import { describe, expect, it } from "vitest";
import { sanitizeBriefHtml } from "./sanitize-brief";

describe("sanitizeBriefHtml", () => {
  it("keeps the editor's formatting", () => {
    const html = '<p style="text-align: center"><strong>Hi</strong> <a href="https://x.test">link</a></p><ul data-type="taskList"><li data-checked="true"><input type="checkbox" checked>Do</li></ul>';
    const out = sanitizeBriefHtml(html);
    expect(out).toContain('<strong>Hi</strong>');
    expect(out).toContain('href="https://x.test"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('style="text-align: center"');
    expect(out).toContain('data-type="taskList"');
  });
  it("strips script, handlers and dangerous URLs", () => {
    const out = sanitizeBriefHtml('<p onclick="x()">a<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">b</a><span style="background:url(x)" data-x="1">c</span></p><iframe src="https://evil"></iframe>');
    expect(out).not.toMatch(/script|onerror|onclick|javascript:|iframe|<img|background|data-x/i);
    expect(out).toContain("a");
  });
});
