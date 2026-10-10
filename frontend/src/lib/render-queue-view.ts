import { listMediaVersions, listProjects, type MediaVersion } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type RenderQueueItem = { projectId: string; projectName: string; media: MediaVersion };
export async function loadRenderQueue(): Promise<{ items: RenderQueueItem[]; notice: string | null }> {
  const context = await loadWorkspaceContext(); if (!context.ok || !context.data.selected) return { items: [], notice: context.ok ? "No workspace selected." : context.error.detail };
  const workspace = context.data.selected; const projects = await listProjects(workspace.id); if (!projects.ok) return { items: [], notice: projects.error.detail };
  const scans = await Promise.all(projects.data.map(async (project) => ({ project, media: await listMediaVersions(workspace.id, project.id) })));
  return { items: scans.flatMap(({ project, media }) => media.ok ? media.data.map((item) => ({ projectId: project.id, projectName: project.name, media: item })) : []).sort((a, b) => new Date(b.media.created_at).getTime() - new Date(a.media.created_at).getTime()), notice: null };
}
