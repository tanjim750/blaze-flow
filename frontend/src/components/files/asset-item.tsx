"use client";

/**
 * One asset or folder, drawn as a grid tile or a list row. The same element in both modes,
 * so selection, focus, drag and the keyboard behave identically.
 *
 * The outer element is a focusable `role="row"` inside its section's `role="grid"`. Only the
 * focused item is in the tab order (roving tabindex, managed by the parent). The checkbox,
 * the open chip and the ⋯ trigger are for the pointer: from the keyboard, Space selects,
 * Enter opens and Shift+F10 opens the actions menu.
 */
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Clapperboard, Eye, FolderOpen, GitBranch, Layers, MessageSquareText, TriangleAlert } from "lucide-react";
import type { LibraryFile, LibraryFolder } from "@/lib/asset-library";
import { isProcessing } from "@/lib/asset-library";
import { aspectLabel, formatSize, KIND_NAME, runtime, type Density, type ViewMode } from "@/lib/files-panel";
import { FileName, KindIcon, StagePill, Thumb } from "./files-ui";

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const formatShortDate = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : shortDate.format(date); };
export const formatLongDate = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : longDate.format(date); };

type Common = {
  mode: ViewMode; density: Density;
  selected: boolean; focusable: boolean; showChecks: boolean;
  renaming: ReactNode | null; menu: ReactNode;
  onPointerSelect: (event: MouseEvent) => void; onToggle: () => void; onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void; onFocus: () => void;
  onContextMenu: (event: MouseEvent) => void;
  register: (node: HTMLDivElement | null) => void;
  /** Drag source. */
  draggable: boolean; isDragSource: boolean; onDragStart: (event: DragEvent) => void; onDragEnd: () => void;
  /** Drop target state for this item (a folder accepting a move, a file accepting a version). */
  dropLabel: string | null; dropInert: boolean;
  onDragOver?: (event: DragEvent) => void; onDragLeave?: () => void; onDrop?: (event: DragEvent) => void;
};

function Shell({ id, common, kind, label, children }: { id: string; common: Common; kind: "file" | "folder"; label: string; children: ReactNode }) {
  const {
    mode, density, selected, focusable, showChecks, isDragSource, dropLabel, dropInert, register, draggable,
    onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onPointerSelect, onOpen, onKeyDown, onFocus, onContextMenu,
  } = common;
  return (
    <div
      ref={register}
      role="row"
      aria-selected={selected}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      data-kind={kind}
      data-id={id}
      className={["fx-item", mode === "list" ? "is-row" : "is-tile", density === "compact" ? "is-compact" : "", selected ? "is-selected" : "", showChecks ? "show-checks" : "", isDragSource ? "is-drag-source" : "", dropLabel ? "is-drop" : "", dropInert ? "is-inert" : ""].filter(Boolean).join(" ")}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPointerSelect}
      onDoubleClick={(event) => { if ((event.target as HTMLElement).closest("input, button, [role=menu]")) return; onOpen(); }}
      onKeyDown={onKeyDown}
      onFocus={(event) => { if (event.target === event.currentTarget) onFocus(); }}
      onContextMenu={onContextMenu}
    >
      <div role="gridcell" className="fx-cell">
        {dropLabel && <span className="fx-drop-label" aria-hidden="true"><GitBranch />{dropLabel}</span>}
        {children}
      </div>
    </div>
  );
}

function Check({ checked, name, onToggle }: { checked: boolean; name: string; onToggle: () => void }) {
  return (
    <label className="fx-check" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <input type="checkbox" tabIndex={-1} checked={checked} onChange={onToggle} aria-label={`Select ${name}`} />
    </label>
  );
}

