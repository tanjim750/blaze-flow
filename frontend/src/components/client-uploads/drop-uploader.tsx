"use client";

import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { CircleAlert, CircleCheck, CloudUpload, FileText, Film, Image as ImageIcon, Music, RotateCcw, X } from "lucide-react";
import {
  acceptedSummary, formatBytes, kindOf, newBatchId, rejectReason, sendFile, type CallResult, type UploadKind,
} from "@/lib/client-uploads";
import "./client-uploads.css";

type ItemStatus = "queued" | "uploading" | "done" | "error" | "rejected";
export type QueueItem = { id: string; file: File; status: ItemStatus; progress: number | null; error: string | null };

const CONCURRENCY = 2;
const RETRY_DELAY_MS = 900;

function KindIcon({ file }: { file: File }) {
  const kind = kindOf(file);
  const props = { size: 16, "aria-hidden": true } as const;
  if (kind === "video") return <Film {...props} />;
  if (kind === "image") return <ImageIcon {...props} />;
  if (kind === "audio") return <Music {...props} />;
  return <FileText {...props} />;
}

/** "3 of 5 sent", "All 5 files sent", "" for an empty queue. */
export function queueSummary(items: Pick<QueueItem, "status">[]): string {
  const counted = items.filter((item) => item.status !== "rejected");
  if (!counted.length) return "";
  const done = counted.filter((item) => item.status === "done").length;
  if (done === counted.length) return counted.length === 1 ? "File sent" : `All ${counted.length} files sent`;
  return `${done} of ${counted.length} sent`;
}

/**
 * Drag-and-drop (or pick) files and send each one with its own progress bar.
 *
 * Files are checked against the size and type rules first and refused in place, so the
 * sender never waits on an upload that was going to fail. Accepted files start as soon as
 * `blockedReason` is null (on the public page: once a name and email are in), two at a time,
 * all in one batch so the studio gets one notification for the drop.
 */
export function DropUploader({
  url, fields, accept, maxBytes, allowedKinds, blockedReason = null, onSent, compact = false, title = "Drop files here",
}: {
  url: string | null;
  fields: Record<string, string>;
  accept: string[];
  maxBytes: number;
  allowedKinds: UploadKind[];
  blockedReason?: string | null;
  onSent?: (count: number) => void;
  compact?: boolean;
  title?: string;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const batch = useRef(newBatchId());
  const active = useRef(new Set<string>());
  const sentCount = useRef(0);
  const hintId = useId();

  const patch = useCallback((id: string, change: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const add = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map((file): QueueItem => {
      const error = rejectReason(file, { maxBytes, allowedKinds });
      return { id: newBatchId(), file, status: error ? "rejected" : "queued", progress: null, error };
    });
    if (next.length) setItems((current) => [...current, ...next]);
  }, [maxBytes, allowedKinds]);

  // The queue runner: whenever something is waiting and a slot is free, start it.
  useEffect(() => {
    if (blockedReason || !url) return;
    const waiting = items.filter((item) => item.status === "queued" && !active.current.has(item.id));
    const free = CONCURRENCY - active.current.size;
    for (const item of waiting.slice(0, Math.max(0, free))) {
      active.current.add(item.id);
      patch(item.id, { status: "uploading", progress: 0, error: null });
      const attempt = () => sendFile(url, item.file, { ...fields, batch_id: batch.current }, (progress) => patch(item.id, { progress }));
      // One quiet retry for a server hiccup (5xx): the file is fine, the moment was not.
      void attempt().then((first) => (!first.ok && first.status >= 500 ? new Promise<CallResult<unknown>>((resolve) => setTimeout(() => resolve(attempt()), RETRY_DELAY_MS)) : first)).then((result) => {
        active.current.delete(item.id);
        if (result.ok) {
          sentCount.current += 1;
          patch(item.id, { status: "done", progress: 1 });
          onSent?.(sentCount.current);
        } else {
          patch(item.id, { status: "error", error: result.error });
        }
      });
    }
  }, [items, blockedReason, url, fields, patch, onSent]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) add(event.dataTransfer.files);
  };

  const summary = queueSummary(items);
  const busy = items.some((item) => item.status === "uploading" || item.status === "queued");

  return (
    <div className={`cu-drop-wrap${compact ? " is-compact" : ""}`}>
      <div
        className={`cu-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="cu-drop-icon" aria-hidden="true"><CloudUpload size={compact ? 20 : 26} /></span>
        <strong>{title}</strong>
        <p id={hintId}>{acceptedSummary(allowedKinds)} · up to {formatBytes(maxBytes)} each</p>
        <button type="button" className="cu-browse" onClick={() => input.current?.click()} aria-describedby={hintId}>Choose files</button>
        <input
          ref={input} type="file" multiple hidden accept={accept.join(",")}
          aria-label="Choose files to send"
          onChange={(event) => { if (event.target.files) add(event.target.files); event.target.value = ""; }}
        />
      </div>

      {blockedReason && items.some((item) => item.status === "queued") && (
        <p className="cu-blocked" role="status"><CircleAlert size={14} aria-hidden="true" />{blockedReason}</p>
      )}

      {items.length > 0 && (
        <div className="cu-queue" aria-live="polite">
          <div className="cu-queue-head">
            <span>{summary}</span>
            {!busy && <button type="button" className="cu-link-button" onClick={() => { setItems([]); batch.current = newBatchId(); }}>Clear</button>}
          </div>
          <ul>
            {items.map((item) => {
              const percent = item.status === "done" ? 100 : Math.round((item.progress ?? 0) * 100);
              return (
                <li key={item.id} className={`cu-item is-${item.status}`}>
                  <span className="cu-item-icon"><KindIcon file={item.file} /></span>
                  <div className="cu-item-body">
                    <div className="cu-item-line">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <small>{formatBytes(item.file.size)}</small>
                    </div>
                    {(item.status === "uploading" || item.status === "done") && (
                      <div className="cu-progress" role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    {item.status === "queued" && <small className="cu-item-note">Waiting…</small>}
                    {item.error && <small className="cu-item-error">{item.error}</small>}
                  </div>
                  <span className="cu-item-state">
                    {item.status === "uploading" && <small>{percent}%</small>}
                    {item.status === "done" && <CircleCheck size={16} aria-label="Sent" />}
                    {item.status === "error" && (
                      <button type="button" className="cu-icon-button" aria-label={`Retry ${item.file.name}`} onClick={() => patch(item.id, { status: "queued", error: null })}><RotateCcw size={14} /></button>
                    )}
                    {(item.status === "queued" || item.status === "error" || item.status === "rejected") && (
                      <button type="button" className="cu-icon-button" aria-label={`Remove ${item.file.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><X size={14} /></button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
