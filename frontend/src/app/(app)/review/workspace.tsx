"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, HardDriveDownload, Info, MessageSquareText, RotateCcw, Share2, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import type { ReviewView } from "@/lib/review-view";
import { useLocalReview } from "@/lib/review-local";
import type { ReviewNote } from "@/lib/review-notes";
import type { AnnotationElement } from "@/lib/api";
import { Comments, RevisionForm } from "./comments";
import { Fields } from "./fields";
import { CompareView } from "./compare";
import { Player, type DrawnAnnotation, type PlayerHandle, type PlayerSource } from "./player";
import { SharePanel } from "./share-panel";
import { useReviewWriter } from "./writer";

type Props = { view: ReviewView; author: string; initialShareOpen?: boolean };

export function ReviewWorkspace({ view, author, initialShareOpen = false }: Props) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const player = useRef<PlayerHandle>(null);
  const writer = useReviewWriter(view, author);
  const local = useLocalReview(view.version?.id ?? null);

  const [panel, setPanel] = useState<"comments" | "fields">("comments");
  const [positionMs, setPositionMs] = useState(0);
  const [meta, setMeta] = useState<{ durationMs: number; width: number; height: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pending, setPending] = useState<AnnotationElement | null>(null);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [revisionOpen, setRevisionOpen] = useState(false);

  const { asset, version } = view;

  /**
   * Server notes and device-local notes render through exactly the same component. A cut
   * has one or the other, never both, but concatenating rather than branching is what
   * keeps the two paths from drifting apart.
   */
  const notes: ReviewNote[] = useMemo(() => [...view.notes, ...local.notes], [local.notes, view.notes]);
  const annotations: DrawnAnnotation[] = useMemo(() => [
    ...view.annotations.map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms })),
    ...local.annotations.map((item) => ({ id: item.id, elements: item.elements, startMs: item.start_time_ms })),
  ], [local.annotations, view.annotations]);

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
  const comparing = view.comparison;
  const latest = asset?.versions[asset.versions.length - 1] ?? null;
  const sourceFor = (item: typeof version) => {
    if (!item) return null;
    if (item.target && item.src) return item.src;
    if (item.assetFileId && view.workspaceId) return `/api/workspaces/${view.workspaceId}/asset-files/${item.assetFileId}/download/`;
    return item.src;
  };
  const seek = (ms: number) => player.current?.seek(ms);

  if (!asset || !version) {
    return (
      <div className="rv">
        <header className="rv-top">
          <Link href="/files" className="rv-back"><ChevronLeft size={16} />Files</Link>
          <div className="rv-crumbs"><strong>Nothing to review</strong></div>
        </header>
        <p className="rv-blank">
          {view.notice ?? "Upload a video from Files or a project, then open it here to start a review."}
        </p>
      </div>
    );
  }

  return (
    <div className="rv">
      <header className="rv-top">
        <Link href={asset.projectId ? "/projects" : "/files"} className="rv-back" aria-label="Back">
          <ChevronLeft size={16} />
        </Link>

        <nav className="rv-crumbs" aria-label="Location">
          {[asset.clientName, asset.projectName, asset.folderName].filter(Boolean).map((part) => (
            <span key={part}>{part}<i aria-hidden="true">/</i></span>
          ))}
          <strong title={version.title}>{version.title}</strong>
        </nav>

        <select
          className="rv-version"
          aria-label="Version"
          value={version.id}
          onChange={(event) => router.push(`/review?media=${event.target.value}`)}
        >
          {[...asset.versions].reverse().map((item) => (
            <option key={item.id} value={item.id}>{item.label}{item.id === latest?.id ? " · Latest" : ""}</option>
          ))}
        </select>

        {asset.versions.length > 1 && (comparing ? (
          <button type="button" className="rv-compare-toggle is-on" onClick={() => router.push(`/review?media=${version.id}`)}>
            <X size={13} />Exit compare
          </button>
        ) : (
          <select
            className="rv-compare-toggle"
            aria-label="Compare with another version"
            value=""
            onChange={(event) => event.target.value && router.push(`/review?media=${version.id}&compare=${event.target.value}`)}
          >
            <option value="">Compare…</option>
            {asset.versions.filter((item) => item.id !== version.id).reverse().map((item) => (
              <option key={item.id} value={item.id}>{version.label} vs {item.label}</option>
            ))}
          </select>
        ))}

        {(version.stageName || asset.stage) && (
          <span className="rv-stage" style={asset.stage ? { borderColor: `${asset.stage.color}66`, color: asset.stage.color } : undefined}>
            {version.stageName ?? asset.stage?.name}
          </span>
        )}

        <div className="rv-actions">
          <button type="button" onClick={() => setRevisionOpen(!revisionOpen)} disabled={!view.target}>
            <RotateCcw size={14} />Request changes
          </button>
          {approval && (
            <button type="button" className="rv-approve" disabled={!view.target || writer.busy} onClick={() => void writer.moveToStage(approval.id)}>
              <Check size={14} />Approve
            </button>
          )}
          {view.target && (
            <button type="button" onClick={() => setShareOpen(!shareOpen)} aria-pressed={shareOpen}>
              <Share2 size={14} />Share
            </button>
          )}
          {sources.length > 0 && (
            <a className="rv-icon" href={sources[sources.length - 1].src} download aria-label="Download" title="Download">
              <HardDriveDownload size={14} />
            </a>
          )}
        </div>
      </header>

      {view.notice && <p className="rv-banner" role="status"><TriangleAlert size={14} /><span>{view.notice}</span></p>}

      {!view.target && (
        <p className="rv-banner is-local" role="status">
          <Info size={14} />
          <span>
            This file has not been published into a project as a review version, so its notes,
            drawings and recordings are kept on this device for this session only.
          </span>
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

      {revisionOpen && (
        <RevisionForm writer={writer} positionMs={positionMs} onDone={() => setRevisionOpen(false)} />
      )}

      <div className="rv-body">
        {comparing ? (
          <CompareView left={version} right={comparing.version} sources={sourceFor} />
        ) : (
        <Player
          handle={player}
          sources={sources}
          title={version.title}
          notes={notes}
          annotations={annotations}
          pending={pending}
          canDraw={view.target ? view.canComment : true}
          onTime={setPositionMs}
          onMeta={setMeta}
          onDraw={setPending}
          onDeleteAnnotation={writer.eraseAnnotation}
          onFocusNote={setFocusedId}
        />
        )}

        <aside className="rv-panel">
          <div className="rv-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "comments"} onClick={() => setPanel("comments")}>
              <MessageSquareText size={14} />Comments
            </button>
            <button type="button" role="tab" aria-selected={panel === "fields"} onClick={() => setPanel("fields")}>
              <SlidersHorizontal size={14} />Fields
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panel}
              className="rv-panel-body"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {panel === "comments" ? (
                <Comments
                  view={view}
                  writer={writer}
                  notes={notes}
                  positionMs={positionMs}
                  focusedId={focusedId}
                  pendingAnnotation={pending}
                  onClearAnnotation={() => setPending(null)}
                  onSeek={seek}
                />
              ) : (
                <Fields view={view} writer={writer} meta={meta} />
              )}
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}
