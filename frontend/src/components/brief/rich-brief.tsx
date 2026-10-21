import { isRichBrief } from "@/lib/rich-brief";
import "./rich-text.css";

/**
 * A brief, read-only. Rich briefs arrive already sanitised by the API (app/rich_text.py
 * re-serialises them from an allow-list), so they render as HTML; older plain-text briefs
 * render as escaped text with their line breaks.
 */
export function RichBrief({ value, className = "" }: { value: string; className?: string }) {
  if (isRichBrief(value)) {
    return <div className={`rt-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: value }} />;
  }
  return <div className={`rt-content is-plain ${className}`.trim()}>{value}</div>;
}
