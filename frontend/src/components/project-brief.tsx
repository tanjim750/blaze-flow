"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Check, Clapperboard, Flag, Loader2, Lock, Monitor, RotateCcw, Ruler, Timer } from "lucide-react";
import type { Project } from "@/lib/api";
import {
  ASPECT_RATIOS, EMPTY_SPECS, PLATFORMS, PRIORITIES, aspectName, dueLabel, formatLength, fromDateInput, normalizeSpecs,
  parseLength, specChips, toDateInput, type AspectRatio, type DeliverableSpecs, type Platform,
} from "@/lib/project-brief";

type Patch = { description?: string | null; due_at?: string | null; priority?: string; deliverable_specs?: Partial<DeliverableSpecs> };
type SaveState = { status: "idle" | "saving" | "saved" | "error"; message: string | null };

/** Text fields wait for a pause in typing; picks and dates save almost at once. */
const TYPING_DELAY = 800;
const PICK_DELAY = 150;

function csrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

function mergePatch(into: Patch, next: Patch): Patch {
  return {
    ...into, ...next,
    ...(into.deliverable_specs || next.deliverable_specs ? { deliverable_specs: { ...into.deliverable_specs, ...next.deliverable_specs } } : {}),
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.detail === "string") return body.detail;
    const first = Object.values(body).flat()[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") return String(Object.values(first as Record<string, unknown>).flat()[0] ?? "");
  } catch { /* fall through */ }
  return response.status === 403 ? "You no longer have permission to edit this project." : `Saving failed (${response.status}).`;
}

/**
 * Debounced autosave over `PATCH projects/<id>/`. Changes queue into one patch; only one
 * request is in flight at a time, and anything typed meanwhile goes out right after it.
 */
function useAutosave(workspaceId: string, projectId: string) {
  const [state, setState] = useState<SaveState>({ status: "idle", message: null });
  const pending = useRef<Patch>({});
  const failed = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (busy.current) return;
    busy.current = true;
    // Keep sending until nothing typed during a request is left waiting.
    while (Object.keys(pending.current).length) {
      const patch = pending.current;
      pending.current = {};
      setState({ status: "saving", message: null });
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error(await readError(response));
        failed.current = {};
        setState({ status: "saved", message: null });
      } catch (caught) {
        failed.current = mergePatch(failed.current, patch);
        setState({ status: "error", message: caught instanceof Error && caught.message ? caught.message : "Can’t reach Blaze Flow. Your change isn’t saved yet." });
        break;
      }
    }
    busy.current = false;
  }, [projectId, workspaceId]);

  const queue = useCallback((patch: Patch, delay: number) => {
    pending.current = mergePatch(pending.current, patch);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [flush]);

  const retry = useCallback(() => {
    pending.current = mergePatch(failed.current, pending.current);
    void flush();
  }, [flush]);

  // Leaving the tab (or the page) sends whatever is still waiting on the debounce.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (!Object.keys(pending.current).length) return;
    void fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/`, {
      method: "PATCH", credentials: "include", keepalive: true,
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify(pending.current),
    }).catch(() => undefined);
  }, [projectId, workspaceId]);

  return { state, queue, flush, retry };
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.status === "saving") return <span className="br-save" role="status"><Loader2 size={13} className="br-spin" />Saving…</span>;
  if (state.status === "saved") return <span className="br-save is-saved" role="status"><Check size={13} />Saved</span>;
  if (state.status === "error") {
    return <span className="br-save is-error" role="alert"><AlertCircle size={13} />{state.message}<button type="button" onClick={onRetry}><RotateCcw size={12} />Retry</button></span>;
  }
  return <span className="br-save is-idle">Changes save automatically</span>;
}

function AspectGlyph({ ratio }: { ratio: AspectRatio }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 14 / Math.max(w, h);
  return <i className="br-glyph" style={{ width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` }} aria-hidden="true" />;
}

