"use client";
/**
 * Board cards. `TaskCardView` is purely presentational so the same markup renders in the
 * column, in the drag overlay and in tests; `CardMenu` is the accessible "Move to" path that
 * mirrors drag and drop.
 */
import { forwardRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import NextImage from "next/image";
import { ArrowDownToLine, ArrowUpToLine, AudioLines, Clapperboard, Ellipsis, File as FileIcon, Image as ImageIcon, MessageSquare, PanelRightOpen, Trash2 } from "lucide-react";
import type { ProjectFile, Task } from "@/lib/api";
import { stageTone, type BoardStage } from "@/lib/task-board";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, DueChip, PriorityIcon, StageIcon } from "./stage-ui";

/** What a card shows about its linked cut: the first attached file that is in the library. */
export type Cover = { poster: string | null; kind: string; runtime: string | null; version: number | null; comments: number; name: string } | null;

export function coverFor(task: Task, fileBySourceId: Map<string, ProjectFile>): Cover {
  for (const id of task.attachment_file_ids ?? []) {
    const file = fileBySourceId.get(id);
    if (!file) continue;
    return {
      poster: file.poster ? `/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/` : null,
      kind: file.file.mime_type.split("/")[0], runtime: file.file.duration_ms ? runtime(file.file.duration_ms) : null,
      version: file.version_number ?? null, comments: file.comment_count ?? 0, name: file.file.name,
    };
  }
  return null;
}

type CardProps = HTMLAttributes<HTMLElement> & {
  task: Task; stage: BoardStage; context: string; cover: Cover; done: boolean;
  menu?: ReactNode; dragging?: boolean; overlay?: boolean; dropBefore?: boolean;
  /** Opens the detail sheet. The card itself opens the linked cut in review when it has one. */
  onDetails?: () => void;
};

export const TaskCardView = forwardRef<HTMLElement, CardProps>(function TaskCardView({ task, stage, context, cover, done, menu, dragging, overlay, dropBefore, onDetails, className, style, ...rest }, ref) {
  const linked = Boolean(task.attachment_file_ids?.length);
  const assignee = task.assignees[0];
  const extra = task.assignees.length - 1;
  return <article
    ref={ref}
    className={`tb-card ${dragging ? "is-placeholder" : ""} ${overlay ? "is-overlay" : ""} ${dropBefore ? "is-drop-before" : ""} ${done ? "is-done" : ""} ${className ?? ""}`}
    style={{ ...style, "--tb-rule": stageTone(stage).dot } as CSSProperties}
    data-task-id={task.id}
    data-opens={linked ? "review" : "details"}
    title={linked ? "Open in review" : "Open details"}
    {...rest}
  >
    {cover && <div className="tb-card-cover">
      <Poster src={cover.poster} kind={cover.kind} />
      {linked && <span className="tb-card-open" aria-hidden="true"><Clapperboard />Review</span>}
      {(cover.runtime || cover.version) && <span className="tb-card-slate">{[cover.version ? `V${cover.version}` : null, cover.runtime].filter(Boolean).join(" · ")}</span>}
    </div>}
    <div className="tb-card-body">
      <h4 className="tb-card-title">{task.title}</h4>
      {context && <p className="tb-card-context">{context}</p>}
      <div className="tb-card-meta">
        <span className="tb-card-people"><Avatar name={assignee?.name} size="sm" />{extra > 0 && <span className="tb-more">+{extra}</span>}<span className="tb-sr">{assignee ? `Assigned to ${task.assignees.map((person) => person.name).join(", ")}` : "Unassigned"}</span></span>
        <DueChip dueAt={task.due_at} done={done} />
        <span className="tb-spacer" />
        {cover && cover.comments > 0 && <span className="tb-notes" title={`${cover.comments} review note${cover.comments === 1 ? "" : "s"} on ${cover.name}`}><MessageSquare aria-hidden="true" />{cover.comments}<span className="tb-sr"> review notes</span></span>}
        {linked && !cover && <span className="tb-notes" title="Opens the linked cut in review"><Clapperboard aria-hidden="true" /><span className="tb-sr">Has a linked cut</span></span>}
        <PriorityIcon priority={task.priority} />
        {onDetails && <button type="button" className="tb-icon-button tb-card-details" data-no-dnd aria-label={`Details for ${task.title}`} title="Details"
          onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDetails(); }}><PanelRightOpen aria-hidden="true" /></button>}
        {menu}
      </div>
    </div>
  </article>;
});

