"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BadgeCheck, Sparkles, Check, ChevronLeft, Columns2, HardDriveDownload, Info, Keyboard, Link2, MessageSquareText, MoreHorizontal, RotateCcw, Share2, SlidersHorizontal, TriangleAlert, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { markIn, markOut, type LoopRange, type MarkRange } from "@/lib/review-range";
import { timecode } from "@/lib/timecode";
import { playerShouldIgnoreKey } from "./player-keys";
import { ShortcutsDialog } from "./shortcuts";
import type { ReviewView } from "@/lib/review-view";
import { useLocalReview } from "@/lib/review-local";
import { clientView, type NoteDrawing, type ReviewNote } from "@/lib/review-notes";
import type { AnnotationElement } from "@/lib/api";
import { loadDraft, patchDraft, unsavedWarning } from "@/lib/review-drafts";
import { DEFAULT_HOLD, displayWindow, drawingEndMs, rememberedHold, windowOpacity, type HoldChoice } from "@/lib/annotation-window";
import { specMismatches } from "@/lib/project-brief";
import { latestFor, openNotesWarning, proofDetail, proofLine, reviewBarActions } from "@/lib/review-decisions";
import { ConfirmDialog } from "@/components/tasks/task-dialogs";
import { Comments, RevisionForm, type ComposerState } from "./comments";
import { Fields } from "./fields";
import { CompareView, type CompareHandle } from "./compare";
import { useLeaveGuard } from "./leave-guard";
import "../tasks/tasks.css";
import { Player, type DrawnAnnotation, type PlayerHandle, type PlayerSource } from "./player";
import { SharePanel } from "./share-panel";
import { PublishDialog } from "./publish-dialog";
import { TaskPanel } from "./task-panel";
import { REVIEW_FROM_KEY } from "@/components/universal-review";
import { returnLabel, reviewSurface, safeReturnPath } from "@/lib/open-in-review";
import { useReviewWriter } from "./writer";
import { AiQaPanel, useAiQa } from "./ai-qa-panel";
import { hasRegion, type AiFinding, type AiTarget } from "@/lib/ai-qa";

