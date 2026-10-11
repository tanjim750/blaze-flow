import Link from "next/link";
import { Search } from "lucide-react";
import { Empty, ErrorPanel, PageHead, Pager, Pill, ticketTone } from "@/components/platform/ui";
import { listTickets } from "@/lib/platform-api";
import { TICKET_STATUSES, firstParam, query, relativeTime, statusLabel } from "@/lib/platform-view";

export default async function PlatformSupport({ searchParams }: PageProps<"/platform/support">) {
  const params = await searchParams;
  const status = firstParam(params.status);
  const q = firstParam(params.q);
  const assignee = firstParam(params.assignee);
  const offset = Number(firstParam(params.offset)) || 0;
  const result = await listTickets({ status, q, assignee, offset, limit: 25 });
  return <>
    <PageHead title="Support inbox" sub="Tickets from “Report a problem” in the app. Replies go out by email.">
      <form className="pf-search" action="/platform/support">
        <input type="hidden" name="status" value={status} />
        <Search size={15} /><input name="q" defaultValue={q} placeholder="#14, subject or email" aria-label="Search tickets" />
        <button className="pf-btn" type="submit">Search</button>
      </form>
    </PageHead>
    <nav className="pf-tabs" aria-label="Ticket status">
      <Link href={`/platform/support${query({ q })}`} className={!status && !assignee ? "active" : undefined}>All</Link>
      {TICKET_STATUSES.map((s) => <Link key={s} href={`/platform/support${query({ status: s, q })}`} className={status === s ? "active" : undefined} aria-current={status === s ? "page" : undefined}>
        {statusLabel(s)}{result.ok && result.data.counts[s] ? <b>{result.data.counts[s]}</b> : null}
      </Link>)}
      <Link href="/platform/support?assignee=me" className={assignee === "me" ? "active" : undefined}>Mine</Link>
    </nav>
    {!result.ok ? <ErrorPanel detail={result.error.detail} /> : result.data.results.length === 0 ? <Empty>No tickets here.</Empty> : <>
      <div className="pf-table-wrap"><table className="pf-table is-rows">
        <thead><tr><th>Ticket</th><th>From</th><th>Workspace · plan</th><th>Status</th><th>Assignee</th><th>Updated</th></tr></thead>
        <tbody>{result.data.results.map((t) => <tr key={t.id} className={t.status === "NEW" ? "is-unread" : undefined}>
          <td data-label="Ticket"><Link href={`/platform/support/${t.id}`} className="pf-row-link"><b>#{t.number} {t.subject}</b></Link><small className="pf-sub">{t.category.toLowerCase()}</small> {t.is_demo && <Pill tone="demo">demo</Pill>}</td>
          <td data-label="From">{t.user?.email}</td>
          <td data-label="Workspace · plan">{t.workspace?.name ?? "—"}<small className="pf-sub">{t.plan}</small></td>
          <td data-label="Status"><Pill tone={ticketTone(t.status)}>{statusLabel(t.status)}</Pill></td>
          <td data-label="Assignee">{t.assignee?.name ?? "—"}</td>
          <td data-label="Updated">{relativeTime(t.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
      <Pager total={result.data.total} limit={result.data.limit} offset={result.data.offset} href={(o) => `/platform/support${query({ status, q, assignee, offset: o })}`} />
    </>}
  </>;
}
