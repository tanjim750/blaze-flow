import { timecode } from "./timecode";

/**
 * How long a drawing stays on screen.
 *
 * Every drawing has a window, stored as the annotation's own `start_time_ms`/`end_time_ms`:
 *
 * - `end === start` — "just this frame". Shown only while the player is paused on it,
 *   which is how Frame.io treats every annotation.
 * - `end > start` — held: shown for the whole window, playing or paused, then faded out.
 * - no end — a drawing saved before durations existed. It gets the default hold, so old
 *   notes behave like new ones instead of flashing past.
 *
 * A note's own `end_time_ms` is separate and only set for an in/out range note ("this
 * whole shot"); its drawing then spans the same range.
 */

export const DEFAULT_HOLD_MS = 5000;
export const HOLD_PRESETS_MS = [3000, 5000, 10000] as const;
/** How far either side of the drawn frame still counts as "on it" (a seek rarely lands exactly). */
export const FRAME_TOLERANCE_MS = 80;
/** The last stretch of a held window, where the drawing fades instead of vanishing. */
export const FADE_MS = 500;

export type HoldChoice =
  | { kind: "frame" }
  | { kind: "hold"; ms: number }
  /** In/out points: the drawing and the note itself both cover `[start, endMs]`. */
  | { kind: "range"; endMs: number };

export const DEFAULT_HOLD: HoldChoice = { kind: "hold", ms: DEFAULT_HOLD_MS };

export type DisplayWindow = { startMs: number; endMs: number; frameOnly: boolean };

/** The window an annotation is shown in, or null for one not pinned to a time (shown throughout). */
export function displayWindow(startMs: number | null, endMs: number | null | undefined): DisplayWindow | null {
  if (startMs === null || !Number.isFinite(startMs)) return null;
  if (endMs === null || endMs === undefined || !Number.isFinite(endMs) || endMs < startMs) {
    return { startMs, endMs: startMs + DEFAULT_HOLD_MS, frameOnly: false };
  }
  return { startMs, endMs, frameOnly: endMs === startMs };
}

/**
 * How visible a drawing is at `positionMs`: 1 inside its window, easing to 0 over the last
 * `FADE_MS` (only while playing; paused, a frame inside the window shows it fully), 0 outside.
 */
export function windowOpacity(window: DisplayWindow | null, positionMs: number, playing: boolean): number {
  if (!window) return 1;
  const { startMs, endMs, frameOnly } = window;
  if (frameOnly) return !playing && Math.abs(positionMs - startMs) <= FRAME_TOLERANCE_MS ? 1 : 0;
  if (positionMs < startMs - FRAME_TOLERANCE_MS || positionMs > endMs) return 0;
  if (!playing) return 1;
  const left = endMs - positionMs;
  const fade = Math.min(FADE_MS, (endMs - startMs) / 2);
  return left >= fade ? 1 : Math.max(0, left / fade);
}

/** The `end_time_ms` to save on the drawing for a choice, kept inside the media's length. */
export function drawingEndMs(startMs: number, choice: HoldChoice, durationMs = 0): number {
  const cap = (ms: number) => (durationMs > startMs ? Math.min(ms, Math.round(durationMs)) : ms);
  if (choice.kind === "frame") return Math.round(startMs);
  if (choice.kind === "hold") return cap(Math.round(startMs + choice.ms));
  return cap(Math.round(Math.max(startMs, choice.endMs)));
}

/** The note's own out point: only a range choice makes the note a range note. */
export function noteEndMs(startMs: number | null, choice: HoldChoice | null): number | null {
  if (startMs === null || !choice || choice.kind !== "range" || choice.endMs <= startMs) return null;
  return Math.round(choice.endMs);
}

/** Whether a range choice is usable: its out point has to come after the in point. */
export function validChoice(startMs: number, choice: HoldChoice): boolean {
  return choice.kind !== "range" || choice.endMs > startMs;
}

/** "00:02–00:07", or just "00:02" when there is no span to show. */
export function rangeLabel(startMs: number, endMs: number | null | undefined): string {
  if (endMs === null || endMs === undefined || endMs <= startMs) return timecode(startMs);
  return `${timecode(startMs)}–${timecode(endMs)}`;
}

/** "5s", "2.5s", "1 frame": the short duration shown on the picker and the note. */
export function holdLabel(window: DisplayWindow): string {
  if (window.frameOnly) return "1 frame";
  const seconds = (window.endMs - window.startMs) / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

const STORE_KEY = "bf.review.hold.v1";

/** The reviewer's last preset, so the picker opens where they left it. Ranges are per note. */
export function rememberedHold(): HoldChoice {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as HoldChoice) : null;
    if (parsed?.kind === "frame") return parsed;
    if (parsed?.kind === "hold" && Number.isFinite(parsed.ms) && parsed.ms > 0 && parsed.ms <= 600_000) return parsed;
  } catch { /* storage blocked or garbage */ }
  return DEFAULT_HOLD;
}

export function rememberHold(choice: HoldChoice) {
  if (choice.kind === "range") return;
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(choice)); } catch { /* storage blocked */ }
}

/** Parses "7", "7.5", "0:07" or "00:07.5" as milliseconds; null when it is not a time. */
export function parseTime(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 2 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}
