/**
 * The one stage pill (Files, Tasks board and list, task sheet, stage dialogs).
 *
 * A known stage shows its tone — icon or dot plus label on a 14% tint of the tone. A
 * custom stage is neutral, with the workspace's own colour as a dot only, because an
 * arbitrary hex can't be relied on for 4.5:1 text. Styles: `.bf-stage-pill` in app/ui.css,
 * sized by `--bf-pill-height`.
 */
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export function StagePill({ name, tone, dot, icon: Icon, dataTone }: {
  name: string;
  /** CSS colour for a known stage (a token); null/undefined for a custom stage. */
  tone?: string | null;
  /** Dot colour; for a custom stage, the workspace's colour. */
  dot?: string | null;
  /** Draws the stage's icon instead of the dot. */
  icon?: LucideIcon | null;
  /** `[data-tone]` hook for screens that theme tones by attribute. */
  dataTone?: string;
}) {
  const style = { "--pill-tone": tone ?? undefined, "--pill-dot": dot ?? undefined } as CSSProperties;
  return (
    <span className={`bf-stage-pill ${tone ? "" : "is-custom"}`} data-tone={dataTone} style={style}>
      {Icon ? <Icon aria-hidden="true" /> : <i aria-hidden="true" />}
      {name}
    </span>
  );
}
