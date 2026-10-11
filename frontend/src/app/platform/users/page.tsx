import Link from "next/link";
import { Search } from "lucide-react";
import { Empty, ErrorPanel, PageHead, Pager, Pill } from "@/components/platform/ui";
import { listPlatformUsers } from "@/lib/platform-api";
import { firstParam, planLabel, query, relativeTime } from "@/lib/platform-view";

export default async function PlatformUsers({ searchParams }: PageProps<"/platform/users">) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const offset = Number(firstParam(params.offset)) || 0;
  const result = await listPlatformUsers({ q, offset, limit: 25 });
  return <>
    <PageHead title="Users" sub="Look someone up by email, name or id.">
      <form className="pf-search" action="/platform/users">
        <Search size={15} /><input name="q" defaultValue={q} placeholder="jo@studio.com" aria-label="Search users" autoFocus={!q} />
        <button className="pf-btn" type="submit">Search</button>
      </form>
    </PageHead>
    {!result.ok ? <ErrorPanel detail={result.error.detail} /> : result.data.results.length === 0 ? <Empty>No users match “{q}”.</Empty> : <>
      <div className="pf-table-wrap"><table className="pf-table is-rows">
        <thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Verified</th><th>Joined</th><th>Last sign-in</th></tr></thead>
        <tbody>{result.data.results.map((u) => <tr key={u.id}>
          <td data-label="User"><Link href={`/platform/users/${u.id}`} className="pf-row-link"><b>{u.name}</b></Link><small className="pf-sub">{u.email}</small> {u.is_demo && <Pill tone="demo">demo</Pill>} {u.is_platform_staff && <Pill tone="violet">staff</Pill>}</td>
          <td data-label="Plan"><Pill tone={u.subscription.plan === "PRO" ? "violet" : "neutral"}>{planLabel(u.subscription)}</Pill></td>
          <td data-label="Status">{u.status === "ACTIVE" ? "Active" : <Pill tone="warn">{u.status.toLowerCase()}</Pill>}</td>
          <td data-label="Verified">{u.email_verified_at ? "Yes" : <Pill tone="warn">no</Pill>}</td>
          <td data-label="Joined">{relativeTime(u.created_at)}</td>
          <td data-label="Last sign-in">{relativeTime(u.last_login)}</td>
        </tr>)}</tbody>
      </table></div>
      <Pager total={result.data.total} limit={result.data.limit} offset={result.data.offset} href={(o) => `/platform/users${query({ q, offset: o })}`} />
    </>}
  </>;
}