export function FileItem({ file, stage, relation, reviewable, common }: {
  file: LibraryFile; stage: { name: string; color: string } | null; relation: string | null; reviewable: boolean; common: Common;
}) {
  const working = isProcessing(file);
  const failed = file.status === "FAILED";
  const versions = file.versioning;
  const aspect = file.width && file.height ? aspectLabel(file.width, file.height) : "";
  const feedback = file.commentCount ?? 0;
  const status = working ? (file.status === "DUPLICATING" ? "Copying…" : file.status === "PENDING" ? "Checking file…" : "Generating preview…") : null;
  const label = [file.name, KIND_NAME[file.kind], formatSize(file.size), stage?.name, status].filter(Boolean).join(", ");
  const openChip = !working && (
    <button type="button" className="fx-open-chip" tabIndex={-1} onClick={(event) => { event.stopPropagation(); common.onOpen(); }} aria-label={`${reviewable ? "Open review for" : "Preview"} ${file.name}`}>
      {reviewable ? <Clapperboard /> : <Eye />}{reviewable ? "Review" : "Preview"}
    </button>
  );
  const frame = (
    <span className={`fx-frame ${versions.versionCount > 1 ? "is-stacked" : ""} ${working ? "is-working" : ""}`}>
      <Thumb file={file} size={common.mode === "list" ? "sm" : "md"} />
      {common.mode === "grid" && file.durationMs && !working ? <b className="fx-duration">{runtime(file.durationMs)}</b> : null}
      {common.mode === "grid" && working && <span className="fx-working" role="status"><em>{status}</em><i /></span>}
      {common.mode === "grid" && openChip}
    </span>
  );
  const name = common.renaming ?? <FileName name={file.name} max={common.mode === "list" ? 48 : 30} />;

  if (common.mode === "list") {
    return (
      <Shell id={file.id} common={common} kind="file" label={label}>
        <Check checked={common.selected} name={file.name} onToggle={common.onToggle} />
        <span className="fx-col-name">
          {frame}
          <span className="fx-name-stack">
            <span className="fx-name-line"><KindIcon kind={file.kind} className="fx-kind" />{name}</span>
            {(relation || status || failed) && <small>{failed ? <span className="fx-failed"><TriangleAlert />Upload failed</span> : status ?? relation}</small>}
          </span>
        </span>
        <span className="fx-col-stage"><StagePill stage={stage} variant="icon" /></span>
        <span className="fx-col-version">{versions.versionCount > 1 && <span className="fx-pill is-mono" title={`${versions.versionCount} versions of ${versions.assetName}`}>v{versions.versionNumber}</span>}</span>
        <span className="fx-col-feedback">{feedback > 0 && <span className="fx-feedback" title={`${feedback} comment${feedback === 1 ? "" : "s"}`}><MessageSquareText />{feedback}</span>}</span>
        <span className="fx-col-size">{formatSize(file.size)}</span>
        <span className="fx-col-date" title={formatLongDate(file.uploadedAt)}>{formatShortDate(file.uploadedAt)}</span>
        <span className="fx-col-actions">{common.menu}</span>
      </Shell>
    );
  }
  return (
    <Shell id={file.id} common={common} kind="file" label={label}>
      <Check checked={common.selected} name={file.name} onToggle={common.onToggle} />
      {frame}
      <span className="fx-caption">
        <span className="fx-name-line"><KindIcon kind={file.kind} className="fx-kind" />{name}</span>
        {common.density === "comfortable" && (
          <small className="fx-meta">
            {failed ? <span className="fx-failed"><TriangleAlert />Upload failed</span> : <>
              <span className="fx-mono">{formatSize(file.size)}</span>
              {aspect && <span className="fx-mono">{aspect}</span>}
              {versions.versionCount > 1 && <span className="fx-mono" title={`${versions.versionCount} versions of ${versions.assetName}`}><Layers />v{versions.versionNumber}</span>}
              {feedback > 0 && <span className="fx-feedback" title={`${feedback} comment${feedback === 1 ? "" : "s"}`}><MessageSquareText />{feedback}</span>}
            </>}
          </small>
        )}
        {common.density === "comfortable" && stage && <span className="fx-stage-line"><StagePill stage={stage} /></span>}
      </span>
      <span className="fx-tile-actions">{common.menu}</span>
    </Shell>
  );
}

export function FolderItem({ folder, childFiles, itemCount, relation, common }: {
  folder: LibraryFolder; childFiles: LibraryFile[]; itemCount: number; relation: string | null; common: Common;
}) {
  const label = `${folder.name}, folder, ${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const withMedia = childFiles.filter((file) => file.preview).slice(0, 3);
  const meta = `${itemCount} item${itemCount === 1 ? "" : "s"}${relation ? ` · ${relation}` : ""}`;
  const name = common.renaming ?? <FileName name={folder.name} max={common.mode === "list" ? 48 : 30} />;
  const openChip = (
    <button type="button" className="fx-open-chip" tabIndex={-1} onClick={(event) => { event.stopPropagation(); common.onOpen(); }} aria-label={`Open ${folder.name}`}><FolderOpen />Open</button>
  );
  if (common.mode === "list") {
    return (
      <Shell id={folder.id} common={common} kind="folder" label={label}>
        <Check checked={common.selected} name={folder.name} onToggle={common.onToggle} />
        <span className="fx-col-name">
          <span className="fx-frame is-folder"><span className="fx-thumb is-glyph"><FolderOpen aria-hidden="true" /></span></span>
          <span className="fx-name-stack"><span className="fx-name-line">{name}</span><small>{meta}</small></span>
        </span>
        <span className="fx-col-stage" /><span className="fx-col-version" /><span className="fx-col-feedback" />
        <span className="fx-col-size">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
        <span className="fx-col-date" title={formatLongDate(folder.createdAt)}>{formatShortDate(folder.createdAt)}</span>
        <span className="fx-col-actions">{common.menu}</span>
      </Shell>
    );
  }
  return (
    <Shell id={folder.id} common={common} kind="folder" label={label}>
      <Check checked={common.selected} name={folder.name} onToggle={common.onToggle} />
      <span className="fx-frame is-folder">
        {withMedia.length
          ? <span className="fx-folder-strip">{withMedia.map((file) => <Thumb key={file.id} file={file} size="sm" />)}</span>
          : <span className="fx-thumb is-glyph"><FolderOpen aria-hidden="true" /></span>}
        {openChip}
      </span>
      <span className="fx-caption">
        <span className="fx-name-line"><FolderOpen className="fx-kind" aria-hidden="true" />{name}</span>
        {common.density === "comfortable" && <small className="fx-meta"><span>{meta}</span></small>}
      </span>
      <span className="fx-tile-actions">{common.menu}</span>
    </Shell>
  );
}

export type ItemCommon = Common;
