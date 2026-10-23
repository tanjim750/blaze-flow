import { listMediaVersions, listProjects, type MediaVersion } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type RenderQueueItem = { projectId: string; projectName: string; media: MediaVersion };
export async function loadRenderQueue(): Promise<{ items: RenderQueueItem[]; notice: string | null; timeZone?: string; now: number }> {
  const context = await loadWorkspaceContext(); if (!context.ok || !context.data.selected) return { items: [], notice: context.ok ? "No workspace selected." : context.error.detail, now: Date.now() };
  const workspace = context.data.selected; const projects = await listProjects(workspace.id); if (!projects.ok) return { items: [], notice: projects.error.detail, now: Date.now() };
  // A few projects at a time, and one failing project (timeout, throttle, network) only drops
  // its own rows with a notice; it used to fail the whole page with a 500.
  type Scan = { project: (typeof projects.data)[number]; media: Awaited<ReturnType<typeof listMediaVersions>> | null };
  const scans: Scan[] = [];
  for (let start = 0; start < projects.data.length; start += 4) {
    scans.push(...await Promise.all(projects.data.slice(start, start + 4).map(async (project) => {
      try { return { project, media: await listMediaVersions(workspace.id, project.id) }; } catch { return { project, media: null }; }
    })));
  }
  const failed = scans.filter((scan) => !scan.media?.ok).length;
  const items = scans.flatMap(({ project, media }) => media?.ok ? media.data.map((item) => ({ projectId: project.id, projectName: project.name, media: item })) : []).sort((a, b) => new Date(b.media.created_at).getTime() - new Date(a.media.created_at).getTime());
  return { items, notice: failed ? `Couldn't load media for ${failed} ${failed === 1 ? "project" : "projects"}. Refresh to try again.` : null, timeZone: workspace.timezone || undefined, now: Date.now() };
}

