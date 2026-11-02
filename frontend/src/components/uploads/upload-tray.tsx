"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2, RotateCcw, Trash2, UploadCloud, X } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  cancelUpload, clearFinished, dismissUpload, etaSeconds, formatBytes, formatEta, formatRate, isActive, percent, retryUpload, trayCounts, trayTotals,
  type UploadItem,
} from "@/lib/upload-store";
import { useUploads } from "@/lib/use-uploads";
import { registerTransport } from "@/lib/upload-store";
import { r2Transport } from "@/lib/r2-upload-transport";
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
    case "queued": return [{ text: queuedLine(item, ahead) }];
    case "uploading": {
      const eta = etaSeconds(item);
      const stats: (Stat | null)[] = [
        { text: `${percent(item)}%` }, { text: `${size(item.loaded)} of ${size(item.size)}`, kind: "size" },
        item.parts && item.parts.total > 1 ? { text: `${item.parts.done}/${item.parts.total} parts`, kind: "parts" } : null,
        item.speed > 0 ? { text: formatRate(item.speed), kind: "speed" } : null, eta !== null ? { text: formatEta(eta), kind: "eta" } : null,
      ];
      return stats.filter((stat): stat is Stat => stat !== null);
    }
    case "processing": return [{ text: `${item.processing?.label ?? "Processing"}…` }];
    case "ready": return [{ text: item.processing?.label ?? "Done" }];
    case "cancelled": return [{ text: "Cancelled" }];
    default: return [{ text: item.error ?? "Failed" }];
  }
}

/**
 * The global upload tray: bottom-right on desktop, a bottom sheet on phones. Mounted once in
 * the root layout, so it (and the uploads) persist across client-side navigation.
 */
export function UploadTray() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const counts = trayCounts(items);
  const busy = counts.active > 0;

  // Direct-to-R2 for Files uploads; it falls back to the form POST when the server has it off.
  useEffect(() => registerTransport(r2Transport), []);

  // Closing the tab mid-upload loses it: ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Everything landed and nothing needs attention: get out of the way (it used to sit over
  // primary actions such as "Send comment" until "Clear finished" was clicked).
  const allDone = items.length > 0 && !busy && counts.processing === 0 && counts.failed === 0;
  useEffect(() => {
    if (!allDone) return;
    const timer = window.setTimeout(clearFinished, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [allDone, items.length]);

  if (!items.length) return null;
  const title = busy
    ? `Uploading ${counts.active} ${counts.active === 1 ? "file" : "files"}`
    : counts.processing ? `Processing ${counts.processing}` : counts.failed ? `${counts.failed} upload${counts.failed === 1 ? "" : "s"} failed` : "Uploads complete";
  const totals = trayTotals(items);
  const overall = totals.percent;
  // Position in the queue: how many waiting uploads will start before each one.
  const ahead = new Map<string, number>();
  items.filter((item) => item.status === "queued").forEach((item, index) => ahead.set(item.id, index));

  return (
    <section className={`ut ${collapsed ? "is-collapsed" : ""}`} aria-label="Uploads" data-testid="upload-tray">
      <header className="ut-head">
        <button type="button" className="ut-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="ut-list">
          <span className="ut-icon" aria-hidden="true">
            {busy || counts.processing ? <Loader2 className="ut-spin" /> : counts.failed ? <AlertTriangle /> : <CheckCircle2 />}
          </span>
          <span className="ut-title" role="status" aria-live="polite">{title}</span>
          <span className="ut-badge" data-testid="upload-tray-count">{items.length}</span>
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
                  {item.status === "failed" && item.retryable !== false && <button type="button" onClick={() => retryUpload(item.id)} aria-label={`Retry ${item.name}`} title="Retry"><RotateCcw /></button>}
                  {item.status === "ready" && item.href && <Link href={item.href} aria-label={`Open ${item.name}`} title="Open"><ExternalLink /></Link>}
                  {isActive(item)
                    ? <button type="button" onClick={() => cancelUpload(item.id)} aria-label={`Cancel ${item.name}`} title="Cancel"><X /></button>
                    : item.status !== "processing" && <button type="button" onClick={() => dismissUpload(item.id)} aria-label={`Remove ${item.name} from the list`} title="Remove"><X /></button>}
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
                {item.status === "ready" && item.href && <Link className="ut-open" href={item.href}>Open</Link>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
