"use client";

import Link from "next/link";
import { ChevronRight } from "@/components/icons";
import { forwardRef } from "react";
import { FILES_ROOT_EVENT } from "@/components/asset-library";

type Props = {
  client: { id: string; name: string } | null;
  project: { name: string } | null;
  /** A folder is open in the Files tab, so the project crumb leads back to the library root. */
  inFolder: boolean;
};

/**
 * Projects / client / project (/ folders, portalled in by the Files library). Every ancestor is
 * a link or button; the current page is plain text marked aria-current.
 */
export const ProjectCrumbs = forwardRef<HTMLOListElement, Props>(function ProjectCrumbs({ client, project, inFolder }, ref) {
  return <nav className="pb-crumbs" aria-label="Breadcrumb">
    <ol ref={ref}>
      <li><Link className="pb-crumb" href="/projects">Projects</Link></li>
      {client && <li><ChevronRight size={13} aria-hidden="true" /><Link className="pb-crumb" href={`/projects?client=${encodeURIComponent(client.id)}`}>{client.name}</Link></li>}
      <li><ChevronRight size={13} aria-hidden="true" />
        {inFolder && project
          ? <button type="button" className="pb-crumb" onClick={() => window.dispatchEvent(new Event(FILES_ROOT_EVENT))}>{project.name}</button>
          : <span className="pb-crumb is-current" aria-current="page">{project?.name ?? "No campaign"}</span>}
      </li>
    </ol>
  </nav>;
});
