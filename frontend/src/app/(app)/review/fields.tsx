"use client";

import Link from "next/link";
import { CheckSquare, ExternalLink } from "lucide-react";
import type { ReviewView } from "@/lib/review-view";
import { timecode } from "@/lib/timecode";
import type { ReviewWriter } from "./writer";

/**
 * The secondary details panel.
 *
 * Duration and resolution are read off the loaded video rather than stored anywhere, which
 * is why they arrive as props from the player instead of the view model — the API records
 * neither. "Uploaded by" is shown as unavailable for the same reason: both `ProjectFile`
 * and `MediaVersion` record the member who uploaded, but neither serializer returns it.
 */
export function Fields({ view, writer, meta }: {
  view: ReviewView;
  writer: ReviewWriter;
  meta: { durationMs: number; width: number; height: number } | null;
}) {
  const { asset, version } = view;
  if (!asset || !version) return null;

  const rows: [string, React.ReactNode][] = [
    ["File name", version.title],
    ["Client", asset.clientName ?? <em>Not linked</em>],
    ["Project", asset.projectName ?? <em>Not linked</em>],
    ["Folder", asset.folderName ?? <em>Not in a folder</em>],
    ["Version", `${version.label} of ${asset.versions.length}`],
    ["Format", version.mimeType],
    ["File size", formatSize(version.sizeBytes)],
    ["Duration", meta ? timecode(meta.durationMs) : <em>Reading from the file…</em>],
    ["Resolution", meta && meta.width ? `${meta.width} × ${meta.height}` : <em>Reading from the file…</em>],
    ["Uploaded", new Date(version.createdAt).toLocaleString()],
    ["Uploaded by", <em key="by">Not returned by the API</em>],
  ];

  return (
    <div className="rvf">
      <section>
        <h3>Details</h3>
        <dl className="rvf-rows">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3>Board status</h3>
        <p className="rvf-note">
          The stage this file sits in on the task board. Review and the board read the same
          value, so moving it here moves it there.
        </p>
        <select
          aria-label="Board status"
          value={asset.stage?.id ?? ""}
          disabled={!version.assetFileId || writer.busy}
          onChange={(event) => void writer.setTaskStage(event.target.value || null)}
        >
          <option value="">No stage</option>
          {view.taskStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
        {!version.assetFileId && <p className="rvf-note">This cut is not in the asset library, so it has no board status.</p>}
      </section>

      <section>
        <h3>Tasks</h3>
        {view.linkedTasks.length === 0
          ? <p className="rvf-note">This media is not attached to a task.</p>
          : (
            <ul className="rvf-tasks">
              {view.linkedTasks.map((task) => (
                <li key={task.id}>
                  <CheckSquare size={13} />
                  <Link href="/tasks">{task.title}<ExternalLink size={11} /></Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section>
        <h3>Version history</h3>
        <ul className="rvf-versions">
          {[...asset.versions].reverse().map((item) => (
            <li key={item.id} className={item.id === version.id ? "is-current" : ""}>
              <Link href={`/review?media=${item.id}`}>
                <strong>{item.label}</strong>
                <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                {item.stageName && <small>{item.stageName}</small>}
                {!item.target && <small title="No project review record, so its notes are kept on this device.">Local notes</small>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
