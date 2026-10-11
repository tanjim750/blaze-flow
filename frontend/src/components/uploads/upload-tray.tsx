"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Loader2, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  cancelUpload, clearFinished, dismissUpload, etaSeconds, formatEta, formatRate, isActive, percent, retryUpload, trayCounts, useUploads,
  type UploadItem,
} from "@/lib/upload-store";
import "./upload-tray.css";

function size(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function statusLine(item: UploadItem) {
  switch (item.status) {
    case "queued": return "Waiting…";
    case "uploading": {
      const eta = etaSeconds(item);
      return [`${percent(item)}%`, item.speed > 0 ? formatRate(item.speed) : null, eta !== null ? formatEta(eta) : null].filter(Boolean).join(" · ");
    }
    case "processing": return `${item.processing?.label ?? "Processing"}…`;
    case "ready": return item.processing?.label ?? "Done";
    case "cancelled": return "Cancelled";
    default: return item.error ?? "Failed";
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

  // Closing the tab mid-upload loses it: ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  if (!items.length) return null;
  const title = busy
    ? `Uploading ${counts.active} ${counts.active === 1 ? "file" : "files"}`
    : counts.processing ? `Processing ${counts.processing}` : counts.failed ? `${counts.failed} upload${counts.failed === 1 ? "" : "s"} failed` : "Uploads complete";
  const overall = items.length ? Math.round(items.reduce((sum, item) => sum + percent(item), 0) / items.length) : 0;

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
      </header>
      {collapsed && busy && <i className="ut-overall" style={{ width: `${overall}%` }} aria-hidden="true" />}
      {!collapsed && (
        <ul className="ut-list" id="ut-list">
          {items.map((item) => (
            <li key={item.id} className={`ut-row is-${item.status}`} data-testid="upload-row" data-status={item.status}>
              <div className="ut-row-top">
                <UploadCloud className="ut-file" aria-hidden="true" />
                <div className="ut-name">
                  <strong title={item.name}>{item.name}</strong>
                  <small>{size(item.size)}{item.destination ? ` · ${item.destination}` : ""}</small>
                </div>
                <div className="ut-actions">
                  {item.status === "failed" && <button type="button" onClick={() => retryUpload(item.id)} aria-label={`Retry ${item.name}`} title="Retry"><RotateCcw /></button>}
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
                <span>{statusLine(item)}</span>
                {item.status === "failed" && <button type="button" className="ut-retry" onClick={() => retryUpload(item.id)}>Retry</button>}
                {item.status === "ready" && item.href && <Link className="ut-open" href={item.href}>Open</Link>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
