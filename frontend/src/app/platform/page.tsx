import Link from "next/link";
import { AlertTriangle, ChevronRight, Info, OctagonAlert } from "@/components/icons";
import { ErrorPanel, PageHead, Pill, Stat } from "@/components/platform/ui";
import { getOverview } from "@/lib/platform-api";
import { RANGES, chartMax, firstParam, formatMoney, parseRange, percent, share } from "@/lib/platform-view";

export default async function PlatformOverview({ searchParams }: PageProps<"/platform">) {
  const days = parseRange(firstParam((await searchParams).days));
  const result = await getOverview(days);
  if (!result.ok) return <><PageHead title="Overview" /><ErrorPanel detail={result.error.detail} /></>;
  const o = result.data;
  const max = chartMax(o.users.signups_by_day.map((d) => d.count));
  const freeShare = share(o.plans.free, o.plans.free + o.plans.pro);
  return <>
    <PageHead title="Overview" sub={<>How Krewsys is doing across every workspace. {o.demo_users > 0 && <Pill tone="demo">Includes {o.demo_users} demo users</Pill>} {o.signup_mode && <Pill tone={o.signup_mode === "invite_only" ? "violet" : "neutral"}>Sign-up: {o.signup_mode === "invite_only" ? "invite-only" : "open"}</Pill>} {o.email_backend && <Pill tone={o.email_sending ? "good" : "warn"}>Email: {o.email_sending ? `sending via ${o.email_transport}` : `${o.email_backend} (not sent)`}</Pill>}</>}>
      <nav className="pf-range" aria-label="Date range">
        {RANGES.map((r) => <Link key={r} href={`/platform?days=${r}`} className={r === days ? "active" : undefined} aria-current={r === days ? "page" : undefined}>{r}d</Link>)}
      </nav>
    </PageHead>

    <section className="pf-stats" aria-label="Key numbers">
      <Stat label={`Signups (${days}d)`} value={o.users.signups} hint={`${o.users.total} users total · ${o.users.verified} verified`} />
      <Stat label={`Active workspaces (${days}d)`} value={<>{o.workspaces.active}<small> / {o.workspaces.total}</small></>} hint="had activity in the range" />
      <Stat label="Paying PRO" value={o.plans.pro_paying} hint={`${o.plans.trialing} on free trial`} />
      <Stat label="Est. MRR" value={formatMoney(o.revenue.mrr_minor, o.currency)} hint={`${o.plans.pro_paying} × ${formatMoney(o.pro_price_minor, o.currency)}/mo · estimate until Stripe`} tone="good" />
      <Stat label={`Churn (${days}d)`} value={percent(o.revenue.churn_rate)} hint={`${o.revenue.churned} cancelled/expired · ${o.revenue.cancelling} cancelling`} tone={o.revenue.churned ? "warn" : undefined} />
      <Stat label={`Trial conversion (${days}d)`} value={percent(o.revenue.trial_conversion_rate)} hint={`${o.revenue.trials_converted} of ${o.revenue.trials_ended} ended trials kept PRO`} />
      <Stat label={`New PRO (${days}d)`} value={o.revenue.new_pro} hint="trials included" />
      <Stat label={`AI QA (${days}d)`} value={<>{o.ai_qa.runs}<small> runs</small></>} hint={`${o.ai_qa.minutes} media minutes · ${o.ai_qa.failed} failed`} />
    </section>

    <div className="pf-grid-2">
      <section className="pf-card">
        <h2>Signups per day</h2>
        <div className="pf-bars" role="img" aria-label={`Signups per day over ${days} days, peak ${max}`}>
          {o.users.signups_by_day.map((d) => <span key={d.date} style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} className={d.count ? undefined : "is-zero"} title={`${d.date}: ${d.count}`} />)}
        </div>
        <div className="pf-bars-axis"><small>{o.users.signups_by_day[0]?.date}</small><small>today</small></div>
      </section>
      <section className="pf-card">
        <h2>Plan mix</h2>
        <div className="pf-mix" aria-hidden><span style={{ width: `${freeShare}%` }} /><span style={{ width: `${100 - freeShare}%` }} /></div>
        <dl className="pf-legend">
          <div><dt><i className="is-free" />Free</dt><dd>{o.plans.free} <small>{freeShare}%</small></dd></div>
          <div><dt><i className="is-pro" />PRO paying</dt><dd>{o.plans.pro_paying}</dd></div>
          <div><dt><i className="is-trial" />PRO trial</dt><dd>{o.plans.trialing}</dd></div>
        </dl>
      </section>
    </div>

    <section className="pf-card">
      <h2>Needs attention</h2>
      {o.attention.length === 0 ? <p className="pf-empty">Nothing needs you right now.</p> : <ul className="pf-attention">
        {o.attention.map((a) => <li key={a.code} className={`is-${a.severity}`}><Link href={a.href}>
          {a.severity === "critical" ? <OctagonAlert size={17} /> : a.severity === "warning" ? <AlertTriangle size={17} /> : <Info size={17} />}
          <b>{a.count}</b><span>{a.label}</span><ChevronRight size={16} />
        </Link></li>)}
      </ul>}
      <p className="pf-foot">MRR is an estimate: active, non-trial PRO subscriptions × {formatMoney(o.pro_price_minor, o.currency)}/month (PLATFORM_PRO_PRICE_MINOR). It becomes real once Stripe is connected.</p>
    </section>
  </>;
}
