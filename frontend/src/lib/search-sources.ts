/**
 * Where search results come from. Today there is one source — the keyword `/search/`
 * endpoint — but the palette and the in-page search bar both go through `runSearchSources`,
 * so AI (semantic) search can be added later as another `SearchSource` (kind "semantic")
 * without touching either UI: register it, and its groups merge in after the keyword ones.
 */
import { fetchQuickSearch, type SearchGroup, type SearchResponse } from "./quick-search";

/** The location a search is scoped to; `null` ids mean everywhere. */
export type SearchScope = { folderId?: string | null; projectId?: string | null };
export type SearchSourceKind = "keyword" | "semantic";
export type SearchSource = {
  id: string;
  kind: SearchSourceKind;
  /** Off until its backend exists (or a flag turns it on). */
  enabled: () => boolean;
  search: (args: { workspaceId: string; query: string; scope: SearchScope; signal?: AbortSignal }) => Promise<SearchResponse>;
};

export const keywordSource: SearchSource = {
  id: "keyword", kind: "keyword", enabled: () => true,
  search: ({ workspaceId, query, signal }) => fetchQuickSearch(workspaceId, query, signal),
};

const sources: SearchSource[] = [keywordSource];

export function registerSearchSource(source: SearchSource) {
  const at = sources.findIndex((item) => item.id === source.id);
  if (at >= 0) sources[at] = source; else sources.push(source);
  return () => { const index = sources.indexOf(source); if (index >= 0) sources.splice(index, 1); };
}
export function searchSources() { return sources.filter((source) => source.enabled()); }

/**
 * Asks every enabled source and merges their groups (same key → items concatenated, deduped
 * by href, first source wins). Fails only if every source fails, so a flaky semantic
 * backend never takes keyword search down with it.
 */
export async function runSearchSources(workspaceId: string, query: string, scope: SearchScope = {}, signal?: AbortSignal): Promise<SearchResponse> {
  const active = searchSources();
  const settled = await Promise.allSettled(active.map((source) => source.search({ workspaceId, query, scope, signal })));
  const ok = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (!ok.length) {
    const first = settled.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new Error("Search is unavailable.");
  }
  const groups: SearchGroup[] = [];
  for (const response of ok) {
    for (const group of response.groups) {
      const existing = groups.find((item) => item.key === group.key);
      if (!existing) { groups.push({ ...group, items: [...group.items] }); continue; }
      const seen = new Set(existing.items.map((item) => item.href));
      existing.items.push(...group.items.filter((item) => !seen.has(item.href)));
    }
  }
  return { query, role: ok[0].role, groups };
}
