"use client";

/**
 * The left "Library" panel: a Figma-assets-style tree of folders plus the workspace's
 * campaigns, each row with a chevron (when it has children) and a count.
 *
 * Both lists are real `role="tree"` widgets with a roving tabindex: ↑/↓ move, → expands
 * or steps into the first child, ← collapses or steps out to the parent, Home/End jump,
 * Enter/Space activate. Folder rows are drop targets for dragged assets.
 */
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, Layers, Library } from "lucide-react";
import type { TreeRow } from "@/lib/files-panel";

export type TreeItem = { id: string; label: string; depth: number; count: number; icon: ReactNode; expandable: boolean; expanded: boolean; selected: boolean; parentId: string | null; dropTarget?: string | null };

function Tree({ label, items, onActivate, onToggle, dropping, canDrop, onDrop, onDragOverItem }: {
  label: string; items: TreeItem[];
  onActivate: (id: string) => void; onToggle?: (id: string, open: boolean) => void;
  dropping?: string | null | undefined; canDrop?: (target: string | null) => boolean; onDrop?: (target: string | null) => void;
  onDragOverItem?: (target: string | null | undefined) => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const current = items.find((item) => item.id === focused) ?? items.find((item) => item.selected) ?? items[0];
  const focus = (id: string | undefined) => { if (!id) return; setFocused(id); refs.current.get(id)?.focus(); };
  const keys = (event: KeyboardEvent<HTMLDivElement>, item: TreeItem) => {
    const index = items.indexOf(item);
    if (event.key === "ArrowDown") { event.preventDefault(); focus(items[Math.min(items.length - 1, index + 1)]?.id); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focus(items[Math.max(0, index - 1)]?.id); }
    else if (event.key === "Home") { event.preventDefault(); focus(items[0]?.id); }
    else if (event.key === "End") { event.preventDefault(); focus(items[items.length - 1]?.id); }
    else if (event.key === "ArrowRight" && item.expandable) {
      event.preventDefault();
      if (!item.expanded) onToggle?.(item.id, true); else focus(items[index + 1]?.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (item.expandable && item.expanded) onToggle?.(item.id, false); else if (item.parentId) focus(item.parentId);
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(item.id); }
  };
  const dragProps = (item: TreeItem) => {
    if (!onDrop || item.dropTarget === undefined) return {};
    const target = item.dropTarget;
    return {
      onDragOver: (event: DragEvent) => { if (canDrop?.(target)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; onDragOverItem?.(target); } },
      onDragLeave: () => onDragOverItem?.(undefined),
      onDrop: (event: DragEvent) => { if (canDrop?.(target)) { event.preventDefault(); onDrop(target); } },
    };
  };
  return (
    <div role="tree" aria-label={label} className="fx-tree-list">
      {items.map((item) => (
        <div
          key={item.id}
          ref={(node) => { if (node) refs.current.set(item.id, node); else refs.current.delete(item.id); }}
          role="treeitem"
          aria-level={item.depth + 1}
          aria-selected={item.selected}
          aria-expanded={item.expandable ? item.expanded : undefined}
          tabIndex={item.id === current?.id ? 0 : -1}
          className={`fx-tree-row ${item.selected ? "is-selected" : ""} ${dropping !== undefined && dropping === item.dropTarget && item.dropTarget !== undefined ? "is-drop" : ""}`}
          style={{ paddingLeft: 8 + Math.min(item.depth, 6) * 16 }}
          onClick={() => { setFocused(item.id); onActivate(item.id); }}
          onKeyDown={(event) => keys(event, item)}
          onFocus={() => setFocused(item.id)}
          {...dragProps(item)}
        >
          <span
            className={`fx-disclosure ${item.expanded ? "is-open" : ""}`}
            aria-hidden="true"
            onClick={(event) => { if (!item.expandable) return; event.stopPropagation(); onToggle?.(item.id, !item.expanded); }}
          >{item.expandable && <ChevronRight />}</span>
          {item.icon}
          <span className="fx-tree-label">{item.label}</span>
          <span className="fx-count">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function LibraryTree({ rows, rootLabel, rootCount, folderId, onOpenFolder, onToggleFolder, campaigns, campaignFilter, onCampaign, canDrop, onDrop }: {
  rows: TreeRow[]; rootLabel: string; rootCount: number; folderId: string | null;
  onOpenFolder: (id: string | null) => void; onToggleFolder: (id: string, open: boolean) => void;
  campaigns: { id: string; name: string; count: number }[]; campaignFilter: string; onCampaign: (id: string) => void;
  canDrop: (target: string | null) => boolean; onDrop: (target: string | null) => void;
}) {
  const [dropping, setDropping] = useState<string | null | undefined>(undefined);
  const folderItems: TreeItem[] = [
    { id: "__root", label: rootLabel, depth: 0, count: rootCount, icon: <Library aria-hidden="true" />, expandable: false, expanded: true, selected: folderId === null, parentId: null, dropTarget: null },
    ...rows.map((row) => ({
      id: row.folder.id, label: row.folder.name, depth: row.depth + 1, count: row.count,
      icon: row.folder.id === folderId ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />,
      expandable: row.hasChildren, expanded: row.expanded, selected: row.folder.id === folderId,
      parentId: row.folder.parentFolderId && rows.some((candidate) => candidate.folder.id === row.folder.parentFolderId) ? row.folder.parentFolderId : "__root",
      dropTarget: row.folder.id,
    })),
  ];
  return (
    <div className="fx-tree-inner" onDragEnd={() => setDropping(undefined)} onDrop={() => setDropping(undefined)}>
      <p className="fx-eyebrow" id="fx-tree-folders">Folders</p>
      <Tree
        label="Folders" items={folderItems}
        onActivate={(id) => onOpenFolder(id === "__root" ? null : id)}
        onToggle={onToggleFolder}
        dropping={dropping} canDrop={canDrop} onDrop={(target) => { setDropping(undefined); onDrop(target); }}
        onDragOverItem={(target) => setDropping(target)}
      />
      {campaigns.length > 0 && <>
        <p className="fx-eyebrow">Campaigns</p>
        <Tree
          label="Campaigns"
          items={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name, depth: 0, count: campaign.count, icon: <Layers aria-hidden="true" />, expandable: false, expanded: false, selected: campaignFilter === campaign.id, parentId: null }))}
          onActivate={onCampaign}
        />
      </>}
    </div>
  );
}
