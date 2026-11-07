"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2, RotateCcw, Trash2, UploadCloud, X } from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  cancelUpload, cancelAllUploads, resumeInterruptedUploads, clearFinished, restoreParked, resumeFromFiles, dismissUpload, etaSeconds, formatBytes, formatEta, formatRate, isActive, percent, retryUpload, trayCounts, trayTotals,
  type UploadItem,
} from "@/lib/upload-store";
import { useUploads } from "@/lib/use-uploads";
import { registerTransport } from "@/lib/upload-store";
import { r2Transport } from "@/lib/r2-upload-transport";
import { stagedFromDrop } from "@/lib/folder-upload";
import { maintainTransferWakeLock } from "@/lib/transfer-lifecycle";
import { subscribeDownloads, getDownloads, cancelAllDownloads } from "@/lib/download-store";
import { useSyncExternalStore } from "react";
import "./upload-tray.css";

const size = formatBytes;
/** How long "Uploads complete" stays up before the tray dismisses itself. */
export const AUTO_DISMISS_MS = 5000;

type Stat = { text: string; kind?: "parts" | "speed" | "eta" | "size" };

/** Plain-language wording for a waiting item; `ahead` is how many queued uploads go first. */
export function queuedLine(item: Pick<UploadItem, "loaded">, ahead = 0) {
  return [
    "Waiting to upload",
    item.loaded > 0 ? `${size(item.loaded)} already sent` : null,
    ahead > 0 ? `${ahead} ahead` : null,
  ].filter(Boolean).join(" · ");
}

/** The status line as separate pieces so narrow trays can wrap them or drop the less useful ones. */
export function statusStats(item: UploadItem, ahead = 0): Stat[] {
  switch (item.status) {
    case "paused": return ([
      { text: item.expired ? "Paused · pick file to start again" : "Paused · pick file to resume" },
      item.parts && item.parts.done > 0 && !item.expired ? { text: `${item.parts.done}/${item.parts.total} parts sent`, kind: "parts" } : null,
    ] as (Stat | null)[]).filter((stat): stat is Stat => stat !== null);
    case "queued": return [{ text: queuedLine(item, ahead) }];
    case "uploading": {
      const eta = etaSeconds(item);
      const stats: (Stat | null)[] = [
        ...(item.resumed ? [{ text: "Resuming saved upload" }] : []),
        { text: `${percent(item)}%` }, { text: `${size(item.loaded)} of ${size(item.size)}`, kind: "size" },
        item.parts && item.parts.total > 1 ? { text: `${item.parts.done}/${item.parts.total} parts`, kind: "parts" } : null,
        item.speed > 0 ? { text: formatRate(item.speed), kind: "speed" } : null, eta !== null ? { text: formatEta(eta), kind: "eta" } : null,
      ];
      return stats.filter((stat): stat is Stat => stat !== null);
    }
    case "processing": return [{ text: `${item.processing?.label ?? "Processing"}…` }];
    case "ready": return [{ text: item.processing?.label ?? "Done" }];
    case "cancelled": return [{ text: item.hasUploadSession ? "Stopping upload · cleaning up saved parts…" : "Cancelled" }];
    default: return [{ text: item.error ?? "Failed" }];
  }
}

/**
 * The global upload tray: bottom-right on desktop, a bottom sheet on phones. Mounted once in
 * the root layout, so it (and the uploads) persist across client-side navigation.
 */
