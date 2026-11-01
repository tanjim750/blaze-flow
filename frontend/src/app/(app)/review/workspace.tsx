"use client";

import { useAppRouter } from "@/lib/app-router";
import Link from "next/link";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BadgeCheck, Sparkles, Check, ChevronLeft, Columns2, HardDriveDownload, Info, Keyboard, Link2, MessageSquareText, MoreHorizontal, RotateCcw, Share2, SlidersHorizontal, TriangleAlert, X } from "@/components/icons";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { markIn, markOut, type LoopRange, type MarkRange } from "@/lib/review-range";
import { timecode } from "@/lib/timecode";
import { playerShouldIgnoreKey } from "./player-keys";
import { ShortcutsDialog } from "./shortcuts";
import type { ReviewView } from "@/lib/review-view";
import { clientView, type NoteDrawing, type ReviewNote } from "@/lib/review-notes";
import type { AnnotationElement } from "@/lib/api";
import { fetchMediaVersions, retryMediaRender } from "@/lib/asset-api-client";
import { proxyInFlight, proxyNotice } from "./player-state";
import { loadDraft, patchDraft, unsavedWarning } from "@/lib/review-drafts";
import { DEFAULT_HOLD, displayWindow, drawingEndMs, rememberedHold, windowOpacity, type HoldChoice } from "@/lib/annotation-window";
import { specMismatches } from "@/lib/project-brief";
import { latestFor, openNotesWarning, overrideWarning, proofDetail, proofLine, reviewBarActions } from "@/lib/review-decisions";
import { useLiveDecisions } from "./live-decisions";
import { ConfirmDialog } from "@/components/tasks/task-dialogs";
import { Comments, RevisionForm, type ComposerState } from "./comments";
import { Fields } from "./fields";
import { CompareView, type CompareHandle } from "./compare";
import { useLeaveGuard } from "./leave-guard";
import "../tasks/tasks.css";
import "./review-controls.css";
import { Player, type DrawnAnnotation, type PlayerHandle, type PlayerSource } from "./player";
import { SharePanel } from "./share-panel";
import { TaskPanel } from "./task-panel";
import { REVIEW_FROM_KEY } from "@/components/universal-review";
import { returnLabel, reviewSurface, safeReturnPath } from "@/lib/open-in-review";
import { useReviewWriter } from "./writer";
import { AiQaPanel, useAiQa, useBandScope } from "./ai-qa-panel";
import { hasRegion, inScope, scopeCounts, type AiFinding, type AiTarget } from "@/lib/ai-qa";
import { Select } from "@/components/ui/select";

type Props = {
  view: ReviewView; author: string; userId?: string | null; initialShareOpen?: boolean; initialPanel?: "ai" | null; embedded?: boolean;
  /** `?comment=` from a notification: the note to scroll to and highlight. */
  initialCommentId?: string | null;
  /** `?t=` in milliseconds: where to seek once the media has loaded. */
  initialTimeMs?: number | null;
  /** `?from=`: the page (with its filters) the Back button returns to. */
  returnTo?: string | null;
};

/** "3 Oct 2026, 20:41" — fixed locale so the server and browser render the same text. */
const stamp = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
  : null;

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

