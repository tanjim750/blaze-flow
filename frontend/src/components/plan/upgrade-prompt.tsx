import Link from "next/link";
import { ArrowUpRight, Check, Sparkles } from "@/components/icons";
import type { PlanFeature } from "@/lib/api";
import { PLAN_FEATURE_LABELS } from "@/lib/plan";
import { siteConfig } from "@/lib/site-config";
import { formatMoney } from "@/lib/money";
import "./plan.css";

const starter = siteConfig.plans.find((plan) => plan.id === "starter") ?? siteConfig.plans[0];

const WHY: Record<PlanFeature, { title: string; body: string; points: string[] }> = {
  team_members: {
    title: "Bring your team in with Starter",
    body: "Solo is just you. Starter adds editors and teammates, each with their own role and only the work they need.",
    points: ["Invite editors and teammates", "Roles and permissions per person", "Assign tasks and track workload"],
  },
  editor_payouts: {
    title: "Pay your editors with Starter",
    body: "Editor rates and payouts come with Starter, alongside the team they belong to. Your client invoicing stays as it is.",
    points: ["Per-task editor rates", "Payout runs and history", "Margin per project"],
  },
  ai_qa: {
    title: "AI QA comes with Starter",
    body: "Starter checks posters and video for spelling, safe areas and timing before your client sees them.",
    points: ["Automatic checks on each cut", "Findings pinned to the frame", "Re-run after every fix"],
  },
};

/**
 * What a Solo workspace sees in place of a feature it doesn't have: a calm card that says
 * what the feature is and how to get it, never a broken page or a failing button.
 * `compact` is a one-line version for inside an existing panel.
 */
export function UpgradePrompt({ feature, compact = false, className = "" }: { feature: PlanFeature; compact?: boolean; className?: string }) {
  const why = WHY[feature];
  const price = formatMoney(starter.monthly, siteConfig.pricing.currency);
  if (compact) {
    return <div className={`plan-upgrade is-compact ${className}`} role="note" data-feature={feature}>
      <Sparkles size={15} aria-hidden="true" />
      <p><strong>{PLAN_FEATURE_LABELS[feature]}</strong> isn&rsquo;t in Solo.</p>
      <Link href={`/settings/plan?upgrade=${feature}`} className="plan-upgrade-link">Upgrade to Starter<ArrowUpRight size={13} aria-hidden="true" /></Link>
    </div>;
  }
  return <section className={`plan-upgrade ${className}`} aria-labelledby={`upgrade-${feature}`} data-feature={feature}>
    <span className="plan-upgrade-icon" aria-hidden="true"><Sparkles size={18} /></span>
    <div className="plan-upgrade-body">
      <p className="plan-upgrade-kicker">Not in your Solo plan</p>
      <h2 id={`upgrade-${feature}`}>{why.title}</h2>
      <p>{why.body}</p>
      <ul>{why.points.map((point) => <li key={point}><Check size={14} aria-hidden="true" />{point}</li>)}</ul>
      <div className="plan-upgrade-actions">
        <Link href={`/settings/plan?upgrade=${feature}`} className="plan-upgrade-cta">Upgrade to Starter</Link>
        <span>From {price}/mo · everything in Solo stays</span>
      </div>
    </div>
  </section>;
}

/** The sidebar's quiet "Upgrade to Starter" card for Solo workspaces. */
export function SidebarUpgradeCard({ onNavigate }: { onNavigate?: () => void }) {
  return <Link href="/settings/plan" className="plan-sidebar-card" onClick={onNavigate} title="Upgrade to Starter">
    <Sparkles size={15} aria-hidden="true" />
    <span><strong>Solo plan</strong><small>Add a team with Starter</small></span>
    <ArrowUpRight size={14} aria-hidden="true" className="plan-sidebar-arrow" />
  </Link>;
}
