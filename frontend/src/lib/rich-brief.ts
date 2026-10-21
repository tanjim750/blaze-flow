/**
 * Project briefs are stored either as sanitised HTML from the Brief editor or, for briefs
 * written before rich text, as plain text. The backend (app/rich_text.py) sanitises every
 * rich brief on save; this module only decides how to show one.
 */

// Must match RICH_PREFIX in app/rich_text.py.
const RICH_PREFIX = /^\s*<(p|h[1-3]|ul|ol|blockquote|div)[\s>/]/i;

export function isRichBrief(value: string | null | undefined): boolean {
  return !!value && RICH_PREFIX.test(value);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain-text brief as editor HTML: blank lines split paragraphs, single newlines become <br>. */
export function plainTextToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

/** What the editor should open with, whichever way the brief was stored. */
export function briefToEditorHtml(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return isRichBrief(value) ? value : plainTextToHtml(value);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: " " };

/** The brief as one line of text, for headers and previews. */
export function briefToPlainText(value: string | null | undefined): string {
  if (!value) return "";
  if (!isRichBrief(value)) return value.replace(/\s+/g, " ").trim();
  return value
    .replace(/<(br|\/p|\/h[1-3]|\/li|\/blockquote)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

export function briefIsEmpty(value: string | null | undefined): boolean {
  return !briefToPlainText(value) && !/<input/i.test(value ?? "");
}
