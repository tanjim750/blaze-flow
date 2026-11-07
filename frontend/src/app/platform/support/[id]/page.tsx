import Link from "next/link";
import { ArrowLeft, Mail } from "@/components/icons";
import { TicketWorkbench } from "@/components/platform/ticket-workbench";
import { ErrorPanel, PageHead, Pill, ticketTone } from "@/components/platform/ui";
import { getTicket } from "@/lib/platform-api";
import { formatDate, statusLabel } from "@/lib/platform-view";
import { loadSession } from "@/lib/session";

const CONTEXT_LABELS: Record<string, string> = { url: "Page", plan: "Plan", workspace_name: "Workspace", request_id: "Request id", user_agent: "Browser", viewport: "Screen", last_request_id: "Last request" };

export default async function PlatformTicket({ params }: PageProps<"/platform/support/[id]">) {
  const { id } = await params;
  const [result, session] = await Promise.all([getTicket(id), loadSession()]);
  if (!result.ok) return <><Link className="pf-back-link" href="/platform/support"><ArrowLeft size={14} />Support</Link><ErrorPanel detail={result.error.detail} /></>;
  const t = result.data;
  return <>
    <Link className="pf-back-link" href="/platform/support"><ArrowLeft size={14} />Support inbox</Link>
    <PageHead title={`#${t.number} ${t.subject}`} sub={<><Pill tone={ticketTone(t.status)}>{statusLabel(t.status)}</Pill> {t.category.toLowerCase()} · opened {formatDate(t.created_at)} {t.assignee && <>· assigned to {t.assignee.name}</>} {t.is_demo && <Pill tone="demo">demo</Pill>}</>} />
    <div className="pf-ticket">
      <div className="pf-thread">
        {t.messages.map((m) => <article key={m.id} className={`pf-msg is-${m.kind.toLowerCase()}`}>
          <header><b>{m.author?.name ?? "Unknown"}</b><small>{m.kind === "NOTE" ? "internal note" : m.kind === "REPLY" ? "reply" : "customer"} · {formatDate(m.created_at)}</small>
            {m.kind === "REPLY" && <small className="pf-sent"><Mail size={12} />{m.email_sent_at ? `emailed ${formatDate(m.email_sent_at)}` : "email queued"}</small>}</header>
          <p>{m.body}</p>
        </article>)}
        <TicketWorkbench ticket={t} staffEmail={session.user?.email ?? ""} />
      </div>
      <aside className="pf-card pf-context">
        <h2>Customer</h2>
        <p><Link href={`/platform/users/${t.user?.id}`}>{t.user?.name}</Link><small className="pf-sub">{t.user?.email}</small></p>
        {t.workspace && <p><Link href={`/platform/workspaces/${t.workspace.id}`}>{t.workspace.name}</Link></p>}
        <h2 className="pf-h2-gap">Captured with the report</h2>
        <dl className="pf-dl">{Object.entries(t.context ?? {}).filter(([k, v]) => v && k !== "workspace_slug").map(([k, v]) => <div key={k}><dt>{CONTEXT_LABELS[k] ?? k}</dt><dd>{k === "url" ? <a href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> : String(v)}</dd></div>)}</dl>
        <p className="pf-quick"><Link href={`/platform/jobs`}>Failing jobs</Link>{t.workspace && <Link href={`/platform/audit?workspace_id=${t.workspace.id}`}>Workspace audit</Link>}</p>
      </aside>
    </div>
  </>;
}
