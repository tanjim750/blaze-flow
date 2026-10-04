"use client";

/**
 * The right-hand inspector (DS §7): a context panel for whatever is selected, the way
 * Figma's details panel works, instead of a modal.
 *
 * - One file: preview, name (rename in place), stage, details grid, feedback, actions.
 * - One folder: name, contents, details, actions.
 * - Several items: how many, total size and stage mix. The bulk actions live in the
 *   selection bar above the grid, so they appear once on screen.
 * - Nothing selected: a summary of the current location and the keyboard shortcuts.
 */
import type { ReactNode } from "react";
import { ChevronDown, Clapperboard, Copy, Download, Eye, FolderOpen, MessageSquareText, Move, Pencil, Trash2, X } from "lucide-react";
import type { LibraryFile, LibraryFolder } from "@/lib/asset-library";
import { isProcessing } from "@/lib/asset-library";
import { aspectLabel, formatSize, KIND_NAME, runtime, summarize } from "@/lib/files-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd, KindIcon, NoStagePill, StagePill, Thumb } from "./files-ui";
import { formatLongDate } from "./asset-item";

type Stage = { id: string; name: string; color: string };

export type InspectorActions = {
  open: (entity: LibraryFile | LibraryFolder) => void;
  rename: (entity: LibraryFile | LibraryFolder) => void;
  move: (entity: LibraryFile | LibraryFolder) => void;
  duplicate?: (file: LibraryFile) => void;
  download: (file: LibraryFile) => void;
  downloadManifest: (folder: LibraryFolder) => void;
  remove: (entity: LibraryFile | LibraryFolder) => void;
  setStage: (file: LibraryFile, stageId: string | null) => void;
};

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="fx-insp-section">{title && <h3 className="fx-eyebrow">{title}</h3>}{children}</section>;
}
function Details({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="fx-details">{rows.filter(([, value]) => value !== null && value !== "" && value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function AssetInspector({ selectedFiles, selectedFolders, scope, stages, relation, location, folderItemCount, reviewable, renaming, actions, onClose, canDuplicate }: {
  selectedFiles: LibraryFile[]; selectedFolders: LibraryFolder[];
  scope: { title: string; files: LibraryFile[]; folders: LibraryFolder[] };
  stages: Stage[];
  relation: (entity: { clientId: string | null; projectId: string | null }) => string;
  location: (folderId: string | null) => string;
  folderItemCount: (folder: LibraryFolder) => number;
  reviewable: (file: LibraryFile) => boolean;
  renaming: ReactNode | null;
  actions: InspectorActions;
  onClose: () => void;
  canDuplicate: boolean;
}) {
  const count = selectedFiles.length + selectedFolders.length;
  const stageOf = (id: string | null) => stages.find((stage) => stage.id === id) ?? null;
  const header = (title: string) => (
    <header className="fx-insp-head">
      <h2 id="fx-inspector-title">{title}</h2>
      <button type="button" className="fx-icon-btn is-sm" onClick={onClose} aria-label="Close details"><X /></button>
    </header>
  );
  const stageMix = (files: LibraryFile[]) => {
    const summary = summarize(files, []);
    return [...summary.stages.entries()].sort((a, b) => b[1] - a[1]).map(([id, total]) => {
      const stage = stageOf(id);
      return <li key={id ?? "none"}>{stage ? <StagePill stage={stage} /> : <NoStagePill />}<span className="fx-mono">{total}</span></li>;
    });
  };

  if (count === 0) {
    const summary = summarize(scope.files, scope.folders);
    return (
      <>
        {header("Details")}
        <div className="fx-insp-body">
          <Section>
            <p className="fx-insp-title">{scope.title}</p>
            <p className="fx-insp-sub">{summary.files} file{summary.files === 1 ? "" : "s"} · {summary.folders} folder{summary.folders === 1 ? "" : "s"} · {formatSize(summary.bytes)}</p>
          </Section>
          {summary.files > 0 && <Section title="Stages"><ul className="fx-stage-mix">{stageMix(scope.files)}</ul></Section>}
          <Section title="Shortcuts">
            <p className="fx-insp-hint">Select an item to see its details.</p>
            <ul className="fx-shortcuts">
              <li><Kbd>/</Kbd>Search</li><li><Kbd>N</Kbd>New folder</li><li><Kbd>U</Kbd>Upload</li>
              <li><Kbd>↑↓←→</Kbd>Move</li><li><Kbd>Space</Kbd>Select</li><li><Kbd>Enter</Kbd>Open</li>
              <li><Kbd>F2</Kbd>Rename</li><li><Kbd>⇧F10</Kbd>Actions</li><li><Kbd>]</Kbd>Details panel</li>
            </ul>
          </Section>
        </div>
      </>
    );
  }

  if (count > 1) {
    const summary = summarize(selectedFiles, selectedFolders);
    return (
      <>
        {header("Details")}
        <div className="fx-insp-body">
          <Section>
            <p className="fx-insp-title">{count} items selected</p>
            <p className="fx-insp-sub">{summary.files} file{summary.files === 1 ? "" : "s"}{summary.folders ? ` · ${summary.folders} folder${summary.folders === 1 ? "" : "s"}` : ""} · {formatSize(summary.bytes)}</p>
          </Section>
          {summary.files > 0 && <Section title="Stages"><ul className="fx-stage-mix">{stageMix(selectedFiles)}</ul></Section>}
          <Section><p className="fx-insp-hint">Move or delete them from the selection bar above the grid. Esc clears the selection.</p></Section>
        </div>
      </>
    );
  }

  const folder = selectedFolders[0];
  if (folder) {
    const items = folderItemCount(folder);
    return (
      <>
        {header("Folder")}
        <div className="fx-insp-body">
          <Section>
            <div className="fx-insp-preview is-folder"><FolderOpen aria-hidden="true" /></div>
            {renaming ?? <p className="fx-insp-title">{folder.name}</p>}
          </Section>
          <Section title="Details">
            <Details rows={[["Contents", `${items} item${items === 1 ? "" : "s"}`], ["Location", location(folder.parentFolderId)], ["Linked to", relation(folder)], ["Created by", folder.createdBy], ["Created", formatLongDate(folder.createdAt)]]} />
          </Section>
          <Section title="Actions">
            <div className="fx-insp-actions">
              <button type="button" className="fx-btn" onClick={() => actions.open(folder)}><FolderOpen />Open folder</button>
              <button type="button" className="fx-btn" onClick={() => actions.rename(folder)}><Pencil />Rename</button>
              <button type="button" className="fx-btn" onClick={() => actions.move(folder)}><Move />Move / assign</button>
              <button type="button" className="fx-btn" onClick={() => actions.downloadManifest(folder)}><Download />Download manifest</button>
              <button type="button" className="fx-btn is-danger" onClick={() => actions.remove(folder)}><Trash2 />Delete folder</button>
            </div>
          </Section>
        </div>
      </>
    );
  }

  const file = selectedFiles[0];
  const stage = stageOf(file.stageId);
  const versions = file.versioning;
  const canReview = reviewable(file);
  const working = isProcessing(file);
  const dimensions = file.width && file.height ? `${file.width} × ${file.height}` : null;
  const feedback = file.commentCount ?? 0;
  return (
    <>
      {header(KIND_NAME[file.kind])}
      <div className="fx-insp-body">
        <Section>
          <button type="button" className="fx-insp-preview" onClick={() => actions.open(file)} disabled={working} aria-label={canReview ? `Open review for ${file.name}` : `Preview ${file.name}`}>
            <Thumb file={file} size="lg" />
            {file.durationMs ? <b className="fx-duration">{runtime(file.durationMs)}</b> : null}
          </button>
          {renaming ?? <p className="fx-insp-title" title={file.name}>{file.name}</p>}
          <div className="fx-insp-stage">
            <DropdownMenu>
              <DropdownMenuTrigger className="fx-stage-trigger" aria-label={`Stage: ${stage?.name ?? "No stage"}. Change stage`}>
                {stage ? <StagePill stage={stage} variant="icon" /> : <NoStagePill />}<ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="fx-menu">
                <DropdownMenuRadioGroup value={file.stageId ?? ""} onValueChange={(value) => actions.setStage(file, value || null)}>
                  <DropdownMenuRadioItem value="">No stage</DropdownMenuRadioItem>
                  {stages.map((item) => <DropdownMenuRadioItem key={item.id} value={item.id}><i className="fx-menu-dot" style={{ background: item.color }} aria-hidden="true" />{item.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {feedback > 0 && <span className="fx-feedback" title="Open review comments"><MessageSquareText />{feedback} comment{feedback === 1 ? "" : "s"}</span>}
          </div>
        </Section>
        <Section title="Details">
          <Details rows={[
            ["Type", <span key="t" className="fx-type"><KindIcon kind={file.kind} />{KIND_NAME[file.kind]}</span>],
            ["Format", file.mimeType],
            ["Size", formatSize(file.size)],
            ["Dimensions", dimensions ? `${dimensions} · ${aspectLabel(file.width!, file.height!)}` : null],
            ["Duration", file.durationMs ? runtime(file.durationMs) : null],
            ["Version", versions.versionCount > 1 ? `v${versions.versionNumber} of ${versions.versionCount}${versions.isLatest ? " · latest" : ""}` : "v1"],
            ["Uploaded by", file.uploadedBy],
            ["Uploaded", formatLongDate(file.uploadedAt)],
            ["Location", location(file.folderId)],
            ["Linked to", relation(file)],
            ["Status", working ? "Processing…" : file.status === "FAILED" ? "Failed" : null],
          ]} />
        </Section>
        <Section title="Actions">
          <div className="fx-insp-actions">
            <button type="button" className="fx-btn is-primary" onClick={() => actions.open(file)} disabled={working}>{canReview ? <Clapperboard /> : <Eye />}{canReview ? "Open in review" : "Preview"}</button>
            {file.url && <button type="button" className="fx-btn" onClick={() => actions.download(file)}><Download />Download</button>}
            <button type="button" className="fx-btn" onClick={() => actions.rename(file)}><Pencil />Rename</button>
            <button type="button" className="fx-btn" onClick={() => actions.move(file)}><Move />Move / assign</button>
            {canDuplicate && actions.duplicate && <button type="button" className="fx-btn" onClick={() => actions.duplicate!(file)}><Copy />Duplicate</button>}
            <button type="button" className="fx-btn is-danger" onClick={() => actions.remove(file)}><Trash2 />Delete</button>
          </div>
        </Section>
      </div>
    </>
  );
}
