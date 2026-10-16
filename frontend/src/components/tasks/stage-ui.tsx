"use client";
/**
 * Small presentational pieces shared by the board, list and detail sheet: stage dot and
 * pill, the signal-style priority icon, the assignee avatar and the due-date chip.
 */
import type { CSSProperties } from "react";
import { CalendarDays, CircleCheck, CircleDashed, CircleDot, Clock, Eye, RotateCcw, Signal, SignalHigh, SignalLow, SignalMedium, TriangleAlert, UserRound, Users, type LucideIcon } from "lucide-react";
import { StagePill as SharedStagePill } from "@/components/ui/stage-pill";
import { dueState, formatDue, formatDueLong, initials, priorityLabel, stageTone, type BoardStage, type StageKind } from "@/lib/task-board";

const STAGE_ICONS: Record<StageKind, LucideIcon> = {
  todo: CircleDashed, in_progress: CircleDot, review: Eye, client_review: Users, revisions: RotateCcw, approved: CircleCheck, custom: Signal,
};

export function StageDot({ stage }: { stage: Pick<BoardStage, "kind" | "color"> }) {
  return <i className="tb-stage-dot" aria-hidden="true" style={{ "--tb-dot": stageTone(stage).dot } as CSSProperties} />;
}

/** Icon + label in the stage tone. Custom stages keep neutral text with a coloured dot. */
export function StagePill({ stage }: { stage: BoardStage }) {
  const { tone, dot } = stageTone(stage);
  return <SharedStagePill name={stage.name} tone={tone} dot={dot} icon={tone ? STAGE_ICONS[stage.kind] : null} />;
}

export function StageIcon({ stage }: { stage: BoardStage }) {
  const Icon = STAGE_ICONS[stage.kind];
  return <Icon aria-hidden="true" className="tb-stage-icon" style={{ color: stageTone(stage).dot } as CSSProperties} />;
}

const PRIORITY_ICONS: Record<string, LucideIcon> = { LOW: SignalLow, MEDIUM: SignalMedium, HIGH: SignalHigh, URGENT: TriangleAlert };

/** Signal bars (low / medium / high) in muted ink, so priority never competes with stage colour. */
export function PriorityIcon({ priority, withLabel = false }: { priority: string; withLabel?: boolean }) {
  const Icon = PRIORITY_ICONS[priority] ?? SignalMedium;
  const label = `${priorityLabel(priority)} priority`;
  return <span className={`tb-priority is-${priority.toLowerCase()}`} title={withLabel ? undefined : label}>
    <Icon aria-hidden="true" />{withLabel ? priorityLabel(priority) : <span className="tb-sr">{label}</span>}
  </span>;
}

export function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" }) {
  return name
    ? <span className={`tb-avatar is-${size}`} title={name}>{initials(name)}</span>
    : <span className={`tb-avatar is-${size} is-empty`} title="Unassigned"><UserRound aria-hidden="true" /></span>;
}

export function DueChip({ dueAt, done, now }: { dueAt: string | null; done: boolean; now?: number }) {
  const state = dueState(dueAt, done, now);
  if (state === "none") return null;
  const Icon = state === "overdue" ? Clock : CalendarDays;
  const label = formatDue(dueAt, now);
  return <time dateTime={dueAt!} className={`tb-due is-${state}`} title={`Due ${formatDueLong(dueAt)}`}>
    <Icon aria-hidden="true" />{state === "overdue" ? <><span className="tb-sr">Overdue, due </span>{label}</> : label}
  </time>;
}