export function ReviewWorkspace({ view, author, userId = null, initialShareOpen = false, initialPanel = null, embedded = false, initialCommentId = null, initialTimeMs = null, returnTo = null }: Props) {
  const router = useAppRouter();
  const reduced = useReducedMotion();
  const player = useRef<PlayerHandle>(null);
  const compare = useRef<CompareHandle>(null);
  const writer = useReviewWriter(view, author, userId);
  // Notes on the comparison cut must resolve and react against that cut's own version, and
  // its optimistic writes reconcile against that cut's own notes.
  const comparisonView = useMemo<ReviewView>(
    () => view.comparison
      ? { ...view, version: view.comparison.version, target: view.comparison.version.target, notes: view.comparison.notes, annotations: view.comparison.annotations }
      : view,
    [view],
  );
  const compareWriter = useReviewWriter(comparisonView, author, userId);

  const [panel, setPanel] = useState<"comments" | "fields" | "ai">(initialPanel ?? "comments");
  const [aiRunRequest, setAiRunRequest] = useState(0);
  const [aiSelected, setAiSelected] = useState<AiFinding | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [meta, setMeta] = useState<{ durationMs: number; width: number; height: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(initialCommentId);
  const [pending, setPending] = useState<AnnotationElement[] | null>(null);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [clientPreview, setClientPreview] = useState(false);
  const [composer, setComposer] = useState<ComposerState>({ text: false, recording: false, startMs: null });
  // How long the drawing being composed will stay on screen. Lives beside `pending`, the
  // drawing itself, so both are saved to and restored from the draft together.
  const [hold, setHold] = useState<HoldChoice>(DEFAULT_HOLD);
  const [revisionDirty, setRevisionDirty] = useState(false);
  /** In/out points for the next note (I/O keys, shift-drag on the timeline, the Range button). */
  const [mark, setMark] = useState<MarkRange | null>(null);
  /** A range note playing on repeat; Esc or a seek elsewhere ends it. */
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);

  const { asset, version } = view;
  // The proxy's state as last heard, so a re-render shows progress without a page reload.
  const [proxyOverride, setProxyOverride] = useState<{ versionId: string; status: string } | null>(null);
  const [rerendering, setRerendering] = useState(false);
  const target = version?.target ?? null;
  const proxyStatus = target && proxyOverride?.versionId === target.versionId ? proxyOverride.status : version?.previewStatus ?? null;
  const rerender = useCallback(async () => {
    if (!target) return;
    setRerendering(true);
    try {
      await retryMediaRender(target.workspaceId, target.projectId, target.versionId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't queue the re-render.");
      return;
    } finally {
      setRerendering(false);
    }
    setProxyOverride({ versionId: target.versionId, status: "PENDING" });
    toast.success("Re-render queued. The proxy plays here as soon as it's ready.");
  }, [target]);
  // While a proxy is being made, check back so the player switches over when it lands.
  useEffect(() => {
    if (!target || !proxyInFlight(proxyStatus)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const rows = await fetchMediaVersions(target.workspaceId, target.projectId).catch(() => null);
      if (cancelled || !rows) return; // try again on the next tick
      const row = rows.find((item) => item.id === target.versionId);
      if (row?.preview_status) setProxyOverride({ versionId: target.versionId, status: row.preview_status });
    }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [proxyStatus, target]);
  const mediaId = version?.id ?? null;
  const surface = version ? reviewSurface(version.mimeType, version.title) : "video";

  // Back returns to where the review was opened from — Files with its folder and search,
  // the task board with its filters, a project, the dashboard — not a fixed page. `?from=`
  // wins (it survives a refresh and a shared link); otherwise the shell remembered the
  // page the last review was opened from; otherwise the file's project or Files.
  const fallbackBack = asset?.projectId ? `/projects?campaign=${asset.projectId}` : "/files";
  const [back, setBack] = useState(returnTo ?? fallbackBack);
  useEffect(() => {
    if (returnTo) return;
    try {
      const remembered = safeReturnPath(window.sessionStorage.getItem(REVIEW_FROM_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists after mount
      if (remembered) setBack(remembered);
    } catch { /* storage blocked */ }
  }, [returnTo]);
  const backLabel = returnLabel(back);

  // A drawing made for an unsent note is part of the draft, so it is kept with it.
  const [drawingReady, setDrawingReady] = useState(false);
  useEffect(() => {
    const draft = loadDraft(mediaId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore from localStorage after mount (not available during SSR)
    setDrawingReady(true);
    if (draft?.annotation) setPending(draft.annotation);
    setHold(draft?.annotation && draft.hold ? draft.hold : rememberedHold());
  }, [mediaId]);
  useEffect(() => {
    if (drawingReady) patchDraft(mediaId, { annotation: pending, hold: pending ? hold : null });
  }, [drawingReady, hold, mediaId, pending]);

  const navWarning = unsavedWarning({ text: composer.text, annotation: Boolean(pending), recording: composer.recording, revision: revisionDirty, localNotes: 0 });
  const unloadWarning = unsavedWarning({ text: composer.text, annotation: Boolean(pending), recording: composer.recording, revision: revisionDirty, localNotes: 0 });
  const navigate = useCallback((href: string, top: boolean) => {
    if (top && window.top) window.top.location.href = href;
    else router.push(href);
  }, [router]);
  const leave = useLeaveGuard(navWarning, Boolean(unloadWarning), navigate);

  /**
   * Server notes and device-local notes render through exactly the same component. A cut
   * has one or the other, never both, but concatenating rather than branching is what
   * keeps the two paths from drifting apart.
   */
  // Each note with a drawing learns the window that drawing is shown in, for its row.
  const applyWrites = writer.apply;
  // A drawing whose duration is being changed shows its new window straight away.
  const endOf = useCallback((id: string, endMs: number | null) => writer.overlay.windows[id] ?? endMs, [writer.overlay.windows]);
  const allNotes: ReviewNote[] = useMemo(() => {
    const drawings = new Map<string, NoteDrawing>();
    for (const item of view.annotations) {
      if (item.review_comment_id && !drawings.has(item.review_comment_id)) {
        drawings.set(item.review_comment_id, {
          annotationId: item.id, elements: item.elements, startMs: item.start_time_ms,
          endMs: endOf(item.id, item.end_time_ms), authorId: item.author_user_id,
        });
      }
    }
    // Optimistic posts, edits, resolves and deletes are laid over the server's notes here,
    // so the feed, the timeline markers and the counts all agree while a save is in flight.
    return applyWrites(view.notes).map((note) => {
      const drawing = drawings.get(note.id);
      return drawing ? { ...note, drawing, drawingWindow: displayWindow(drawing.startMs, drawing.endMs) } : note;
    });
  }, [applyWrites, endOf, view.annotations, view.notes]);
  // "See what the client sees" applies the guest endpoints' rule on the page: no team notes,
  // no replies in their threads, and no drawings saved with them.
  const teamNoteIds = useMemo(() => new Set(allNotes.flatMap((note) => [
    ...(note.visibility === "team" ? [note.id, ...note.replies.map((reply) => reply.id)] : []),
    ...note.replies.filter((reply) => reply.visibility === "team").map((reply) => reply.id),
  ])), [allNotes]);
  const notes = useMemo(() => clientPreview ? clientView(allNotes) : allNotes, [allNotes, clientPreview]);
  // A deep link from a notification: seek to its timecode (or its note's) once, as soon as
  // the player knows the media, and say so if the note has since gone.
  const linkedNote = useMemo(() => initialCommentId
    ? allNotes.flatMap((note) => [note, ...note.replies]).find((note) => note.id === initialCommentId) ?? null
    : null, [allNotes, initialCommentId]);
  const pendingSeek = useRef<number | null>(initialTimeMs ?? linkedNote?.startMs ?? null);
  useEffect(() => {
    if (!meta || pendingSeek.current === null) return;
    player.current?.seek(pendingSeek.current);
    pendingSeek.current = null;
  }, [meta]);
  // Every note still on the page, replies included. A drawing whose note has been deleted
  // (here, optimistically, or before deletes cascaded on the server) must not stay on the frame.
  const existingNoteIds = useMemo(() => new Set(allNotes.flatMap((note) => [note.id, ...note.replies.map((reply) => reply.id)])), [allNotes]);
  const annotations: DrawnAnnotation[] = useMemo(() => [
    ...view.annotations
      .filter((item) => !item.review_comment_id || existingNoteIds.has(item.review_comment_id))
      .filter((item) => !clientPreview || !item.review_comment_id || !teamNoteIds.has(item.review_comment_id))
      .map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms, endMs: endOf(item.id, item.end_time_ms), noteId: item.review_comment_id, editable: Boolean(view.target && view.canComment && userId && item.author_user_id === userId) })),
  ], [clientPreview, endOf, existingNoteIds, teamNoteIds, userId, view.annotations, view.canComment, view.target]);
  const canWriteTeam = Boolean(view.target && userId && view.members.some((member) => member.id === userId));

  const sources: PlayerSource[] = useMemo(() => {
    if (!version) return [];
    const list: PlayerSource[] = [];
    if (version.target && version.src) {
      // 1080p first when it exists (the player starts on the first source unless the viewer
      // picked another before); 720p stays as the lighter fallback.
      if (version.qualities?.includes("hq")) list.push({ id: "hq", label: "HD 1080p", src: `${version.src}?quality=hq` });
      list.push({ id: "proxy", label: version.qualities?.includes("hq") ? "SD 720p" : "Review proxy", src: version.src });
    }
    if (version.assetFileId && view.workspaceId) {
      const original = `/api/workspaces/${view.workspaceId}/asset-files/${version.assetFileId}/download/`;
      if (!list.some((item) => item.src === original)) list.push({ id: "original", label: "Original file", src: original });
    } else if (!list.length && version.src) {
      list.push({ id: "source", label: "Original file", src: version.src });
    }
    return list;
  }, [version, view.workspaceId]);

  const approval = view.stages.find((stage) => stage.isApproval);
  // Compared against what the player measured, so it only appears once the media has loaded.
  const mismatches = useMemo(() => specMismatches(view.specs, surface === "video" ? meta : null), [meta, surface, view.specs]);
  const comparing = view.comparison;
  const latest = asset?.versions[asset.versions.length - 1] ?? null;
  const approved = Boolean(approval && version?.workflowStage?.id === approval.id);
  const openNotes = view.notes.filter((note) => !note.resolved).length;
  // Only the media version's own flag decides: when it is off the server refuses the
  // download anyway, so the button would be a dead end.
  const downloadHref = !version
    ? null
    : version.target
      ? version.allowDownload
        ? `/api/workspaces/${version.target.workspaceId}/projects/${version.target.projectId}/media-versions/${version.target.versionId}/download/`
        : null
      : version.assetFileId && view.workspaceId
        ? `/api/workspaces/${view.workspaceId}/asset-files/${version.assetFileId}/download/`
        : null;

  // What the bar offers is the API's answer for this viewer: team members move the cut
  // through the workflow, client-team members decide as the client, read-only viewers get
  // neither. Nothing is offered that the server would refuse.
  const actions = reviewBarActions(view.decisionViewer, { hasTarget: Boolean(view.target), approved, hasApprovalStage: Boolean(approval) });
  const canShare = Boolean(view.target && view.role !== "client" && view.canManageGuests);
  // The proof of delivery: the newest client decision on exactly this version.
  const clientDecision = latestFor(view.decisions, version?.target?.versionId);
  // R8: a guest's decision in another session shows here without a reload.
  useLiveDecisions(view.target ?? null, clientDecision?.id ?? null, () => router.refresh());
  const approveOverride = overrideWarning(clientDecision, "approved");
  const reopenOverride = overrideWarning(clientDecision, "changes_requested");
  const openWarning = version ? openNotesWarning(openNotes, version.label) : null;

  function approve() {
    if (!version) return;
    if (actions.approve === "client") {
      setApproveOpen(false);
      writer.deferDecision(`${version.label} approved`, () => writer.decideAsClient("approved"));
      return;
    }
    if (!approval) return;
    const stageId = approval.id;
    setApproveOpen(false);
    writer.deferDecision(`${version.label} approved`, () => writer.moveToStage(stageId));
  }
  const sourceFor = (item: typeof version) => {
    if (!item) return null;
    if (item.target && item.src) return item.src;
    if (item.assetFileId && view.workspaceId) return `/api/workspaces/${view.workspaceId}/asset-files/${item.assetFileId}/download/`;
    return item.src;
  };
  const clearPending = useCallback(() => setPending(null), []);
  // Where the playhead was when the pending drawing was made.
  const [pendingAt, setPendingAt] = useState<number | null>(null);
  const drawPending = useCallback((elements: AnnotationElement[] | null) => {
    const next = elements?.length ? elements : null;
    // Further shapes join the drawing at the moment its first shape was made.
    setPendingAt((at) => (next ? at ?? Math.round(player.current?.position() ?? positionMs) : null));
    setPending(next);
  }, [positionMs]);
  // The drawing being composed, previewed on the timeline as the span it will cover.
  const pendingWindow = useMemo(() => {
    // A marked range is drawn by the player itself, with handles.
    if (mark?.outMs != null) return null;
    // Before the composer has a time of its own, the drawing sits where it was drawn.
    const startMs = composer.startMs ?? pendingAt;
    if (!pending || startMs === null || !(surface === "video" || surface === "audio")) return null;
    return { startMs, endMs: drawingEndMs(startMs, hold, meta?.durationMs ?? 0) };
  }, [composer.startMs, hold, mark?.outMs, meta?.durationMs, pending, pendingAt, surface]);
  // Notes whose drawing (or range) covers the playhead, lit in the feed as the cut plays.
  const liveNoteIds = useMemo(() => new Set(notes.flatMap((note) => {
    const window = note.drawingWindow ?? (note.startMs !== null && note.endMs ? displayWindow(note.startMs, note.endMs) : null);
    return window && !window.frameOnly && windowOpacity(window, positionMs, false) > 0 ? [note.id] : [];
  })), [notes, positionMs]);
  // Switching version or comparing keeps the task panel and the way back.
  const carry = new URLSearchParams();
  if (view.task) carry.set("task", view.task.task.id);
  if (returnTo) carry.set("from", returnTo);
  const reviewHref = (query: string) => `${embedded ? "/review-embed" : "/review"}?${query}${carry.size ? `&${carry.toString()}` : ""}`;
  const seek = (ms: number) => player.current?.seek(ms);
  const seekCompare = (versionId: string, ms: number) => compare.current?.seek(versionId, ms);
  const timed = surface === "video" || surface === "audio";
  // AI Visual QA: images and video, only for workspace teammates (the API says the rest).
  const aiVideo = surface === "video";
  const aiTarget = useMemo<AiTarget | null>(
    () => view.target && (surface === "image" || surface === "video") && canWriteTeam
      ? { workspaceId: view.target.workspaceId, projectId: view.target.projectId, versionId: view.target.versionId }
      : null,
    [view.target, surface, canWriteTeam],
  );
  const aiQa = useAiQa(aiTarget);
  const [aiScope, setAiScope] = useBandScope(userId);
  const aiCounts = useMemo(() => scopeCounts(aiQa.findings, aiScope), [aiQa.findings, aiScope]);
  const aiHighlight = panel === "ai" && aiSelected && hasRegion(aiSelected.region) ? aiSelected : null;
  const aiMarkers = useMemo(() => aiVideo
    ? aiQa.findings
        .filter((f) => f.start_time_ms !== null && f.status !== "DISMISSED" && f.status !== "NOT_AN_ERROR" && (inScope(f, aiScope) || f.id === aiSelected?.id))
        .map((f) => ({ id: f.id, startMs: f.start_time_ms!, endMs: f.end_time_ms ?? f.start_time_ms!, label: f.detected_text, band: f.band, selected: f.id === aiSelected?.id }))
    : [], [aiVideo, aiQa.findings, aiSelected?.id, aiScope]);
  /** Selecting a video finding seeks to where it first shows; the highlight then follows it. */
  const selectAi = useCallback((finding: AiFinding | null) => {
    setAiSelected(finding);
    if (finding && finding.start_time_ms !== null) player.current?.seek(finding.start_time_ms);
  }, []);
  const openAiRun = () => { setPanel("ai"); setAiRunRequest((n) => n + 1); };

  /** Clicking a range note's loop button: jump to its in point and play it on repeat. */
  const playRange = useCallback((startMs: number, endMs: number) => {
    setLoop({ startMs, endMs });
    player.current?.seek(startMs);
    player.current?.play();
  }, []);
  const stopLoop = useCallback(() => setLoop(null), []);

  /*
   * Page-level shortcuts: I/O mark a range for the next note, C jumps into the comment box,
   * ? opens the shortcut list, Esc stops a loop and then clears the range. Transport keys
   * (space, J/K/L, arrows) belong to the player; the same rule skips keys while typing.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"))) {
        if (keysOpen) return;
        event.preventDefault();
        setKeysOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (event.defaultPrevented || keysOpen) return;
        if (event.target instanceof Element && event.target.closest("[role=dialog], [role=menu], input, textarea, select")) return;
        if (loop) { setLoop(null); return; }
        if (mark) setMark(null);
        return;
      }
      if (playerShouldIgnoreKey(event) || event.shiftKey || !timed || comparing) return;
      const key = event.key.toLowerCase();
      const at = () => player.current?.position() ?? positionMs;
      if (key === "i") { event.preventDefault(); setMark((current) => markIn(current, at(), meta?.durationMs ?? 0)); return; }
      if (key === "o") { event.preventDefault(); setMark((current) => markOut(current, at(), meta?.durationMs ?? 0)); return; }
      if (key === "c") {
        const field = document.getElementById("rv-comment-field") as HTMLTextAreaElement | null;
        if (!field || field.disabled) return;
        event.preventDefault();
        setPanel("comments");
        // After the tab switch has rendered, so the field is visible when focused.
        requestAnimationFrame(() => { field.focus(); field.scrollIntoView({ block: "nearest" }); });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comparing, keysOpen, loop, mark, meta?.durationMs, positionMs, timed]);

  const copyMomentLink = useCallback(async () => {
    const at = Math.round(player.current?.position() ?? positionMs);
    const url = `${window.location.origin}${reviewHref(`media=${version?.id ?? ""}&t=${at}`)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { description: `Opens this cut at ${timecode(at)}.` });
    } catch {
      toast.error("Couldn't copy the link", { description: url });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reviewHref is rebuilt each render from the same inputs
  }, [positionMs, version?.id]);

  if (!asset || !version) {
    return (
      <div className={`rv ${embedded ? "is-embedded" : ""}`}>
        <header className="rv-top">
          <Link href={back} target={embedded ? "_top" : undefined} className="rv-back"><ChevronLeft size={16} />{backLabel}</Link>
          <div className="rv-crumbs"><strong>Nothing to review</strong></div>
        </header>
        <p className="rv-blank">
          {view.notice ?? "Upload a video from Files or a project, then open it here to start a review."}
        </p>
      </div>
    );
  }

  return (
    <div className={`rv ${embedded ? "is-embedded" : ""}`}>
      <header className="rv-top">
        <div className="rv-top-id">
          <Link href={back} target={embedded ? "_top" : undefined} className="rv-back" aria-label={`Back to ${backLabel === "Back" ? "previous page" : backLabel}`} title={`Back to ${backLabel === "Back" ? "previous page" : backLabel}`}>
            <ChevronLeft size={16} /><span className="rv-back-label">{backLabel}</span>
          </Link>

          <nav className="rv-crumbs" aria-label="Location">
            {[asset.clientName, asset.projectName ?? "Library", asset.folderName].filter(Boolean).map((part) => (
              <span key={part}>{part}<i aria-hidden="true">/</i></span>
            ))}
            <strong title={version.title}>{version.title}</strong>
          </nav>
        </div>

        {/* What is on screen: which version, what it is compared with, and where it stands. */}
        <div className="rv-top-cut" role="group" aria-label="Version">
          <Select
            className="rv-version"
            aria-label="Version"
            value={version.id}
            onValueChange={(next) => leave.guard(reviewHref(`media=${next}`))}
            options={[...asset.versions].reverse().map((item) => ({ value: item.id, label: `${item.label}${item.id === latest?.id ? " · Latest" : ""}` }))}
          />

          {asset.versions.length > 1 && (comparing ? (
            <button type="button" className="rv-compare-toggle is-on" onClick={() => leave.guard(reviewHref(`media=${version.id}`))}>
              <X size={13} />Exit compare
            </button>
          ) : (
            <Select
              className="rv-compare-toggle"
              aria-label="Compare with another version"
              value=""
              onValueChange={(next) => next && leave.guard(reviewHref(`media=${version.id}&compare=${next}`))}
              options={[
                { value: "", label: "Compare…" },
                ...asset.versions.filter((item) => item.id !== version.id).reverse().map((item) => ({ value: item.id, label: `${version.label} vs ${item.label}` })),
              ]}
            />
          ))}

          {approved ? (
            <motion.span
              className="rv-stage is-approved"
              role="status"
              initial={reduced ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              suppressHydrationWarning
              title={[`${version.label} approved`, version.workflowStage?.changedBy && `by ${version.workflowStage.changedBy}`, stamp(version.workflowStage?.enteredAt ?? null)].filter(Boolean).join(" ")}
            >
              <Check size={11} />
              Approved
              {version.workflowStage?.changedBy && <span className="rv-stage-by"> · {version.workflowStage.changedBy}</span>}
              {version.workflowStage?.enteredAt && <small suppressHydrationWarning> · {shortDate(version.workflowStage.enteredAt)}</small>}
            </motion.span>
          ) : (version.stageName || asset.stage) && (
            <span className="rv-stage" style={asset.stage ? { borderColor: `${asset.stage.color}66`, color: asset.stage.color } : undefined}>
              {version.stageName ?? asset.stage?.name}
            </span>
          )}
          {surface === "video" && (() => {
            const chip = proxyNotice(proxyStatus);
            return chip && (
              <span className={`rv-proxy-chip is-${chip.tone}`} role="status" title="Review proxy (separate from the workflow stage)">
                {chip.tone === "failed" ? <TriangleAlert size={11} /> : <RotateCcw size={11} />}
                {chip.chip}
              </span>
            );
          })()}

          {mismatches.length > 0 && (
            <span className="rv-spec-warn" role="status" title={mismatches.map((item) => item.message).join(". ")}>
              <TriangleAlert size={11} />
              <span className="rv-spec-text">Off spec<span className="rv-spec-detail">: {mismatches.map((item) => item.short).join(" · ")}</span></span>
            </span>
          )}
        </div>

        <div className="rv-actions">
          {/* The decision: what moves the cut on. Always in view, labelled where there is room. */}
          <div className="rv-actions-decide" role="group" aria-label="Decision">
            {(actions.requestChanges || !view.target) && (
              <button
                type="button"
                onClick={() => setRevisionOpen(!revisionOpen)}
                disabled={!view.target}
                aria-pressed={revisionOpen}
                title={!view.target
                  ? "Move this file into a project to request changes"
                  : approved ? "Reopens this approved cut: posts your note and moves it back to Revision" : "Request changes"}
              >
                <RotateCcw size={14} /><span>Request changes</span>
              </button>
            )}
            {(actions.approve || (!view.target && approval)) && (
              <button
                type="button"
                className="rv-approve"
                disabled={!view.target || writer.busy}
                title={!view.target ? "Move this file into a project to approve it" : `Approve ${version.label}`}
                onClick={() => { writer.setError(null); setApproveOpen(true); }}
              >
                <Check size={14} /><span>Approve</span>
              </button>
            )}
          </div>

          {/* Everything else: sharing on wide screens, the rest behind More. */}
          <div className="rv-actions-tools" role="group" aria-label="Tools">
            {aiQa.available && aiQa.state?.can_run && (
              <button
                type="button" className="rv-ai-btn" onClick={openAiRun} data-testid="ai-qa-run-header" aria-label="Run AI Visual QA"
                disabled={aiQa.review?.status === "QUEUED" || aiQa.review?.status === "PROCESSING"}
                title={aiQa.review?.status === "QUEUED" || aiQa.review?.status === "PROCESSING" ? "AI Visual QA is running" : "Check the visible text for spelling mistakes"}
              >
                <Sparkles size={14} /><span>Run AI Visual QA</span>
              </button>
            )}
            {/* Sharing out needs share rights; a read-only member would only open a refusal. */}
            {canShare && (
              <button type="button" className="rv-share-btn" onClick={() => setShareOpen(!shareOpen)} aria-pressed={shareOpen} title="Share with guest reviewers">
                <Share2 size={14} /><span>Share</span>
              </button>
            )}
            {downloadHref && (
              <a className="rv-icon rv-download-btn" href={downloadHref} download aria-label="Download" title="Download">
                <HardDriveDownload size={14} />
              </a>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rv-icon rv-more" aria-label="More actions" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="tb-menu rv-menu">
                {canShare && (
                  <DropdownMenuItem className="rv-menu-narrow" onSelect={() => setShareOpen(true)}><Share2 />Share with guests</DropdownMenuItem>
                )}
                {downloadHref && (
                  <DropdownMenuItem className="rv-menu-narrow" asChild>
                    <a href={downloadHref} download><HardDriveDownload />Download</a>
                  </DropdownMenuItem>
                )}
                {timed && (
                  <DropdownMenuItem onSelect={() => void copyMomentLink()}><Link2 />Copy link at {timecode(positionMs)}</DropdownMenuItem>
                )}
                {asset.versions.length > 1 && !comparing && (
                  <>
                    <DropdownMenuSeparator className="rv-menu-narrow" />
                    <DropdownMenuLabel className="rv-menu-narrow">Compare {version.label} with</DropdownMenuLabel>
                    {asset.versions.filter((item) => item.id !== version.id).reverse().map((item) => (
                      <DropdownMenuItem key={item.id} className="rv-menu-narrow" onSelect={() => leave.guard(reviewHref(`media=${version.id}&compare=${item.id}`))}>
                        <Columns2 />{item.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setKeysOpen(true)}><Keyboard />Keyboard shortcuts<span className="rv-menu-key">?</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} />

      {(approval || actions.approve === "client") && (
        <ConfirmDialog
          open={approveOpen}
          title={`Approve ${version.label} of “${asset.name}”?`}
          body={actions.approve === "client"
            ? <>Your approval is recorded against <strong>{version.label}</strong> only, and the team is notified. A newer version will need its own approval.</>
            : <>This marks <strong>{version.label}</strong> as approved and moves it to {approval?.name}. To reopen it later, use Request changes.</>}
          confirmLabel={writer.busy ? "Approving…" : `Approve ${version.label}`}
          busy={writer.busy}
          onConfirm={approve}
          onCancel={() => setApproveOpen(false)}
        >
          {(openNotes > 0 || (latest && latest.id !== version.id) || writer.error || approveOverride) && (
            <div className="rv-confirm-notes">
              {approveOverride && <p className="rv-confirm-warn" role="alert" data-testid="override-warning"><TriangleAlert size={14} /><span>{approveOverride}</span></p>}
              {openWarning && (
                <p className="rv-confirm-warn" role="alert">
                  <TriangleAlert size={14} />
                  <span>{openWarning}</span>
                </p>
              )}
              {latest && latest.id !== version.id && (
                <p className="rv-confirm-warn"><Info size={14} /><span>{latest.label} is newer than {version.label}.</span></p>
              )}
              {writer.error && <p className="form-error">{writer.error}</p>}
            </div>
          )}
        </ConfirmDialog>
      )}

      <ConfirmDialog
        open={Boolean(leave.pending)}
        title="Leave with unsent work?"
        body={navWarning ?? "You have unsent work on this cut."}
        confirmLabel="Leave"
        cancelLabel="Stay"
        danger
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />

      {clientDecision && (
        <p className={`rv-proof is-${clientDecision.decision}`} role="status" data-testid="client-decision">
          {clientDecision.decision === "approved" ? <BadgeCheck size={15} /> : <RotateCcw size={14} />}
          <strong suppressHydrationWarning>{proofLine(clientDecision)}</strong>
          <span>{proofDetail(clientDecision)}</span>
        </p>
      )}

      {view.notice && <p className="rv-banner" role="status"><TriangleAlert size={14} /><span>{view.notice}</span></p>}
      {initialCommentId && view.target && !linkedNote && (
        <p className="rv-banner" role="status"><Info size={14} /><span>The note this link points to has been deleted or is no longer visible to you.</span></p>
      )}

      {!view.target && (
        <p className="rv-banner is-local" role="status">
          <Info size={14} />
          <span>This file isn&rsquo;t in a project yet. Move it into a project from Files and it becomes a review version automatically, ready for comments and approval.</span>
        </p>
      )}

      {shareOpen && view.target && (
        <SharePanel
          workspaceId={view.target.workspaceId}
          projectId={view.target.projectId}
          projectName={asset.projectName ?? ""}
          invites={view.guestInvites}
          canManage={view.canManageGuests}
          onClose={() => setShareOpen(false)}
        />
      )}

      {revisionOpen && reopenOverride && (
        <p className="rv-banner" role="alert" data-testid="override-warning"><TriangleAlert size={14} /><span>{reopenOverride}</span></p>
      )}
      {revisionOpen && (
        <RevisionForm
          writer={writer} positionMs={positionMs} approved={approved}
          asClient={actions.requestChanges === "client"} versionLabel={version.label}
          onDone={() => setRevisionOpen(false)} onDirtyChange={setRevisionDirty}
        />
      )}

      <div className="rv-body">
        {comparing ? (
          <CompareView left={version} right={comparing.version} sources={sourceFor} handle={compare} />
        ) : (
        <Player
          handle={player}
          surface={surface}
          downloadHref={downloadHref}
          sources={sources}
          proxyStatus={proxyStatus}
          onRerender={target && canWriteTeam ? rerender : null}
          rerendering={rerendering}
          title={version.title}
          notes={notes}
          annotations={annotations}
          pending={pending}
          pendingWindow={pendingWindow}
          canDraw={view.target ? view.canComment && (view.access?.annotate ?? true) : true}
          onTime={setPositionMs}
          onMeta={setMeta}
          highlight={aiHighlight}
          aiMarkers={panel === "ai" ? aiMarkers : []}
          onAiMarker={(id) => { setPanel("ai"); setAiSelected(aiQa.findings.find((f) => f.id === id) ?? null); }}
          onDraw={drawPending}
          onDeleteAnnotation={writer.eraseAnnotation}
          onEditAnnotation={writer.moveAnnotation}
          onFocusNote={setFocusedId}
          mark={mark}
          onMark={setMark}
          loop={loop}
          onStopLoop={stopLoop}
        />
        )}

        <aside className="rv-panel">
          {view.task && version && (
            <TaskPanel
              context={view.task}
              stages={view.taskStages}
              workspaceId={view.workspaceId}
              mediaId={version.id}
              access={view.taskAccess}
              assignees={view.assignees}
              returnTo={returnTo}
              onNavigate={leave.guard}
            />
          )}
          <div className="rv-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "comments"} onClick={() => setPanel("comments")}>
              <MessageSquareText size={14} />Comments
            </button>
            <button type="button" role="tab" aria-selected={panel === "fields"} onClick={() => setPanel("fields")}>
              <SlidersHorizontal size={14} />Fields
            </button>
            {aiQa.available && (
              <button type="button" role="tab" aria-selected={panel === "ai"} onClick={() => setPanel("ai")} data-testid="ai-qa-tab"
                aria-label={aiQa.findings.length > 0 ? (aiCounts.hidden ? `AI QA ${aiCounts.visible} to review, ${aiCounts.hidden} lower-confidence hidden` : `AI QA ${aiCounts.visible} to review`) : "AI QA"}>
                <Sparkles size={14} aria-hidden="true" />AI QA{aiQa.findings.length > 0 && <span className="rv-tab-count" aria-hidden="true">{aiCounts.visible}{aiCounts.hidden > 0 && <small> +{aiCounts.hidden}</small>}</span>}
              </button>
            )}
          </div>
          {aiQa.available && aiTarget && version && (
            <div className="rv-panel-body" hidden={panel !== "ai"}>
              <AiQaPanel
                qa={aiQa}
                target={aiTarget}
                versionLabel={version.label}
                title={version.title}
                selectedId={aiSelected?.id ?? null}
                onSelect={selectAi}
                runRequest={aiRunRequest}
                video={aiVideo}
                scope={aiScope}
                onScope={setAiScope}
                taskTools={canWriteTeam && view.workspaceId && view.role !== "client" && view.taskAccess.create && !view.taskAccess.client
                  ? { workspaceId: view.workspaceId, stages: view.taskStages, assignees: view.assignees } : null}
              />
            </div>
          )}

          {/* Comments stay mounted behind the Fields tab, so switching tabs never drops an
              unsent note or an attached recording. */}
          <div className="rv-panel-body" hidden={panel !== "comments"}>
            <Comments
              view={view}
              writer={writer}
              compareWriter={compareWriter}
              notes={notes}
              positionMs={positionMs}
              focusedId={focusedId}
              pendingAnnotation={pending}
              drawnAtMs={pendingAt}
              onClearAnnotation={clearPending}
              hold={hold}
              onHold={setHold}
              durationMs={meta?.durationMs ?? 0}
              liveNoteIds={liveNoteIds}
              onSeek={seek}
              onCompareSeek={seekCompare}
              canWriteTeam={canWriteTeam}
              clientPreview={clientPreview}
              hiddenTeamNotes={clientPreview ? countNotes(allNotes) - countNotes(notes) : 0}
              onClientPreview={setClientPreview}
              onComposerChange={setComposer}
              timed={timed}
              viewerId={userId}
              mark={mark}
              onMark={setMark}
              onPlayRange={playRange}
              onRestoreAnnotation={setPending}
            />
          </div>
          <AnimatePresence initial={false}>
            {panel === "fields" && (
              <motion.div
                key="fields"
                className="rv-panel-body"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <Fields view={view} writer={writer} meta={meta} embedded={embedded} />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}

/** Notes plus their replies, for the "N team notes hidden" count. */
function countNotes(notes: ReviewNote[]): number {
  return notes.reduce((total, note) => total + 1 + note.replies.length, 0);
}
