import { isRichBrief } from "@/lib/rich-brief";
import { sanitizeBriefHtml } from "@/lib/sanitize-brief";
import "./rich-text.css";

/**
 * A brief, read-only. Rich briefs arrive already sanitised by the API (app/rich_text.py
 * re-serialises them from an allow-list) and are sanitised again here with DOMPurify before
 * they are injected, so a brief that ever skipped the backend still can't run script. Older
 * plain-text briefs render as escaped text with their line breaks.
 */
export function RichBrief({ value, className = "" }: { value: string; className?: string }) {
  if (isRichBrief(value)) {
    return <div className={`rt-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: sanitizeBriefHtml(value) }} />;
  }
  return <div className={`rt-content is-plain ${className}`.trim()}>{value}</div>;
}
