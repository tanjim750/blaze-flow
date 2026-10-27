import { AuditTable, ErrorPanel, PageHead, Pager } from "@/components/platform/ui";
import { listAudit } from "@/lib/platform-api";
import { firstParam, query } from "@/lib/platform-view";
import { Select } from "@/components/ui/select";

export default async function PlatformAudit({ searchParams }: PageProps<"/platform/audit">) {
  const params = await searchParams;
  const filters = {
    actor_type: firstParam(params.actor_type), action: firstParam(params.action), actor: firstParam(params.actor),
    workspace_id: firstParam(params.workspace_id), days: firstParam(params.days) || "30",
  };
  const offset = Number(firstParam(params.offset)) || 0;
  const result = await listAudit({ ...filters, offset, limit: 50 });
  return <>
    <PageHead title="Audit log" sub="Everything recorded across Blaze Flow. Every staff action appears here with its reason." />
    <form className="pf-filters" action="/platform/audit">
      <label>Actor type<Select name="actor_type" aria-label="Actor type" defaultValue={filters.actor_type} options={[{ value: "", label: "Any" }, { value: "PLATFORM_STAFF", label: "Staff" }, { value: "USER", label: "User" }, { value: "GUEST", label: "Guest" }, { value: "SYSTEM", label: "System" }]} /></label>
      <label>Actor email<input name="actor" defaultValue={filters.actor} placeholder="name@…" /></label>
      <label>Action contains<input name="action" defaultValue={filters.action} placeholder="platform." /></label>
      <label>Range<Select name="days" aria-label="Range" defaultValue={filters.days} options={[{ value: "1", label: "24 h" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "365", label: "1 year" }]} /></label>
      {filters.workspace_id && <input type="hidden" name="workspace_id" value={filters.workspace_id} />}
      <button className="pf-btn" type="submit">Filter</button>
    </form>
    {!result.ok ? <ErrorPanel detail={result.error.detail} /> : <>
      <p className="pf-count">{result.data.total} entr{result.data.total === 1 ? "y" : "ies"}</p>
      <AuditTable rows={result.data.results} />
      <Pager total={result.data.total} limit={result.data.limit} offset={result.data.offset} href={(o) => `/platform/audit${query({ ...filters, offset: o })}`} />
    </>}
  </>;
}
