"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CircleHelp, Clock3, Loader2, MessageSquarePlus, Pencil, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/tasks/task-dialogs";
import {
  BAND_LABEL, CATEGORY_LABEL, FILTERS, aiQaApi, batchable, filterCounts, hasRegion, isActive, matchesFilter,
  pollDelay, progressLabel, readability, sortFindings, stageLabel, stageStep, suggestion, timeRangeLabel,
  type AiFinding, type AiQaState, type AiRegion, type AiReview, type AiTarget, type FindingFilter,
} from "@/lib/ai-qa";
import "./ai-qa.css";

export type AiQa = {
  /** Null until the first answer; `available` false when the feature is off or not allowed. */
  available: boolean | null;
  state: AiQaState | null;
  review: AiReview | null;
  findings: AiFinding[];
  error: string | null;
  start: (language: string) => Promise<boolean>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
  update: (finding: AiFinding) => void;
};

/** Loads the latest run for a version and polls while one is running (paused when hidden). */
export function useAiQa(target: AiTarget | null): AiQa {
  const [state, setState] = useState<AiQaState | null>(null);
  const [available, setAvailable] = useState<boolean | null>(target ? null : false);
  const [review, setReview] = useState<AiReview | null>(null);
  const [findings, setFindings] = useState<AiFinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const key = target ? `${target.workspaceId}/${target.projectId}/${target.versionId}` : null;
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);

  const loadFindings = useCallback(async (id: string) => {
    const t = targetRef.current; if (!t) return;
    const result = await aiQaApi.findings(t, id);
    if (result.ok) setFindings(result.data);
  }, []);

  useEffect(() => {
    const t = targetRef.current;
    if (!t) return;
    let cancelled = false;
    void aiQaApi.state(t).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setAvailable(false); return; }
      setState(result.data);
      setAvailable(result.data.supported);
      setReview(result.data.latest);
      if (result.data.latest && !isActive(result.data.latest)) void loadFindings(result.data.latest.id);
    });
    return () => { cancelled = true; };
  }, [key, loadFindings]);

  const reviewId = review?.id ?? null;
  const active = isActive(review);
  useEffect(() => {
    if (!active || !reviewId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    if (!startedAt.current) startedAt.current = Date.now();
    const tick = async () => {
      const t = targetRef.current;
      if (stopped || !t) return;
      if (document.visibilityState === "visible") {
        const result = await aiQaApi.review(t, reviewId);
        if (stopped) return;
        if (result.ok) {
          setReview(result.data);
          // Video findings stream in while the check runs; fetch them alongside progress.
          if (isActive(result.data) && result.data.progress.kind === "video") void loadFindings(result.data.id);
          if (!isActive(result.data)) {
            startedAt.current = 0;
            void loadFindings(result.data.id);
            if (result.data.status === "SUCCEEDED") toast.success(`AI Visual QA finished: ${result.data.summary.total} finding${result.data.summary.total === 1 ? "" : "s"}.`);
            return;
          }
        }
      }
      timer = setTimeout(tick, pollDelay(Date.now() - startedAt.current));
    };
    timer = setTimeout(tick, 1_000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [active, reviewId, loadFindings]);

  const start = useCallback(async (language: string) => {
    const t = targetRef.current; if (!t) return false;
    setError(null);
    const result = await aiQaApi.start(t, language);
    if (!result.ok) { setError(result.detail); return false; }
    startedAt.current = Date.now();
    setFindings([]);
    setReview(result.data);
    return true;
  }, []);

  const retry = useCallback(async () => {
    const t = targetRef.current; if (!t || !reviewId) return;
    const result = await aiQaApi.retry(t, reviewId);
    if (!result.ok) { toast.error(result.detail); return; }
    startedAt.current = Date.now();
    setReview(result.data);
  }, [reviewId]);

  const cancel = useCallback(async () => {
    const t = targetRef.current; if (!t || !reviewId) return;
    const result = await aiQaApi.cancel(t, reviewId);
    if (!result.ok) { toast.error(result.detail); return; }
    startedAt.current = 0;
    setReview(result.data);
    toast("AI Visual QA cancelled.");
  }, [reviewId]);

  const update = useCallback((next: AiFinding) => setFindings((list) => list.map((item) => item.id === next.id ? next : item)), []);

  return { available, state, review, findings, error, start, retry, cancel, update };
}

type Props = {
  qa: AiQa;
  target: AiTarget;
  versionLabel: string;
  title: string;
  selectedId: string | null;
  onSelect: (finding: AiFinding | null) => void;
  /** Bumped by the header's "Run AI Visual QA" button to open the run dialog here. */
  runRequest?: number;
  video?: boolean;
};

const STEPS = ["Queued", "Reading text", "Checking spelling", "Done"];

export function AiQaPanel({ qa, target, versionLabel, title, selectedId, onSelect, runRequest = 0, video = false }: Props) {
  const router = useRouter();
  const [runOpen, setRunOpen] = useState(false);
  const [language, setLanguage] = useState("en-GB");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FindingFilter>("open");
  const [batchOpen, setBatchOpen] = useState(false);
  const { review, findings } = qa;
  const canRun = Boolean(qa.state?.can_run);
  const active = isActive(review);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [handledRun, setHandledRun] = useState(runRequest);
  if (runRequest !== handledRun) {
    // Adjusting state during render (not in an effect) is React's sanctioned way to react to a prop.
    setHandledRun(runRequest);
    if (runRequest > 0 && canRun && !active) setRunOpen(true);
  }
  const steps = video ? ["Queued", "Reading frames", "Checking spelling", "Done"] : STEPS;

  const counts = useMemo(() => filterCounts(findings), [findings]);
  const shown = useMemo(() => sortFindings(findings.filter((f) => matchesFilter(f, filter))), [findings, filter]);
  const batch = useMemo(() => batchable(findings), [findings]);

  const run = async () => {
    setBusy(true);
    const ok = await qa.start(language);
    setBusy(false);
    if (ok) setRunOpen(false);
  };

  const addComment = async (finding: AiFinding, quiet = false) => {
    const result = await aiQaApi.comment(target, finding.id);
    if (!result.ok) { toast.error(result.detail); return false; }
    qa.update(result.data.finding);
    if (!quiet) { toast.success("Added to comments as a team-only note."); router.refresh(); }
    return true;
  };

  const addBatch = async () => {
    setBusy(true);
    let added = 0;
    for (const finding of batch) if (await addComment(finding, true)) added += 1;
    setBusy(false);
    setBatchOpen(false);
    toast.success(`Added ${added} comment${added === 1 ? "" : "s"} as team-only notes.`);
    router.refresh();
  };

  return (
    <div className="aiqa" data-testid="ai-qa-panel">
      <div className="aiqa-head">
        <div>
          <strong><Sparkles size={14} aria-hidden="true" /> AI Visual QA</strong>
          <small>Suggestions only: a person confirms each one.</small>
        </div>
        {canRun && (
          <button type="button" className="tb-button is-primary aiqa-run" onClick={() => setRunOpen(true)} disabled={active} data-testid="ai-qa-run">
            {active ? <Loader2 size={13} className="aiqa-spin" /> : <Sparkles size={13} />}
            {review ? "Run again" : "Run AI Visual QA"}
          </button>
        )}
      </div>

      {!review && (
        <div className="aiqa-empty">
          <Sparkles size={22} aria-hidden="true" />
          <p>Check the visible text on <strong>{versionLabel}</strong> for likely spelling mistakes.</p>
          <small>Runs in the background on our own servers. Decorative fonts or low contrast can hide errors, so it won’t catch everything.</small>
        </div>
      )}

      {review && active && (
        <div className="aiqa-progress" role="status" aria-live="polite" data-testid="ai-qa-progress">
          <ol className="aiqa-steps">
            {steps.map((step, index) => (
              <li key={step} className={index < stageStep(review) ? "is-done" : index === stageStep(review) ? "is-current" : ""}>
                <span aria-hidden="true">{index < stageStep(review) ? <Check size={10} /> : index + 1}</span>{step}
              </li>
            ))}
          </ol>
          <p><Loader2 size={13} className="aiqa-spin" /> {stageLabel(review)}{progressLabel(review) ? ` · ${progressLabel(review)}` : ""}</p>
          {review.progress.frames_total ? (
            <div className="aiqa-bar" role="progressbar" aria-valuemin={0} aria-valuemax={review.progress.frames_total} aria-valuenow={review.progress.frames_done ?? 0} aria-label="Frames read">
              <span style={{ width: `${Math.min(100, ((review.progress.frames_done ?? 0) / review.progress.frames_total) * 100)}%` }} />
            </div>
          ) : null}
          <small>You can leave this page; the check keeps running and you’ll get a notification when it’s done.</small>
          {findings.length > 0 && (
            <div className="aiqa-partial" data-testid="ai-qa-partial">
              <p className="aiqa-partial-head"><Sparkles size={12} />Found so far · {findings.length} <span>— you can act on these when the check finishes</span></p>
              <div className="aiqa-list">
                {sortFindings(findings).map((finding) => (
                  <FindingCard
                    key={finding.id} finding={finding} target={target} selected={selectedId === finding.id} canAct={false}
                    onSelect={() => onSelect(selectedId === finding.id ? null : finding)} onUpdate={qa.update} onComment={() => undefined}
                  />
                ))}
              </div>
            </div>
          )}
          {canRun && <button type="button" className="tb-button aiqa-cancel" onClick={() => setCancelOpen(true)} data-testid="ai-qa-cancel"><Square size={11} />Cancel check</button>}
        </div>
      )}

      {review?.status === "FAILED" && (
        <div className="aiqa-failed" role="alert" data-testid="ai-qa-failed">
          <AlertTriangle size={15} />
          <div>
            <strong>The check didn’t finish</strong>
            <p>{review.error_message || "Something went wrong."}</p>
            {review.error_code && <code>{review.error_code}</code>}
          </div>
          {canRun && <button type="button" className="tb-button" onClick={() => void qa.retry()}><RotateCcw size={13} />Retry</button>}
        </div>
      )}

      {review && !active && review.status !== "FAILED" && (
        <>
          <div className="aiqa-summary">
            <span suppressHydrationWarning>Checked {versionLabel} · {review.engine === "paddleocr" ? "on our servers" : review.engine}</span>
            <div className="aiqa-chips-sum">
              <span className="aiqa-pill is-high">{review.summary.by_band.high ?? 0} high</span>
              <span className="aiqa-pill is-medium">{review.summary.by_band.medium ?? 0} medium</span>
              <span className="aiqa-pill is-low">{review.summary.by_band.low ?? 0} low</span>
            </div>
          </div>
          <div className="aiqa-filters" role="tablist" aria-label="Filter findings">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}<span>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className="aiqa-list" data-testid="ai-qa-findings">
            {findings.length === 0 && (
              <div className="aiqa-empty is-small"><Check size={18} /><p>No likely spelling mistakes found.</p><small>That isn’t a guarantee: stylised or very small text may not have been read.</small></div>
            )}
            {findings.length > 0 && shown.length === 0 && <p className="aiqa-none">Nothing here.</p>}
            {shown.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                target={target}
                selected={selectedId === finding.id}
                canAct={canRun}
                onSelect={() => onSelect(selectedId === finding.id ? null : finding)}
                onUpdate={qa.update}
                onComment={() => void addComment(finding)}
              />
            ))}
          </div>
          {canRun && batch.length > 0 && (
            <div className="aiqa-batch">
              <button type="button" className="tb-button" onClick={() => setBatchOpen(true)} data-testid="ai-qa-batch">
                <MessageSquarePlus size={13} />Add {batch.length} high-confidence as comments
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={runOpen}
        title="Run AI Visual QA"
        body={<>Checking <strong>{title}</strong> · {versionLabel}. This version stays exactly as uploaded; results are suggestions you confirm.</>}
        confirmLabel={busy ? "Starting…" : "Run check"}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => { setRunOpen(false); }}
      >
        <div className="aiqa-options">
          <label className="aiqa-check"><input type="checkbox" checked readOnly /> Proofread visible text</label>
          <label className="aiqa-check is-disabled" title="Coming next"><input type="checkbox" disabled /> Compare with approved copy <em>Soon</em></label>
          <label className="aiqa-field">Language
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="en-GB">English (UK)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>
          <p className="aiqa-note">Runs in the background on our own servers; nothing is sent to an outside AI service. Comments are only added when you choose.</p>
          {qa.error && <p className="form-error" role="alert">{qa.error}</p>}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this check?"
        body="Nothing found so far is kept. You can run it again at any time."
        confirmLabel="Cancel check"
        cancelLabel="Keep running"
        danger
        onConfirm={() => { setCancelOpen(false); void qa.cancel(); }}
        onCancel={() => setCancelOpen(false)}
      />

      <ConfirmDialog
        open={batchOpen}
        title={`Add ${batch.length} comment${batch.length === 1 ? "" : "s"}?`}
        body={video ? "Each becomes a team-only note marked AI-suggested, pinned to its time range with the highlight drawn on the frame." : "Each becomes a team-only note marked AI-suggested, with its highlight drawn on the image."}
        confirmLabel={busy ? "Adding…" : `Add ${batch.length}`}
        busy={busy}
        onConfirm={() => void addBatch()}
        onCancel={() => setBatchOpen(false)}
      >
        <ul className="aiqa-batch-list">
          {batch.map((finding) => <li key={finding.id}><s>{finding.detected_text}</s> → <strong>{suggestion(finding) || "?"}</strong></li>)}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

function FindingCard({ finding, target, selected, canAct, onSelect, onUpdate, onComment }: {
  finding: AiFinding; target: AiTarget; selected: boolean; canAct: boolean;
  onSelect: () => void; onUpdate: (finding: AiFinding) => void; onComment: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion(finding));
  const [saving, setSaving] = useState(false);
  const decide = async (body: Parameters<typeof aiQaApi.decide>[2], message?: string) => {
    setSaving(true);
    const result = await aiQaApi.decide(target, finding.id, body);
    setSaving(false);
    if (!result.ok) { toast.error(result.detail); return; }
    onUpdate(result.data);
    if (message) toast(message);
  };
  const fix = suggestion(finding);
  const closed = finding.status === "DISMISSED" || finding.status === "NOT_AN_ERROR";
  return (
    <article
      className={`aiqa-card is-${finding.band} ${selected ? "is-selected" : ""} ${closed ? "is-closed" : ""}`}
      data-testid="ai-qa-finding"
      data-finding={finding.id}
    >
      <button type="button" className="aiqa-card-main" onClick={onSelect} aria-pressed={selected} aria-label={timeRangeLabel(finding) ? `Jump to ${timeRangeLabel(finding)} and show “${finding.detected_text}”` : `Show “${finding.detected_text}” on the image`}>
        <span className="aiqa-card-top">
          <span className="aiqa-cat">{finding.category === "OCR_UNCERTAIN" ? <CircleHelp size={12} /> : <Sparkles size={12} />}{CATEGORY_LABEL[finding.category]}</span>
          <span className={`aiqa-pill is-${finding.band}`}>{BAND_LABEL[finding.band]}</span>
        </span>
        {timeRangeLabel(finding) && <span className="aiqa-time" data-testid="ai-qa-time"><Clock3 size={11} aria-hidden="true" />{timeRangeLabel(finding)}</span>}
        <span className="aiqa-fix">
          <s>{finding.detected_text}</s>
          {fix && <><span aria-hidden="true">→</span><strong>{fix}</strong></>}
        </span>
        <span className="aiqa-why">{finding.explanation}</span>
        <span className="aiqa-meta">{readability(finding.ocr_confidence)}{finding.context_text && finding.context_text !== finding.detected_text ? <> · “{finding.context_text.slice(0, 60)}”</> : null}</span>
      </button>
      {editing && (
        <form className="aiqa-edit" onSubmit={(event) => { event.preventDefault(); void decide({ edited_suggestion: draft }).then(() => setEditing(false)); }}>
          <label className="sr-only" htmlFor={`fix-${finding.id}`}>Suggested correction</label>
          <input id={`fix-${finding.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus maxLength={500} />
          <button type="submit" className="tb-button is-primary" disabled={saving}>Save</button>
          <button type="button" className="tb-button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
      {canAct && !editing && (
        <div className="aiqa-actions">
          {finding.status === "COMMENT_CREATED"
            ? <span className="aiqa-done"><Check size={12} />Added to comments</span>
            : closed
              ? <><span className="aiqa-done is-muted">{finding.status === "NOT_AN_ERROR" ? "Marked not an error" : "Dismissed"}</span><button type="button" onClick={() => void decide({ status: "PENDING" })} disabled={saving}>Undo</button></>
              : <>
                  <button type="button" className="is-primary" onClick={onComment} disabled={saving} data-testid="ai-qa-add-comment"><MessageSquarePlus size={12} />Add comment</button>
                  <button type="button" onClick={() => setEditing(true)} disabled={saving}><Pencil size={12} />Edit</button>
                  {finding.status !== "ACCEPTED"
                    ? <button type="button" onClick={() => void decide({ status: "ACCEPTED" }, "Marked as a real mistake.")} disabled={saving}><Check size={12} />Accept</button>
                    : <span className="aiqa-done"><Check size={12} />Accepted</span>}
                  <button type="button" onClick={() => void decide({ status: "DISMISSED" })} disabled={saving}><X size={12} />Dismiss</button>
                  <button type="button" onClick={() => void decide({ status: "NOT_AN_ERROR", add_to_glossary: "project" }, `“${finding.detected_text}” added to this project’s glossary.`)} disabled={saving} title="Never flag this word again in this project">Not an error</button>
                </>}
        </div>
      )}
    </article>
  );
}

/** The dashed highlight drawn over the image for the selected finding (0–100 overlay space). */
export function AiHighlight({ region }: { region: AiRegion }) {
  const pad = 0.8;
  return (
    <rect
      className="aiqa-highlight"
      data-testid="ai-qa-highlight"
      x={region.x * 100 - pad} y={region.y * 100 - pad}
      width={region.width * 100 + pad * 2} height={region.height * 100 + pad * 2}
      rx="0.6" vectorEffect="non-scaling-stroke"
    />
  );
}

export { hasRegion };