const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export function SpecChips({ specs, empty = null }: { specs: DeliverableSpecs; empty?: React.ReactNode }) {
  const chips = specChips(specs);
  if (!chips.length) return <>{empty}</>;
  return (
    <ul className="br-chips" aria-label="Deliverable specs">
      {chips.map((chip) => (
        <li key={chip.key} title={chip.title}>
          {chip.key === "aspect_ratio" && specs.aspect_ratio && <AspectGlyph ratio={specs.aspect_ratio} />}
          {chip.key === "target_length_seconds" && <Timer size={12} aria-hidden="true" />}
          {chip.key === "platform" && <Monitor size={12} aria-hidden="true" />}
          {chip.key === "resolution" && <Ruler size={12} aria-hidden="true" />}
          {chip.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The Brief & Specs tab. People who can edit the project get an autosaving form; everyone
 * else gets the same content read-only, with a line saying why.
 */
export function ProjectBrief({ workspaceId, project }: { workspaceId: string; project: Project }) {
  const canEdit = project.viewer_can_edit === true;
  const [description, setDescription] = useState(project.description ?? "");
  const [due, setDue] = useState(toDateInput(project.due_at));
  const [priority, setPriority] = useState(project.priority || "MEDIUM");
  const [specs, setSpecs] = useState<DeliverableSpecs>(normalizeSpecs(project.deliverable_specs ?? EMPTY_SPECS));
  const [lengthText, setLengthText] = useState(specs.target_length_seconds ? formatLength(specs.target_length_seconds) : "");
  const [lengthError, setLengthError] = useState<string | null>(null);
  const save = useAutosave(workspaceId, project.id);
  // Read once per mount for the due label; the label only needs day precision.
  const [now] = useState(() => new Date());
  const dueAt = fromDateInput(due);
  const dueInfo = dueLabel(dueAt, now);

  const setSpec = <K extends keyof DeliverableSpecs>(key: K, value: DeliverableSpecs[K], delay = PICK_DELAY) => {
    setSpecs((current) => ({ ...current, [key]: value }));
    save.queue({ deliverable_specs: { [key]: value } as Partial<DeliverableSpecs> }, delay);
  };

  if (!canEdit) {
    return (
      <div className="br is-readonly">
        <div className="br-main">
          <section className="br-card">
            <header className="br-card-head"><h2>Brief</h2><span className="br-lock"><Lock size={12} />View only</span></header>
            {project.description?.trim()
              ? <div className="br-desc">{project.description}</div>
              : <p className="br-muted">No brief has been written for this project yet.</p>}
          </section>
          <section className="br-card">
            <header className="br-card-head"><h2>Deliverable specs</h2></header>
            <SpecChips specs={specs} empty={<p className="br-muted">No specs set.</p>} />
            {specs.notes && <div className="br-desc is-notes">{specs.notes}</div>}
          </section>
        </div>
        <aside className="br-side">
          <section className="br-card">
            <dl className="br-facts">
              <div><dt><CalendarDays size={13} />Due</dt><dd className={`is-${dueLabel(project.due_at, now).tone}`} suppressHydrationWarning>{dueLabel(project.due_at, now).text}</dd></div>
              <div><dt><Flag size={13} />Priority</dt><dd><span className={`br-priority is-${(project.priority || "MEDIUM").toLowerCase()}`}>{PRIORITY_LABEL[project.priority] ?? project.priority}</span></dd></div>
            </dl>
            <p className="br-note"><Lock size={12} />Only people who can edit this project can change the brief.</p>
          </section>
        </aside>
      </div>
    );
  }

  return (
    <div className="br">
      <div className="br-main">
        <section className="br-card">
          <header className="br-card-head">
            <h2><label htmlFor="br-description">Brief</label></h2>
            <SaveIndicator state={save.state} onRetry={save.retry} />
          </header>
          <textarea
            id="br-description"
            className="br-textarea"
            value={description}
            placeholder="What is this project for? Audience, key message, must-haves, references…"
            rows={9}
            maxLength={20000}
            onChange={(event) => { setDescription(event.target.value); save.queue({ description: event.target.value }, TYPING_DELAY); }}
            onBlur={() => void save.flush()}
          />
        </section>

        <section className="br-card">
          <header className="br-card-head">
            <h2>Deliverable specs</h2>
            <SpecChips specs={specs} empty={<span className="br-muted">Nothing set yet</span>} />
          </header>
          <div className="br-grid">
            <fieldset className="br-field">
              <legend>Aspect ratio</legend>
              <div className="br-seg" role="radiogroup" aria-label="Aspect ratio">
                {ASPECT_RATIOS.map((ratio) => (
                  <button key={ratio} type="button" role="radio" aria-checked={specs.aspect_ratio === ratio}
                    onClick={() => setSpec("aspect_ratio", specs.aspect_ratio === ratio ? null : ratio)} title={aspectName(ratio)}>
                    <AspectGlyph ratio={ratio} />{ratio}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="br-field">
              <legend>Platform</legend>
              <div className="br-seg" role="radiogroup" aria-label="Platform">
                {PLATFORMS.map((platform) => (
                  <button key={platform} type="button" role="radio" aria-checked={specs.platform === platform}
                    onClick={() => setSpec("platform", specs.platform === platform ? null : platform as Platform)}>
                    {platform}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="br-field">
              <span>Target length</span>
              <input
                value={lengthText}
                inputMode="numeric"
                placeholder="e.g. 30 or 1:30"
                aria-invalid={Boolean(lengthError)}
                aria-describedby="br-length-help"
                onChange={(event) => {
                  const text = event.target.value;
                  setLengthText(text);
                  const parsed = parseLength(text);
                  if (Number.isNaN(parsed) || (parsed !== null && (parsed < 1 || parsed > 86_400))) { setLengthError("Use seconds (30) or minutes:seconds (1:30)."); return; }
                  setLengthError(null);
                  setSpec("target_length_seconds", parsed, TYPING_DELAY);
                }}
                onBlur={() => { if (!lengthError && specs.target_length_seconds) setLengthText(formatLength(specs.target_length_seconds)); void save.flush(); }}
              />
              <small id="br-length-help" className={lengthError ? "is-error" : undefined}>{lengthError ?? (specs.target_length_seconds ? `${specs.target_length_seconds} seconds` : "Seconds, or minutes:seconds")}</small>
            </label>
            <label className="br-field">
              <span>Resolution</span>
              <input
                value={specs.resolution ?? ""}
                list="br-resolutions"
                maxLength={40}
                placeholder="e.g. 1080×1920"
                onChange={(event) => setSpec("resolution", event.target.value || null, TYPING_DELAY)}
                onBlur={() => void save.flush()}
              />
              <datalist id="br-resolutions">
                {["3840×2160", "1920×1080", "1080×1920", "1080×1080", "1080×1350"].map((value) => <option key={value} value={value} />)}
              </datalist>
              <small>Width × height in pixels</small>
            </label>
            <label className="br-field is-wide">
              <span>Notes</span>
              <textarea
                className="br-textarea is-short"
                value={specs.notes ?? ""}
                rows={3}
                maxLength={2000}
                placeholder="Safe areas, captions, loudness, delivery format…"
                onChange={(event) => setSpec("notes", event.target.value || null, TYPING_DELAY)}
                onBlur={() => void save.flush()}
              />
            </label>
          </div>
        </section>
      </div>

      <aside className="br-side">
        <section className="br-card">
          <label className="br-field">
            <span><CalendarDays size={13} />Due date</span>
            <input type="date" value={due} onChange={(event) => { setDue(event.target.value); save.queue({ due_at: fromDateInput(event.target.value) }, PICK_DELAY); }} />
            <small className={`is-${dueInfo.tone}`} suppressHydrationWarning>{dueInfo.text}</small>
          </label>
          {due && <button type="button" className="br-clear" onClick={() => { setDue(""); save.queue({ due_at: null }, 0); }}>Clear due date</button>}
          <fieldset className="br-field">
            <legend><Flag size={13} />Priority</legend>
            <div className="br-seg is-priority" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={priority === value} className={`is-${value.toLowerCase()}`}
                  onClick={() => { setPriority(value); save.queue({ priority: value }, PICK_DELAY); }}>
                  {PRIORITY_LABEL[value]}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="br-note"><Clapperboard size={12} />The review page flags a cut whose aspect ratio or length doesn&rsquo;t match these specs.</p>
        </section>
      </aside>
    </div>
  );
}
