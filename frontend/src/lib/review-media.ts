import { listAssetFiles, listAssetFolders, listClientTeams, listMediaVersions, listProjects, listTaskStages } from "./api";
import type { ClientTeam, MediaVersion, Project, ProjectFile, ProjectFolder, TaskStage } from "./api";
import { loadWorkspaceContext } from "./workspace";

/**
 * Resolves the one media record that sits behind every entry point into review.
 *
 * Blaze Flow reaches the same video from four places — the Files library, a project's
 * files, a task, and the review page itself — and the spec for this feature is that all
 * four open *the same* review, never a copy. That is possible without any new backend
 * column because the two tables that describe a video already share a third:
 *
 *   ProjectFile.file_id  ─┐
 *                         ├──►  File   ← the row that actually holds the bytes
 *   MediaVersion.original_file_id ─┘
 *
 * So the `File` id is the identity used throughout this feature. Every link into review is
 * `/review?media=<file id>`, which means two entry points for one video produce a
 * byte-identical URL rather than two addresses that happen to render alike.
 *
 * The two sources are not interchangeable, though, and the difference decides what the
 * review page can offer:
 *
 * - A `MediaVersion` is a project deliverable. Comments, annotations, reactions,
 *   attachments, workflow transitions, and guest links all hang off it. `target` is set.
 * - A `ProjectFile` is a library asset. It carries the client/project/folder/stage
 *   relationships and the bytes, but the API has nowhere to put a note about it, so
 *   `target` is null and the review page keeps notes on the device instead.
 *
 * Nothing here invents the link between them: if a library file and a media version
 * happen to be the same `File`, they collapse into one version because they *are* one row.
 */

export type ReviewTarget = { workspaceId: string; projectId: string; versionId: string };
export type MediaKind = "video" | "audio" | "image" | "other";

/** One cut in an asset's history, addressed by the id of the `File` holding its bytes. */
export type ReviewVersion = {
  id: string;
  label: string;
  number: number;
  title: string;
  createdAt: string;
  sizeBytes: number;
  mimeType: string;
  /** Streams through the Next rewrite; null while the file is still being ingested. */
  src: string | null;
  stageName: string | null;
  /** Non-null only for a project media version — the thing review data attaches to. */
  target: ReviewTarget | null;
  /** The asset-library row for this file, when it has one. */
  assetFileId: string | null;
  /** Who uploaded this cut, when the API knows. */
  uploadedBy: string | null;
};

/** A version line: one creative asset, its history, and the context it belongs to. */
export type ReviewAsset = {
  key: string;
  /** The `MediaAsset` row, when this line is a real asset rather than a legacy grouping. */
  assetId: string | null;
  name: string;
  kind: MediaKind;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  folderId: string | null;
  folderName: string | null;
  /** The workspace task stage the library row sits in, which is the file's review status. */
  stage: { id: string; name: string; color: string } | null;
  /** Oldest first, so `at(-1)` is the newest cut. */
  versions: ReviewVersion[];
};

export type MediaCatalogue = {
  workspaceId: string | null;
  assets: ReviewAsset[];
  stages: TaskStage[];
  clients: ClientTeam[];
  projects: Project[];
  notice: string | null;
};

export function mediaKind(mimeType: string, name: string): MediaKind {
  const type = mimeType.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension)) return "video";
  if (["wav", "mp3", "aif", "aiff", "m4a", "flac"].includes(extension)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) return "image";
  return "other";
}

/**
 * Collapses `Summer_Campaign_V3.mp4`, `Summer Campaign v4.mov` and `Summer Campaign` to one
 * key, so successive uploads of the same cut line up as a version history instead of
 * appearing as unrelated assets.
 *
 * Filenames are the only signal available: neither table records "these are the same
 * asset". That makes this a heuristic, and it is deliberately a conservative one — it
 * strips a trailing version marker and nothing else, so two genuinely different files are
 * only ever grouped when their names match apart from that marker.
 */