export function CardMenu({ task, stages, current, counts, open, onOpenChange, onOpenDetails, onMove, onMoveEdge, onDelete, canReorder }: {
  task: Task; stages: readonly BoardStage[]; current: string; counts: Map<string, number>; open?: boolean; onOpenChange?: (open: boolean) => void;
  onOpenDetails: () => void; onMove: (stageId: string) => void; onMoveEdge?: (edge: "top" | "bottom") => void; onDelete: () => void; canReorder?: boolean;
}) {
  return <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="tb-icon-button tb-card-menu" aria-label={`Actions for ${task.title}`} data-no-dnd onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Ellipsis aria-hidden="true" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="tb-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
      <DropdownMenuItem onSelect={onOpenDetails}><PanelRightOpen />Open details</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuGroup aria-label="Move to stage">
        <DropdownMenuLabel className="tb-menu-label">Move to</DropdownMenuLabel>
        {stages.map((stage, index) => <DropdownMenuItem key={stage.id} disabled={stage.id === current} onSelect={() => onMove(stage.id)} aria-label={`Move to ${stage.name}${stage.id === current ? " (current stage)" : ""}`}>
          <StageIcon stage={stage} />{stage.name}<span className="tb-menu-meta">{stage.id === current ? "Current" : <><span className="tb-count">{counts.get(stage.id) ?? 0}</span><kbd>{index + 1}</kbd></>}</span>
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
      {canReorder && onMoveEdge && <><DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMoveEdge("top")}><ArrowUpToLine />Move to top</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMoveEdge("bottom")}><ArrowDownToLine />Move to bottom</DropdownMenuItem></>}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />Delete task…</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** A library file staged on the board. Opens the review pane; stage changes by drag or menu. */
export const FileCardView = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { file: ProjectFile; stage: BoardStage; context: string; onOpen: () => void; menu?: ReactNode; dragging?: boolean; overlay?: boolean }>(function FileCardView({ file, stage, context, onOpen, menu, dragging, overlay, className, style, ...rest }, ref) {
  const kind = file.file.mime_type.split("/")[0];
  const playable = kind === "video" || kind === "audio" || kind === "image";
  const poster = file.poster ? `/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/` : null;
  const version = file.version_number;
  const slate = [version ? `V${version}` : null, file.file.duration_ms ? runtime(file.file.duration_ms) : extensionOf(file.file.name, kind)].filter(Boolean).join(" · ");
  return <article ref={ref} className={`tb-card tb-file-card ${dragging ? "is-placeholder" : ""} ${overlay ? "is-overlay" : ""} ${className ?? ""}`} style={{ ...style, "--tb-rule": stageTone(stage).dot } as CSSProperties} {...rest}>
    <div className="tb-card-cover">
      <Poster src={poster} kind={kind} />
      <span className="tb-card-slate">{slate}</span>
      {file.file.status !== "READY" && <span className="tb-card-flag">Scanning</span>}
    </div>
    <div className="tb-card-body">
      {playable
        ? <button type="button" className="tb-card-title tb-link" onClick={onOpen} data-no-dnd aria-label={`Open review for ${file.file.name}`}>{file.file.name}</button>
        : <h4 className="tb-card-title">{file.file.name}</h4>}
      {context && <p className="tb-card-context">{context}</p>}
      <div className="tb-card-meta">
        <span className="tb-kind">{kind === "video" ? <Clapperboard aria-hidden="true" /> : kind === "audio" ? <AudioLines aria-hidden="true" /> : kind === "image" ? <ImageIcon aria-hidden="true" /> : <FileIcon aria-hidden="true" />}File</span>
        <span className="tb-spacer" />
        {file.comment_count > 0 && <span className="tb-notes" title={`${file.comment_count} review notes`}><MessageSquare aria-hidden="true" />{file.comment_count}<span className="tb-sr"> review notes</span></span>}
        {menu}
      </div>
    </div>
  </article>;
});

export function FileMenu({ file, stages, current, onMove, onOpen }: { file: ProjectFile; stages: readonly BoardStage[]; current: string; onMove: (stageId: string) => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="tb-icon-button tb-card-menu" aria-label={`Actions for ${file.file.name}`} data-no-dnd onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Ellipsis aria-hidden="true" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="tb-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
      <DropdownMenuItem onSelect={onOpen}><Clapperboard />Open in review</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="tb-menu-label">Move to</DropdownMenuLabel>
      {stages.map((stage) => <DropdownMenuItem key={stage.id} disabled={stage.id === current} onSelect={() => onMove(stage.id)}><StageIcon stage={stage} />{stage.name}{stage.id === current && <span className="tb-menu-meta">Current</span>}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function Poster({ src, kind }: { src: string | null; kind: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = kind === "video" ? Clapperboard : kind === "audio" ? AudioLines : kind === "image" ? ImageIcon : FileIcon;
  if (!src || broken) return <span className="tb-cover-glyph"><Icon aria-hidden="true" /></span>;
  return <NextImage src={src} alt="" width={320} height={180} unoptimized onError={() => setBroken(true)} />;
}

function extensionOf(name: string, kind: string) { return name.includes(".") ? name.split(".").pop()!.toUpperCase() : kind.toUpperCase(); }
export function runtime(ms: number) { const total = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(total / 60), s = total % 60, h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; }