type Props = {
  view: ReviewView; author: string; userId?: string | null; initialShareOpen?: boolean; embedded?: boolean;
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

export function ReviewWorkspace({ view, author, userId = null, initialShareOpen = false, embedded = false, initialCommentId = null, initialTimeMs = null, returnTo = null }: Props) {
  const router = useRouter();
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
  const local = useLocalReview(view.version?.id ?? null);

  const [panel, setPanel] = useState<"comments" | "fields" | "ai">("comments");
  const [aiSelected, setAiSelected] = useState<AiFinding | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [meta, setMeta] = useState<{ durationMs: number; width: number; height: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(initialCommentId);
  const [pending, setPending] = useState<AnnotationElement | null>(null);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [clientPreview, setClientPreview] = useState(false);
  const [composer, setComposer] = useState<ComposerState>({ text: false, recording: false, startMs: null });
  // How long the drawing being composed will stay on screen. Lives beside `pending`, the
  // drawing itself, so both are saved to and restored from the draft together.
  const [hold, setHold] = useState<HoldChoice>(DEFAULT_HOLD);
  const [revisionDirty, setRevisionDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  /** In/out points for the next note (I/O keys, shift-drag on the timeline, the Range button). */
  const [mark, setMark] = useState<MarkRange | null>(null);
  /** A range note playing on repeat; Esc or a seek elsewhere ends it. */
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);

  const { asset, version } = view;
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

  const localNotes = view.target ? 0 : local.notes.length;
  const navWarning = unsavedWarning({ text: composer.text, annotation: Boolean(pending), recording: composer.recording, revision: revisionDirty, localNotes: 0 });
  const unloadWarning = unsavedWarning({ text: composer.text, annotation: Boolean(pending), recording: composer.recording, revision: revisionDirty, localNotes });
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
    for (const item of [...view.annotations, ...local.annotations]) {
      if (item.review_comment_id && !drawings.has(item.review_comment_id)) {
        drawings.set(item.review_comment_id, {
          annotationId: item.id, elements: item.elements, startMs: item.start_time_ms,
          endMs: endOf(item.id, item.end_time_ms), authorId: item.author_user_id,
        });
      }
    }
    // Optimistic posts, edits, resolves and deletes are laid over the server's notes here,
    // so the feed, the timeline markers and the counts all agree while a save is in flight.
    return applyWrites([...view.notes, ...local.notes]).map((note) => {
      const drawing = drawings.get(note.id);
      return drawing ? { ...note, drawing, drawingWindow: displayWindow(drawing.startMs, drawing.endMs) } : note;
    });
  }, [applyWrites, endOf, local.annotations, local.notes, view.annotations, view.notes]);
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
  const annotations: DrawnAnnotation[] = useMemo(() => [
    ...view.annotations
      .filter((item) => !clientPreview || !item.review_comment_id || !teamNoteIds.has(item.review_comment_id))
      .map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms, endMs: endOf(item.id, item.end_time_ms), noteId: item.review_comment_id })),
    ...local.annotations.map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms, endMs: item.end_time_ms, noteId: item.review_comment_id })),
  ], [clientPreview, endOf, local.annotations, teamNoteIds, view.annotations]);
  // A library file with no review version yet can be published into a project from here.
  const canPublish = Boolean(!view.target && view.publish && view.workspaceId);
  const canWriteTeam = Boolean(view.target && userId && view.members.some((member) => member.id === userId));

  const sources: PlayerSource[] = useMemo(() => {
    if (!version) return [];
    const list: PlayerSource[] = [];
    if (version.target && version.src) list.push({ id: "proxy", label: "Review proxy", src: version.src });
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
  const openWarning = version ? openNotesWarning(openNotes, version.label) : null;

  async function approve() {
    if (actions.approve === "client") {
      if (await writer.decideAsClient("approved")) setApproveOpen(false);
      return;
    }
    if (!approval) return;
    if (await writer.moveToStage(approval.id)) setApproveOpen(false);
  }
  const sourceFor = (item: typeof version) => {
    if (!item) return null;
    if (item.target && item.src) return item.src;
    if (item.assetFileId && view.workspaceId) return `/api/workspaces/${view.workspaceId}/asset-files/${item.assetFileId}/download/`;
    return item.src;
  };
  const clearPending = useCallback(() => setPending(null), []);
  // The drawing being composed, previewed on the timeline as the span it will cover.
  const pendingWindow = useMemo(() => {
    // A marked range is drawn by the player itself, with handles.
    if (mark?.outMs != null) return null;
    if (!pending || composer.startMs === null || !(surface === "video" || surface === "audio")) return null;
    return { startMs: composer.startMs, endMs: drawingEndMs(composer.startMs, hold, meta?.durationMs ?? 0) };
  }, [composer.startMs, hold, mark?.outMs, meta?.durationMs, pending, surface]);
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
  // AI Visual QA: images only in v1, and only for workspace teammates (the API says the rest).
  const aiTarget = useMemo<AiTarget | null>(
    () => view.target && surface === "image" && canWriteTeam
      ? { workspaceId: view.target.workspaceId, projectId: view.target.projectId, versionId: view.target.versionId }
      : null,
    [view.target, surface, canWriteTeam],
  );
  const aiQa = useAiQa(aiTarget);
  const aiHighlight = panel === "ai" && aiSelected && hasRegion(aiSelected.region) ? aiSelected.region : null;

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
          <select
            className="rv-version"
            aria-label="Version"
            value={version.id}
            onChange={(event) => leave.guard(reviewHref(`media=${event.target.value}`))}
          >
            {[...asset.versions].reverse().map((item) => (
              <option key={item.id} value={item.id}>{item.label}{item.id === latest?.id ? " · Latest" : ""}</option>
            ))}
          </select>

          {asset.versions.length > 1 && (comparing ? (
            <button type="button" className="rv-compare-toggle is-on" onClick={() => leave.guard(reviewHref(`media=${version.id}`))}>
              <X size={13} />Exit compare
            </button>
          ) : (
            <select
              className="rv-compare-toggle"
              aria-label="Compare with another version"
              value=""
              onChange={(event) => event.target.value && leave.guard(reviewHref(`media=${version.id}&compare=${event.target.value}`))}
            >
              <option value="">Compare…</option>
              {asset.versions.filter((item) => item.id !== version.id).reverse().map((item) => (
                <option key={item.id} value={item.id}>{version.label} vs {item.label}</option>
              ))}
            </select>
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
            {canPublish && (
              <button type="button" className="rv-publish-btn" onClick={() => setPublishOpen(true)} title="Make this file a review version in a project, keeping this session's notes">
                <UploadCloud size={14} /><span>Publish to project</span>
              </button>
            )}
            {(actions.requestChanges || !view.target) && (
              <button
                type="button"
                onClick={() => setRevisionOpen(!revisionOpen)}
                disabled={!view.target}
                aria-pressed={revisionOpen}
                title={!view.target
                  ? "Publish this file to a project to request changes"
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
                title={!view.target ? "Publish this file to a project to approve it" : `Approve ${version.label}`}
                onClick={() => { writer.setError(null); setApproveOpen(true); }}
              >
                <Check size={14} /><span>Approve</span>
              </button>
            )}
          </div>

          {/* Everything else: sharing on wide screens, the rest behind More. */}
          <div className="rv-actions-tools" role="group" aria-label="Tools">
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
          onConfirm={() => void approve()}
          onCancel={() => setApproveOpen(false)}
        >
          {(openNotes > 0 || (latest && latest.id !== version.id) || writer.error) && (
            <div className="rv-confirm-notes">
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
          <span>
            This file has not been published into a project as a review version, so its notes,
            drawings and recordings are kept on this device for this session only.
            {canPublish
              ? <> Publish it to a project to save them as comments.</>
              : <> You&rsquo;ll be warned before reloading or closing the tab while it has notes.</>}
          </span>
          {canPublish && <button type="button" className="rv-banner-action" onClick={() => setPublishOpen(true)}>Publish to project</button>}
        </p>
      )}

      {canPublish && view.publish && view.workspaceId && (
        <PublishDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          workspaceId={view.workspaceId}
          mediaId={version.id}
          fileName={version.title}
          options={view.publish}
          local={local}
        />
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
          title={version.title}
          notes={notes}
          annotations={annotations}
          pending={pending}
          pendingWindow={pendingWindow}
          canDraw={view.target ? view.canComment && (view.access?.annotate ?? true) : true}
          onTime={setPositionMs}
          onMeta={setMeta}
          highlight={aiHighlight}
          onDraw={setPending}
          onDeleteAnnotation={writer.eraseAnnotation}
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
              <button type="button" role="tab" aria-selected={panel === "ai"} onClick={() => setPanel("ai")} data-testid="ai-qa-tab">
                <Sparkles size={14} />AI QA{aiQa.findings.length > 0 && <span className="rv-tab-count">{aiQa.findings.filter((f) => f.status === "PENDING" || f.status === "ACCEPTED").length}</span>}
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
                onSelect={setAiSelected}
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
