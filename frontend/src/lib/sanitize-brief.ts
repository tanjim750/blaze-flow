import DOMPurify from "isomorphic-dompurify";

/**
 * Second line of defence for rich briefs. The API already re-serialises every brief from an
 * allow-list (app/rich_text.py); this runs the same allow-list again right before the HTML is
 * injected, so a row that skipped the backend sanitiser (an old row, a bulk update, a bug)
 * still can't run script. Keep ALLOWED_TAGS/ATTR in step with app/rich_text.py.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "del", "strike", "h1", "h2", "h3",
  "ul", "ol", "li", "blockquote", "a", "label", "input", "span", "div", "code", "hr",
];
const ALLOWED_ATTR = ["href", "target", "rel", "style", "data-type", "data-checked", "start", "type", "checked", "disabled"];
const SAFE_URI = /^(?:https?:|mailto:)/i;
const SAFE_STYLE = /^\s*text-align\s*:\s*(left|center|right|justify)\s*;?\s*$/i;

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    // data-* is only on for the task-list markers; every other data attribute goes.
    if (data.attrName.startsWith("data-") && !["data-type", "data-checked"].includes(data.attrName)) data.keepAttr = false;
    if (data.attrName === "style" && !SAFE_STYLE.test(data.attrValue)) data.keepAttr = false;
    if (data.attrName === "type" && !(node.nodeName === "INPUT" && data.attrValue === "checkbox")) data.keepAttr = false;
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (node.nodeName === "INPUT") {
      node.setAttribute("type", "checkbox");
      node.setAttribute("disabled", "disabled");
    }
  });
}

export function sanitizeBriefHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: SAFE_URI, ALLOW_DATA_ATTR: true,
  });
}