export function UploadTray() {
  const items = useUploads();
  const downloads = useSyncExternalStore(subscribeDownloads, getDownloads, getDownloads);
  const [collapsed, setCollapsed] = useState(false);
  const counts = trayCounts(items);
  const busy = counts.active > 0;
  const transfersBusy = busy || downloads.length > 0;
  useEffect(() => maintainTransferWakeLock(transfersBusy), [transfersBusy]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === "visible") resumeInterruptedUploads(); };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(resume, 30_000);
    return () => { window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); window.clearInterval(timer); };
  }, []);

  // Direct-to-R2 for Files uploads; it falls back to the form POST when the server has it off.
  useEffect(() => registerTransport(r2Transport), []);
  // Uploads the last page left unfinished come back as "Paused" until their file is picked again.
  useEffect(() => { restoreParked(); }, []);
  const picker = useRef<HTMLInputElement>(null);
  const [resumeFor, setResumeFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const resumeWith = (files: File[], onlyId?: string | null) => {
    if (!files.length) return;
    const { resumed, unmatched } = resumeFromFiles(files, onlyId ?? undefined);
    setNotice(resumed ? null : unmatched.length ? "That is not the same file (name, size and date must match)." : null);
  };
  const openPicker = (id: string) => { setResumeFor(id); picker.current?.click(); };
  const onDrop = async (event: DragEvent<HTMLElement>) => {
    if (!counts.paused) return;
    event.preventDefault();
    const staged = await stagedFromDrop(event.dataTransfer);
    resumeWith(staged.map((entry) => entry.file));
  };

  // Closing the tab mid-upload loses it: ask first.
  useEffect(() => {
    if (!transfersBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [transfersBusy]);

  // Everything landed and nothing needs attention: get out of the way (it used to sit over
  // primary actions such as "Send comment" until "Clear finished" was clicked).
  const allDone = items.length > 0 && !busy && counts.processing === 0 && counts.failed === 0 && counts.paused === 0 && !items.some((item) => item.status === "cancelled" && item.hasUploadSession);
  useEffect(() => {
    if (!allDone || downloads.length) return;
    const timer = window.setTimeout(clearFinished, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [allDone, items.length, downloads.length]);

  const cancellable = items.some((item) => isActive(item) || item.status === "paused" || ((item.status === "failed" || item.status === "cancelled") && item.hasUploadSession)) || downloads.length > 0;
  const cancelAll = () => {
    if (!window.confirm("Cancel all unfinished uploads and folder downloads? Saved upload parts will be deleted. Browser-managed downloads must be cancelled in your browser.")) return;
    cancelAllDownloads(); void cancelAllUploads();
  };
  if (!items.length && !downloads.length) return null;
  const title = busy
    ? `Uploading ${counts.active} ${counts.active === 1 ? "file" : "files"}`
    : counts.paused ? `${counts.paused} upload${counts.paused === 1 ? "" : "s"} paused` : counts.processing ? `Processing ${counts.processing}` : counts.failed ? `${counts.failed} upload${counts.failed === 1 ? "" : "s"} failed` : downloads.length ? `Downloading ${downloads.length} folder${downloads.length === 1 ? "" : "s"}` : "Uploads complete";
  const totals = trayTotals(items);
  const overall = totals.percent;
  // Position in the queue: how many waiting uploads will start before each one.
  const ahead = new Map<string, number>();
  items.filter((item) => item.status === "queued").forEach((item, index) => ahead.set(item.id, index));

  return (
    <section className={`ut ${collapsed ? "is-collapsed" : ""}`} aria-label="Uploads" data-testid="upload-tray"
      onDragOver={(event) => { if (counts.paused) event.preventDefault(); }} onDrop={(event) => { void onDrop(event); }}>
      <input ref={picker} type="file" multiple hidden data-testid="upload-resume-input"
        onChange={(event) => { resumeWith(Array.from(event.target.files ?? []), resumeFor); event.target.value = ""; setResumeFor(null); }} />
      <header className="ut-head">
        <button type="button" className="ut-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="ut-list">
          <span className="ut-icon" aria-hidden="true">
            {busy || counts.processing ? <Loader2 className="ut-spin" /> : counts.failed ? <AlertTriangle /> : <CheckCircle2 />}
          </span>
          <span className="ut-title" role="status" aria-live="polite">{title}</span>
          <span className="ut-badge" data-testid="upload-tray-count">{items.length + downloads.length}</span>
          {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          <span className="sr-only">{collapsed ? "Show uploads" : "Minimise uploads"}</span>
        </button>
        {counts.finished > 0 && !collapsed && (
          <button type="button" className="ut-clear" onClick={clearFinished} title="Clear finished uploads"><Trash2 aria-hidden="true" /><span>Clear finished</span></button>
        )}
        {allDone && (
          <button type="button" className="ut-close" onClick={clearFinished} aria-label="Close uploads" title="Close"><X aria-hidden="true" /></button>
        )}
      </header>
      {cancellable && <div className="ut-transfer-actions"><button type="button" className="ut-clear" onClick={cancelAll}>Cancel all</button><small>Keep this tab open. Interrupted uploads resume when you return.</small></div>}
      {downloads.length > 0 && <p className="ut-notice">Folder downloads: {downloads.map((item) => item.name).join(", ")}. Browser downloads are managed by your browser.</p>}
      {collapsed && busy && <i className="ut-overall" style={{ width: `${overall}%` }} aria-hidden="true" />}
      {!collapsed && busy && totals.size > 0 && (
        <div className="ut-summary" data-testid="upload-tray-summary">
          <div className="ut-summary-top">
            <span>{size(totals.loaded)} of {size(totals.size)} · <b>{size(totals.remaining)} remaining</b></span>
            <strong>{totals.percent}%</strong>
          </div>
          <div className="ut-bar" role="progressbar" aria-label="Total upload progress" aria-valuenow={totals.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${totals.percent}%` }} /></div>
          <small>{[totals.speed > 0 ? formatRate(totals.speed) : "Starting…", totals.eta !== null ? formatEta(totals.eta) : null].filter(Boolean).join(" · ")}</small>
        </div>
      )}
      {!collapsed && notice && <p className="ut-notice" role="alert">{notice}</p>}
      {!collapsed && counts.paused > 0 && !notice && <p className="ut-notice">Pick or drop the same files here to continue.</p>}
      {!collapsed && (
        <ul className="ut-list" id="ut-list">
          {items.map((item) => (
            <li key={item.id} className={`ut-row is-${item.status}`} data-testid="upload-row" data-status={item.status}>
              <div className="ut-row-top">
                <UploadCloud className="ut-file" aria-hidden="true" />
                <div className="ut-name">
                  <strong title={item.name}>{item.name}</strong>
                  <small title={item.destination ?? undefined}>{size(item.size)}{item.destination ? ` · ${item.destination}` : ""}</small>
                </div>
                <div className="ut-actions">
                  {item.status === "paused" && <button type="button" onClick={() => openPicker(item.id)} aria-label={`Resume ${item.name}`} title="Resume"><RotateCcw /></button>}
                  {item.status === "failed" && item.retryable !== false && <button type="button" onClick={() => retryUpload(item.id)} aria-label={`Retry ${item.name}`} title="Retry"><RotateCcw /></button>}
                  {item.status === "ready" && item.href && <Link href={item.href} aria-label={`Open ${item.name}`} title="Open"><ExternalLink /></Link>}
                  {isActive(item)
                    ? <button type="button" onClick={() => cancelUpload(item.id)} aria-label={`Cancel ${item.name}`} title="Cancel"><X /></button>
                    : item.status !== "processing" && !(item.status === "cancelled" && item.hasUploadSession) && <button type="button" onClick={() => dismissUpload(item.id)} aria-label={`Remove ${item.name} from the list`} title="Remove"><X /></button>}
                </div>
              </div>
              <div className="ut-bar" role="progressbar" aria-valuenow={percent(item)} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.name} progress`}>
                <i style={{ width: `${percent(item)}%` }} />
              </div>
              <p className="ut-status">
                {item.status === "processing" && <Loader2 className="ut-spin" aria-hidden="true" />}
                {item.status === "ready" && <CheckCircle2 aria-hidden="true" />}
                {item.status === "failed" && <AlertTriangle aria-hidden="true" />}
                {item.status === "failed"
                  ? <span className="ut-error">{item.error ?? "Failed"}</span>
                  : <span className="ut-stats">{statusStats(item, ahead.get(item.id)).map((stat) => <span key={stat.text} className={stat.kind ? `ut-stat is-${stat.kind}` : "ut-stat"}>{stat.text}</span>)}</span>}
                {item.status === "failed" && item.retryable !== false && <button type="button" className="ut-retry" onClick={() => retryUpload(item.id)}>Retry</button>}
                {item.status === "paused" && <button type="button" className="ut-retry" onClick={() => openPicker(item.id)}>Resume</button>}
                {item.status === "ready" && item.href && <Link className="ut-open" href={item.href}>Open</Link>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
