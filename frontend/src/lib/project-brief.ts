/**
 * Pure helpers for the Brief & Specs tab: the spec vocabulary, how specs read as chips,
 * date-input round-tripping, and whether a cut matches the specs. Shared by the tab, the
 * review header's mismatch chip and the tests.
 */

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5"] as const;
export const PLATFORMS = ["YouTube", "Instagram", "TikTok", "TV", "Other"] as const;
// What `PriorityLevel` accepts on the API.
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type Platform = (typeof PLATFORMS)[number];

export type DeliverableSpecs = {
  aspect_ratio: AspectRatio | null;
  target_length_seconds: number | null;
  platform: Platform | null;
  resolution: string | null;
  notes: string | null;
};

export const EMPTY_SPECS: DeliverableSpecs = { aspect_ratio: null, target_length_seconds: null, platform: null, resolution: null, notes: null };

export function normalizeSpecs(value: unknown): DeliverableSpecs {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (item: unknown) => (typeof item === "string" && item.trim() ? item.trim() : null);
  const aspect = str(raw.aspect_ratio);
  const platform = str(raw.platform);
  const length = typeof raw.target_length_seconds === "number" && raw.target_length_seconds > 0 ? Math.round(raw.target_length_seconds) : null;
  return {
    aspect_ratio: (ASPECT_RATIOS as readonly string[]).includes(aspect ?? "") ? aspect as AspectRatio : null,
    target_length_seconds: length,
    platform: (PLATFORMS as readonly string[]).includes(platform ?? "") ? platform as Platform : null,
    resolution: str(raw.resolution),
    notes: str(raw.notes),
  };
}

const ASPECT_NAMES: Record<AspectRatio, string> = { "16:9": "Landscape", "9:16": "Vertical", "1:1": "Square", "4:5": "Portrait" };
export const aspectName = (ratio: AspectRatio) => ASPECT_NAMES[ratio];

/** 30 → "30s", 90 → "1:30", 3600 → "1:00:00". */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1:30", "90", "90s", "1m30s" → 90. Null for blank; NaN for nonsense. */
export function parseLength(input: string): number | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?\s*s?$/.test(value)) return Math.round(parseFloat(value));
  const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const words = value.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/);
  if (words && (words[1] || words[2])) return Number(words[1] ?? 0) * 60 + Number(words[2] ?? 0);
  return Number.NaN;
}

export type SpecChip = { key: keyof DeliverableSpecs; label: string; title: string };

/** The specs as short chips, in reading order, skipping anything unset. */
export function specChips(specs: DeliverableSpecs): SpecChip[] {
  const chips: SpecChip[] = [];
  if (specs.aspect_ratio) chips.push({ key: "aspect_ratio", label: `${specs.aspect_ratio} ${aspectName(specs.aspect_ratio).toLowerCase()}`, title: "Aspect ratio" });
  if (specs.target_length_seconds) chips.push({ key: "target_length_seconds", label: formatLength(specs.target_length_seconds), title: "Target length" });
  if (specs.platform) chips.push({ key: "platform", label: specs.platform, title: "Platform" });
  if (specs.resolution) chips.push({ key: "resolution", label: specs.resolution.replace(/\s*[x×]\s*/i, "×"), title: "Resolution" });
  return chips;
}

/** An ISO timestamp as the `YYYY-MM-DD` a date input shows, in `timeZone` (browser's by default). */
export function toDateInput(iso: string | null, timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** A date input's value back to an ISO timestamp at midday UTC, so no zone moves it a day. */
export function fromDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T12:00:00Z`;
}

export function dueLabel(iso: string | null, now: Date, timeZone?: string): { text: string; tone: "none" | "overdue" | "soon" | "later" } {
  if (!iso) return { text: "No due date", tone: "none" };
  const day = toDateInput(iso, timeZone);
  const today = toDateInput(now.toISOString(), timeZone);
  const diff = Math.round((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
  const formatted = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  if (diff < 0) return { text: `${formatted} · ${-diff === 1 ? "1 day" : `${-diff} days`} overdue`, tone: "overdue" };
  if (diff === 0) return { text: `${formatted} · today`, tone: "soon" };
  if (diff <= 7) return { text: `${formatted} · in ${diff === 1 ? "1 day" : `${diff} days`}`, tone: "soon" };
  return { text: formatted, tone: "later" };
}

const RATIO_VALUE: Record<AspectRatio, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

/** The nearest named ratio for a frame size, or "W:H" reduced when none is close. */
export function describeAspect(width: number, height: number): string {
  const ratio = width / height;
  const named = ASPECT_RATIOS.find((item) => Math.abs(RATIO_VALUE[item] - ratio) / RATIO_VALUE[item] < 0.03);
  if (named) return named;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

export type SpecMismatch = { key: "aspect_ratio" | "target_length_seconds"; message: string; short: string };

/**
 * Where a cut differs from the brief. Aspect allows 3% (encoders round odd sizes); length
 * allows the larger of 1 second or 5%, because a 30s spot that runs 30.4s is on spec.
 */
export function specMismatches(specs: DeliverableSpecs | null, media: { width: number; height: number; durationMs: number } | null): SpecMismatch[] {
  if (!specs || !media) return [];
  const out: SpecMismatch[] = [];
  if (specs.aspect_ratio && media.width > 0 && media.height > 0) {
    const want = RATIO_VALUE[specs.aspect_ratio];
    const have = media.width / media.height;
    if (Math.abs(have - want) / want >= 0.03) {
      const actual = describeAspect(media.width, media.height);
      out.push({ key: "aspect_ratio", message: `Brief asks for ${specs.aspect_ratio}; this cut is ${actual}`, short: `${actual}, spec ${specs.aspect_ratio}` });
    }
  }
  if (specs.target_length_seconds && media.durationMs > 0) {
    const target = specs.target_length_seconds;
    const actual = media.durationMs / 1000;
    const tolerance = Math.max(1, target * 0.05);
    if (Math.abs(actual - target) > tolerance) {
      out.push({ key: "target_length_seconds", message: `Brief asks for ${formatLength(target)}; this cut runs ${formatLength(actual)}`, short: `${formatLength(actual)}, spec ${formatLength(target)}` });
    }
  }
  return out;
}
