"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";
import { DropUploader } from "./drop-uploader";
import { formatBytes, portalUploadUrl, shortDateTime, type ClientPortal } from "@/lib/client-uploads";
import "./client-uploads.css";

const NO_FIELDS = {};

/**
 * The client portal's "Send files" panel: pick a project, drop footage, references or
 * brand files, and they land in that project's "From client" folder. What this client sent
 * recently is listed underneath (refreshed from the server once a drop settles).
 */
export function ClientUploadPanel({ workspaceId, projects, recent, maxBytes, accept }: {
  workspaceId: string; projects: ClientPortal["projects"]; recent: ClientPortal["recent_uploads"]; maxBytes: number; accept: string[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onSent = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 1200);
  };

  return (
    <section className="panel cu-portal" aria-labelledby="cu-portal-title">
      <div className="panel-title">
        <h2 id="cu-portal-title"><FolderInput size={16} />Send files to the studio</h2>
        <small>Footage, references and brand files</small>
      </div>
      <div className="cu-portal-body">
        <div className="cu-portal-send">
          {projects.length > 1 ? (
            <label className="cu-portal-project">For project
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="cu-portal-project">For <b>{projects[0]?.name}</b></p>
          )}
          {/* Keyed on the project so a new pick starts a new batch (one notification per drop). */}
          <DropUploader
            key={projectId}
            compact
            url={projectId ? portalUploadUrl(workspaceId, projectId) : null}
            fields={NO_FIELDS}
            accept={accept}
            maxBytes={maxBytes}
            allowedKinds={[]}
            onSent={onSent}
          />
        </div>
        <div className="cu-portal-recent">
          <h3>Recently sent</h3>
          {recent.length === 0
            ? <p className="cu-portal-empty">Nothing yet. Files you send show up here, and the studio is notified.</p>
            : <ul>
              {recent.map((row) => {
                const project = projects.find((entry) => entry.id === row.project_id);
                return <li key={row.id}>
                  <strong title={row.file_name}>{row.file_name}</strong>
                  <small>{formatBytes(row.size_bytes)}{project ? ` · ${project.name}` : ""} · {shortDateTime(row.created_at)}</small>
                </li>;
              })}
            </ul>}
        </div>
      </div>
    </section>
  );
}
