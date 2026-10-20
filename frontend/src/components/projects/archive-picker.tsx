"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { Archive, Check, Loader2 } from "lucide-react";
import { setProjectStatusAction } from "@/app/(app)/projects/actions";
import { statusLabel } from "@/lib/project-status";

export type OpenProject = { id: string; name: string; client: string; status?: string };

/** The workspace's open projects, provided by the Projects page so dialogs can offer them. */
export const OpenProjectsContext = createContext<OpenProject[]>([]);
export const useOpenProjects = () => useContext(OpenProjectsContext);

/** Completed and on-hold projects first: they are the likeliest to be finished with. */
const RANK: Record<string, number> = { COMPLETED: 0, ON_HOLD: 1, DRAFT: 2, ACTIVE: 3 };

/**
 * "Archive a project" from the plan-limit dialog: pick one, archive it in place, then carry
 * on with whatever was being created.
 */
export function ArchivePicker({ onArchived }: { onArchived: (project: OpenProject) => void }) {
  const projects = [...useOpenProjects()].sort((a, b) => (RANK[a.status ?? ""] ?? 4) - (RANK[b.status ?? ""] ?? 4));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const archive = (project: OpenProject) => {
    setBusy(project.id); setError(null);
    start(async () => {
      const result = await setProjectStatusAction(project.id, "ARCHIVED");
      setBusy(null);
      if (result.error) { setError(result.error); return; }
      onArchived(project);
    });
  };

  if (!projects.length) return <p className="pb-limit-body">There are no open projects to archive.</p>;
  return (
    <div className="pb-archive-picker">
      <ul aria-label="Open projects">
        {projects.map((project) => (
          <li key={project.id}>
            <span><strong>{project.name}</strong><small>{project.client} · {statusLabel(project.status)}</small></span>
            <button type="button" onClick={() => archive(project)} disabled={busy !== null} aria-label={`Archive ${project.name}`}>
              {busy === project.id ? <Loader2 size={13} className="pb-spin" /> : <Archive size={13} />}Archive
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="pb-archive-error" role="alert">{error}</p>}
    </div>
  );
}

export function ArchivedNotice({ project, name }: { project: OpenProject; name: string }) {
  return (
    <p className="pb-archive-done" role="status">
      <Check size={14} /> Archived <strong>{project.name}</strong>. {name ? <>You can create &ldquo;{name}&rdquo; now.</> : "There is room for a new project now."}
    </p>
  );
}
