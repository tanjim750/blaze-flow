import Link from "next/link";
import { Search } from "@/components/icons";
import { Empty, ErrorPanel, PageHead, Pager, Pill } from "@/components/platform/ui";
import { listPlatformWorkspaces } from "@/lib/platform-api";
import { firstParam, formatBytes, planLabel, query, relativeTime } from "@/lib/platform-view";
import { Select } from "@/components/ui/select";

export default async function PlatformWorkspaces({ searchParams }: PageProps<"/platform/workspaces">) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const status = firstParam(params.status);
  const offset = Number(firstParam(params.offset)) || 0;
  const result = await listPlatformWorkspaces({ q, status, offset, limit: 25 });
  return <>
    <PageHead title="Workspaces" sub={result.ok ? `${result.data.total} workspace${result.data.total === 1 ? "" : "s"}` : undefined}>
      <form className="pf-search" action="/platform/workspaces">
        <Search size={15} /><input name="q" defaultValue={q} placeholder="Name, slug or owner email" aria-label="Search workspaces" />
        <Select name="status" defaultValue={status} aria-label="Status" options={[{ value: "", label: "Any status" }, { value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "PENDING_DELETION", label: "Pending deletion" }]} />
        <button className="pf-btn" type="submit">Search</button>
      </form>
    </PageHead>
    {!result.ok ? <ErrorPanel detail={result.error.detail} /> : result.data.results.length === 0 ? <Empty>No workspaces match.</Empty> : <>
      <div className="pf-table-wrap"><table className="pf-table is-rows">
        <thead><tr><th>Workspace</th><th>Owner</th><th>Plan</th><th>Members</th><th>Projects</th><th>Storage</th><th>Last active</th></tr></thead>
        <tbody>{result.data.results.map((w) => <tr key={w.id}>
          <td data-label="Workspace"><Link href={`/platform/workspaces/${w.id}`} className="pf-row-link"><b>{w.name}</b></Link> {w.is_demo && <Pill tone="demo">demo</Pill>} {w.status !== "ACTIVE" && <Pill tone="warn">{w.status.toLowerCase()}</Pill>}</td>
          <td data-label="Owner">{w.owner?.email ?? "—"}</td>
          <td data-label="Plan"><Pill tone={w.subscription?.plan === "PRO" ? "violet" : "neutral"}>{planLabel(w.subscription)}</Pill></td>
          <td data-label="Members">{w.members}</td>
          <td data-label="Projects" className={w.projects >= w.limits.projects ? "pf-warn-text" : undefined}>{w.projects} / {w.limits.projects}</td>
          <td data-label="Storage" className={w.storage_bytes >= w.limits.storage_bytes * 0.9 ? "pf-warn-text" : undefined}>{formatBytes(w.storage_bytes)} / {formatBytes(w.limits.storage_bytes)}</td>
          <td data-label="Last active">{relativeTime(w.last_active_at)}</td>
        </tr>)}</tbody>
      </table></div>
      <Pager total={result.data.total} limit={result.data.limit} offset={result.data.offset} href={(o) => `/platform/workspaces${query({ q, status, offset: o })}`} />
    </>}
  </>;
}
