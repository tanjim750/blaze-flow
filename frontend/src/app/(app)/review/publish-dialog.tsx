"use client";

/**
 * "Publish to project" for a library file opened in review.
 *
 * Picks a project (and a folder in it), and whether the file becomes a new asset or the
 * next version of one already in that project. On publish the server creates the review
 * version on the same file and saves this session's notes and drawings as real comments in
 * one go; recordings follow as attachments on their comments. The page then reloads its
 * data, which is what removes the "kept on this device" banner — the cut now has a target.
 */
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { clearLocalReview, type LocalAnnotation } from "@/lib/review-local";
import type { ReviewNote } from "@/lib/review-notes";
import { carriedSummary, folderOptions, publishPayload, type PublishOptions } from "@/lib/publish";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** The `File` id the page is addressed by, whose session notes are carried over. */
  mediaId: string;
  fileName: string;
  options: PublishOptions;
  local: { notes: ReviewNote[]; annotations: LocalAnnotation[] };
};

function csrfToken(): string {
  const match = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return match ? decodeURIComponent(match.slice("csrftoken=".length)) : "";
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { detail?: string } | Record<string, unknown> | null;
  if (body && typeof (body as { detail?: unknown }).detail === "string") return (body as { detail: string }).detail;
  if (body) return Object.values(body).flat().map(String).join(" ") || fallback;
  return fallback;
}

export function PublishDialog({ open, onClose, workspaceId, mediaId, fileName, options, local }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(options.defaultProjectId ?? options.projects[0]?.id ?? "");
  const [folderId, setFolderId] = useState(options.defaultProjectId === projectId ? options.defaultFolderId ?? "" : "");
  const [mode, setMode] = useState<"asset" | "version">("asset");
  const [versionOf, setVersionOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folders = useMemo(() => folderOptions(options.folders, projectId), [options.folders, projectId]);
  const assets = useMemo(() => options.assets.filter((item) => item.projectId === projectId), [options.assets, projectId]);
  const payload = useMemo(() => publishPayload(local), [local]);
  const carried = carriedSummary(payload);
  const versionTarget = mode === "version" ? assets.find((item) => item.assetFileId === versionOf) ?? null : null;

  function pickProject(next: string) {
    setProjectId(next);
    setFolderId(next === options.defaultProjectId ? options.defaultFolderId ?? "" : "");
    setVersionOf("");
    if (!options.assets.some((item) => item.projectId === next)) setMode("asset");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!projectId || busy) return;
    if (mode === "version" && !versionTarget) { setError("Pick the asset this is a new version of."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/asset-files/${options.assetFileId}/publish/`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
        body: JSON.stringify({
          project_id: projectId,
          folder_id: mode === "asset" ? folderId || null : null,
          version_of_id: versionTarget?.assetFileId ?? null,
          notes: payload.notes,
          annotations: payload.annotations,
        }),
      });
      if (!response.ok) { setError(await readError(response, `Publishing failed (${response.status}).`)); return; }
      const result = await response.json() as {
        media_version: { id: string; project_id?: string };
        comment_ids: Record<string, string>;
      };
      // Recordings ride on their comments as attachments, exactly as the composer posts them.
      const projectFor = result.media_version.project_id ?? projectId;
      let lostRecordings = 0;
      for (const clip of payload.recordings) {
        const commentId = result.comment_ids[clip.key];
        if (!commentId) { lostRecordings += 1; continue; }
        try {
          const blob = await (await fetch(clip.url)).blob();
          const body = new FormData();
          const extension = clip.mimeType.split("/")[1]?.split(";")[0] || "webm";
          body.set("file", new File([blob], `${clip.kind === "voice" ? "voice-note" : "screen-recording"}-${Date.now()}.${extension}`, { type: clip.mimeType }));
          const uploaded = await fetch(`/api/workspaces/${workspaceId}/projects/${projectFor}/media-versions/${result.media_version.id}/comments/${commentId}/attachments/`, {
            method: "POST", body, credentials: "include", headers: { "X-CSRFToken": csrfToken() },
          });
          if (!uploaded.ok) lostRecordings += 1;
        } catch {
          lostRecordings += 1;
        }
      }
      clearLocalReview(mediaId);
      const project = options.projects.find((item) => item.id === projectId)?.name ?? "the project";
      toast.success(`Published to ${project}`, {
        description: [carried ? `${carried} saved as comments.` : "Notes now save to the project.", lostRecordings ? `${lostRecordings} recording${lostRecordings === 1 ? "" : "s"} could not be attached.` : null].filter(Boolean).join(" "),
      });
      onClose();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publishing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      {open && (
        <DialogContent className="tb-dialog rv-publish">
          <form onSubmit={submit} className="tb-form">
            <header className="tb-dialog-head is-wide">
              <DialogTitle>Publish to project</DialogTitle>
              <DialogDescription>
                Make <strong>{fileName}</strong> a review version in a project, so notes, approvals and share links are saved for everyone.
              </DialogDescription>
              <DialogClose />
            </header>
            <label className="tb-field is-wide">
              <span>Project</span>
              <select value={projectId} onChange={(event) => pickProject(event.target.value)} required disabled={busy}>
                {!projectId && <option value="">Pick a project…</option>}
                {options.projects.map((item) => <option key={item.id} value={item.id}>{item.clientName ? `${item.clientName} · ${item.name}` : item.name}</option>)}
              </select>
            </label>
            {options.canBeVersion && assets.length > 0 && (
              <fieldset className="rv-publish-mode is-wide" disabled={busy}>
                <legend>Publish as</legend>
                <label><input type="radio" name="publish-mode" checked={mode === "asset"} onChange={() => setMode("asset")} />A new asset</label>
                <label><input type="radio" name="publish-mode" checked={mode === "version"} onChange={() => setMode("version")} />A new version of an existing asset</label>
              </fieldset>
            )}
            {mode === "version" ? (
              <label className="tb-field is-wide">
                <span>Asset</span>
                <select value={versionOf} onChange={(event) => setVersionOf(event.target.value)} required disabled={busy}>
                  <option value="">Pick an asset…</option>
                  {assets.map((item) => <option key={item.assetFileId} value={item.assetFileId}>{item.name} ({item.label})</option>)}
                </select>
              </label>
            ) : (
              <label className="tb-field is-wide">
                <span>Folder</span>
                <select value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={busy || !projectId}>
                  <option value="">Project root</option>
                  {folders.map((item) => <option key={item.id} value={item.id}>{`${"\u2003".repeat(item.depth)}${item.name}`}</option>)}
                </select>
              </label>
            )}
            <p className="rv-publish-carry is-wide" role="note">
              {carried
                ? <>Your {carried} from this session will be saved as comments{payload.recordings.length ? ", with their recordings attached" : ""}.</>
                : <>It starts in the first review stage, ready to share.</>}
            </p>
            {error && <p className="tb-error is-wide" role="alert">{error}</p>}
            <footer className="tb-dialog-foot is-wide">
              <button type="button" className="tb-button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="tb-button is-primary" disabled={busy || !projectId}>
                <UploadCloud aria-hidden="true" />{busy ? "Publishing…" : "Publish"}
              </button>
            </footer>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