export function versionKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, "")
    .replace(/[\s._-]*(?:v|ver|version)[\s._-]*\d+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Reads the `V3` off a filename so library uploads order the way their names imply. */
export function versionNumber(title: string, fallback: number): number {
  const match = title.replace(/\.[a-z0-9]{1,5}$/i, "").match(/(?:v|ver|version)[\s._-]*(\d+)$/i);
  return match ? Number(match[1]) : fallback;
}

const previewSrc = (target: ReviewTarget) =>
  `/api/workspaces/${target.workspaceId}/projects/${target.projectId}/media-versions/${target.versionId}/preview/`;
const downloadSrc = (workspaceId: string, assetFileId: string) =>
  `/api/workspaces/${workspaceId}/asset-files/${assetFileId}/download/`;

type CatalogueInput = {
  workspaceId: string;
  projects: Project[];
  clients: ClientTeam[];
  folders: ProjectFolder[];
  assetFiles: ProjectFile[];
  stages: TaskStage[];
  mediaVersions: { projectId: string; versions: MediaVersion[] }[];
};

/**
 * Builds the catalogue. Exported without the network so the grouping rules can be tested
 * directly.
 *
 * Media versions are grouped within their project; library files are grouped within their
 * project *and* folder, because "Final Cuts/hero.mp4" and "Archive/hero.mp4" are two
 * assets to anyone looking at the tree, whatever their names say.
 */
/**
 * Builds the catalogue.
 *
 * Grouping comes from `media_asset` — a real row the drag gesture writes — rather than from
 * the filenames it used to be guessed from. Guessing could never express "this file is a
 * version of that one", and it quietly disagreed with the user whenever a name did not fit
 * the pattern.
 *
 * A media version is not a separate cut here. It is the *same* `File` seen from a project,
 * so it attaches to the library version that already holds those bytes and gives it a
 * `target` — the place review data lives. Only a media version with no library row at all
 * still forms its own line, which is what keeps pre-library project uploads reachable.
 */
export function buildCatalogue(input: CatalogueInput): ReviewAsset[] {
  const { workspaceId } = input;
  const projectName = new Map(input.projects.map((project) => [project.id, project.name]));
  const projectClient = new Map(input.projects.map((project) => [project.id, project.client_team_id]));
  const clientName = new Map(input.clients.map((client) => [client.id, client.name]));
  const folderName = new Map(input.folders.map((folder) => [folder.id, folder.name]));
  const stageById = new Map(input.stages.map((stage) => [stage.id, stage]));

  const groups = new Map<string, ReviewVersion[]>();
  const context = new Map<string, { projectId: string | null; folderId: string | null; name: string; row: ProjectFile }>();
  const byFileId = new Map<string, ReviewVersion>();

  for (const item of input.assetFiles) {
    // A row with no asset predates versioning; it stands alone rather than being guessed at.
    const key = `asset:${item.media_asset?.id ?? item.id}`;
    const version: ReviewVersion = {
      id: item.file.id,
      label: `V${item.version_number}`,
      number: item.version_number,
      title: item.file.name,
      createdAt: item.created_at,
      sizeBytes: item.file.size_bytes,
      mimeType: item.file.mime_type,
      src: item.file.status === "READY" ? downloadSrc(workspaceId, item.id) : null,
      stageName: item.task_stage_id ? stageById.get(item.task_stage_id)?.name ?? null : null,
      uploadedBy: item.added_by?.name ?? null,
      target: null,
      assetFileId: item.id,
    };
    push(groups, key, version);
    byFileId.set(item.file.id, version);
    const existing = context.get(key);
    if (!existing || item.version_number >= existing.row.version_number) {
      context.set(key, { projectId: item.project_id, folderId: item.folder_id, name: item.media_asset?.name ?? item.file.name, row: item });
    }
  }

  for (const { projectId, versions } of input.mediaVersions) {
    for (const media of versions) {
      const target: ReviewTarget = { workspaceId, projectId, versionId: media.id };
      const known = byFileId.get(media.file.id);
      if (known) {
        // Same bytes, so the same cut: give the library version somewhere to keep review data.
        known.target = target;
        known.src = previewSrc(target);
        known.stageName = media.current_stage?.name ?? known.stageName;
        continue;
      }
      const key = `media:${projectId}:${versionKey(media.title || media.file.name)}`;
      push(groups, key, {
        id: media.file.id,
        label: `V${media.version_number}`,
        number: media.version_number,
        title: media.title || media.file.name,
        createdAt: media.created_at,
        sizeBytes: media.file.size_bytes,
        mimeType: media.file.mime_type,
        src: previewSrc(target),
        stageName: media.current_stage?.name ?? null,
        uploadedBy: null,
        target,
        assetFileId: null,
      });
      if (!context.has(key)) {
        context.set(key, { projectId, folderId: null, name: media.title || media.file.name, row: null as unknown as ProjectFile });
      }
    }
  }

  return [...groups.entries()].map(([key, versions]) => {
    const ordered = [...versions].sort((a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt));
    const newest = ordered[ordered.length - 1];
    const where = context.get(key)!;
    const assetRow = where.row ?? null;
    const stage = assetRow?.task_stage_id ? stageById.get(assetRow.task_stage_id) : undefined;
    const clientId = assetRow?.client_team_id ?? (where.projectId ? projectClient.get(where.projectId) ?? null : null);
    return {
      key,
      assetId: assetRow?.media_asset?.id ?? null,
      name: where.name,
      kind: mediaKind(newest.mimeType, newest.title),
      clientId,
      clientName: clientId ? clientName.get(clientId) ?? null : null,
      projectId: where.projectId,
      projectName: where.projectId ? projectName.get(where.projectId) ?? null : null,
      folderId: where.folderId,
      folderName: where.folderId ? folderName.get(where.folderId) ?? null : null,
      stage: stage ? { id: stage.id, name: stage.name, color: stage.color } : null,
      versions: ordered,
    };
  });
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** Finds the asset and cut for a `File` id, which is what every entry point links with. */
export function locate(assets: ReviewAsset[], fileId: string | undefined): { asset: ReviewAsset; version: ReviewVersion } | null {
  if (!fileId) return null;
  for (const asset of assets) {
    const version = asset.versions.find((item) => item.id === fileId);
    if (version) return { asset, version };
  }
  return null;
}

/** Finds the cut a legacy `?project=&version=` link points at. */
export function locateByTarget(assets: ReviewAsset[], projectId: string | undefined, versionId: string | undefined) {
  if (!projectId) return null;
  for (const asset of assets) {
    const version = asset.versions.find((item) =>
      item.target?.projectId === projectId && (!versionId || item.target.versionId === versionId));
    if (version) return { asset, version };
  }
  return null;
}

/**
 * The cut to open when a link named none: the newest reviewable one, falling back to the
 * newest of anything. Landing on an empty viewer is the one outcome worth avoiding.
 */
export function defaultSelection(assets: ReviewAsset[]) {
  const byRecency = [...assets].sort((a, b) =>
    (b.versions[b.versions.length - 1]?.createdAt ?? "").localeCompare(a.versions[a.versions.length - 1]?.createdAt ?? ""));
  const reviewable = byRecency.find((asset) => asset.versions.some((version) => version.target && version.src));
  const playable = byRecency.find((asset) => asset.versions.some((version) => version.src));
  const asset = reviewable ?? playable ?? byRecency[0];
  if (!asset) return null;
  const versions = asset.versions;
  const version = [...versions].reverse().find((item) => item.target && item.src)
    ?? [...versions].reverse().find((item) => item.src)
    ?? versions[versions.length - 1];
  return { asset, version };
}

export async function loadMediaCatalogue(): Promise<MediaCatalogue> {
  const context = await loadWorkspaceContext();
  const empty = { workspaceId: null, assets: [], stages: [], clients: [], projects: [] };
  if (!context.ok) return { ...empty, notice: context.error.detail };
  if (!context.data.selected) return { ...empty, notice: "This account has no workspace yet." };

  const workspaceId = context.data.selected.id;
  const [projects, clients, assetFiles, folders, workflow] = await Promise.all([
    listProjects(workspaceId), listClientTeams(workspaceId), listAssetFiles(workspaceId),
    listAssetFolders(workspaceId), listTaskStages(workspaceId),
  ]);
  if (!projects.ok) return { ...empty, workspaceId, notice: projects.error.detail };

  const scans = await Promise.all(projects.data.map(async (project) => ({
    projectId: project.id,
    versions: await listMediaVersions(workspaceId, project.id),
  })));

  const assets = buildCatalogue({
    workspaceId,
    projects: projects.data,
    clients: clients.ok ? clients.data : [],
    folders: folders.ok ? folders.data : [],
    assetFiles: assetFiles.ok ? assetFiles.data : [],
    stages: workflow.ok ? workflow.data.stages : [],
    mediaVersions: scans.map(({ projectId, versions }) => ({ projectId, versions: versions.ok ? versions.data : [] })),
  });

  const failed = [clients, assetFiles, folders, workflow].find((result) => !result.ok);
  return {
    workspaceId,
    assets,
    stages: workflow.ok ? workflow.data.stages : [],
    clients: clients.ok ? clients.data : [],
    projects: projects.data,
    notice: failed && !failed.ok ? failed.error.detail : null,
  };
}
