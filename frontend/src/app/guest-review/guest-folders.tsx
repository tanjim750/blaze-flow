"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Loader } from "@/components/icons";
import { downloadGuestFolder, type GuestFolder } from "@/lib/guest-client";
import { formatBytes, percent } from "@/lib/folder-zip";

/** "Download folders" in the guest top bar: each shared folder as one zip, subfolders included. */
export function GuestFolders({ projectId, accessKey, folders }: { projectId: string; accessKey: string; folders: GuestFolder[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (folders.length === 0) return null;
  const download = async (folder: GuestFolder) => {
    const controller = new AbortController(); abort.current = controller;
    setBusy(folder.id); setStatus(`Preparing “${folder.name}.zip”…`);
    try {
      const result = await downloadGuestFolder(projectId, folder, accessKey, {
        signal: controller.signal,
        onProgress: (p) => setStatus(`Downloading “${folder.name}.zip” · ${percent(p)}% (${formatBytes(p.doneBytes)} of ${formatBytes(p.totalBytes)}). Keep this page open.`),
      });
      setStatus(result ? `Downloaded “${result.manifest.name}”: ${result.manifest.file_count} file${result.manifest.file_count === 1 ? "" : "s"}${result.skipped.length ? `, ${result.skipped.length} skipped (see _download-notes.txt)` : ""}.` : "");
    } catch (error) {
      setStatus((error as Error).name === "AbortError" ? "Download cancelled." : (error as Error).message);
    } finally { setBusy(null); abort.current = null; }
  };
  return (
    <div className="gr-folders" ref={root}>
      <button type="button" className="gr-folders-trigger" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((value) => !value)}>
        <Download size={13} /><span>Download folders</span>
      </button>
      {open && (
        <div className="gr-folders-panel" role="group" aria-label="Download folders">
          <p className="gr-folders-hint">Each folder downloads as one .zip with its subfolders.</p>
          <ul>
            {folders.map((folder) => (
              <li key={folder.id}>
                <FolderOpen size={14} aria-hidden="true" />
                <span className="gr-folders-name" title={folder.path}>{folder.path}<small>{folder.file_count} file{folder.file_count === 1 ? "" : "s"}</small></span>
                <button type="button" disabled={busy !== null} onClick={() => void download(folder)} aria-label={`Download folder ${folder.path}`}>
                  {busy === folder.id ? <Loader size={13} className="gr-spin" /> : <Download size={13} />}<span>{busy === folder.id ? "Working…" : "Download"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="gr-folders-status" role="status" aria-live="polite">{status}</p>
          {busy && <button type="button" className="gr-folders-cancel" onClick={() => abort.current?.abort()}>Cancel download</button>}
        </div>
      )}
    </div>
  );
}
