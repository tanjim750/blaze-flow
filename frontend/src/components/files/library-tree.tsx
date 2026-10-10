"use client";

/**
 * Left Library rail (Frame.io Assets–inspired): All files, By client → project → folders,
 * then Studio for unfiled media. Keyboard tree behaviour matches the previous flat tree.
 */
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Building2, ChevronRight, Clapperboard, Folder, FolderOpen, Library } from "lucide-react";
import type { LibraryNavRow } from "@/lib/files-panel";

function iconFor(row: LibraryNavRow, selected: boolean): ReactNode {
  if (row.kind === "root") return <Library aria-hidden="true" />;
  if (row.kind === "client") return <Building2 aria-hidden="true" />;
  if (row.kind === "project") return <Clapperboard aria-hidden="true" />;
  return selected ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />;
}

export function LibraryTree({ rows, onActivate, onToggle, canDrop, onDrop }: {
  rows: LibraryNavRow[];
  onActivate: (row: LibraryNavRow) => void;
  onToggle: (id: string, open: boolean) => void;
  canDrop: (target: string | null) => boolean;
  onDrop: (target: string | null) => void;
}) {
  const items = useMemo(() => rows.filter((row) => row.kind !== "studio"), [rows]);
  const studio = rows.find((row) => row.kind === "studio");
  const firstStudioFolder = items.findIndex((row) => row.parentId === "studio");
  const byClient = items.some((row) => row.kind === "client");

  const [focused, setFocused] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null | undefined>(undefined);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const current = items.find((row) => row.id === focused) ?? items.find((row) => row.selected) ?? items[0];
  const focus = (id: string | undefined) => { if (!id) return; setFocused(id); refs.current.get(id)?.focus(); };

  const keys = (event: KeyboardEvent<HTMLDivElement>, row: LibraryNavRow) => {
    const index = items.indexOf(row);
    if (event.key === "ArrowDown") { event.preventDefault(); focus(items[Math.min(items.length - 1, index + 1)]?.id); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focus(items[Math.max(0, index - 1)]?.id); }
    else if (event.key === "Home") { event.preventDefault(); focus(items[0]?.id); }
    else if (event.key === "End") { event.preventDefault(); focus(items[items.length - 1]?.id); }
    else if (event.key === "ArrowRight" && row.expandable) {
      event.preventDefault();
      if (!row.expanded) onToggle(row.id, true); else focus(items[index + 1]?.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.expandable && row.expanded) onToggle(row.id, false);
      else if (row.parentId && row.parentId !== "studio") focus(row.parentId);
      else if (row.parentId === "studio") focus(items[0]?.id);
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(row); }
  };

  return (
    <div className="fx-tree-inner" onDragEnd={() => setDropping(undefined)} onDrop={() => setDropping(undefined)}>
      <div role="tree" aria-label="Library" className="fx-tree-list">
        {items.map((row, index) => {
          const showClientEyebrow = byClient && row.kind === "client" && items.slice(0, index).every((item) => item.kind === "root");
          const showStudioEyebrow = Boolean(studio) && index === firstStudioFolder && firstStudioFolder >= 0;
          const dropTarget = row.dropTarget;
          const accepts = dropTarget !== undefined;
          return (
            <div key={row.id} className="fx-tree-block">
              {showClientEyebrow && <p className="fx-eyebrow">By client</p>}
              {showStudioEyebrow && <p className="fx-eyebrow">Studio{studio ? ` · ${studio.count}` : ""}</p>}
              <div
                ref={(node) => { if (node) refs.current.set(row.id, node); else refs.current.delete(row.id); }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={row.selected}
                aria-expanded={row.expandable ? row.expanded : undefined}
                tabIndex={row.id === current?.id ? 0 : -1}
                className={`fx-tree-row ${row.selected ? "is-selected" : ""} ${row.kind === "client" ? "is-client" : ""} ${row.kind === "project" ? "is-project" : ""} ${dropping !== undefined && dropping === dropTarget && accepts ? "is-drop" : ""}`}
                style={{ paddingLeft: 8 + Math.min(row.depth, 6) * 14 }}
                onClick={() => { setFocused(row.id); onActivate(row); }}
                onKeyDown={(event) => keys(event, row)}
                onFocus={() => setFocused(row.id)}
                onDragOver={accepts ? (event: DragEvent) => {
                  if (!canDrop(dropTarget ?? null)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropping(dropTarget ?? null);
                } : undefined}
                onDragLeave={accepts ? () => setDropping(undefined) : undefined}
                onDrop={accepts ? (event: DragEvent) => {
                  if (!canDrop(dropTarget ?? null)) return;
                  event.preventDefault();
                  setDropping(undefined);
                  onDrop(dropTarget ?? null);
                } : undefined}
              >
                <span
                  className={`fx-disclosure ${row.expanded ? "is-open" : ""}`}
                  aria-hidden="true"
                  onClick={(event) => {
                    if (!row.expandable) return;
                    event.stopPropagation();
                    onToggle(row.id, !row.expanded);
                  }}
                >{row.expandable && <ChevronRight />}</span>
                {iconFor(row, row.selected)}
                <span className="fx-tree-label">{row.label}</span>
                <span className="fx-count">{row.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
