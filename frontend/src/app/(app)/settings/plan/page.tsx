import Link from "next/link";
import { guardRoute } from "@/lib/route-guard";
import { getSubscription } from "@/lib/api";
import { roleFor } from "@/lib/dashboard-role";
import { currentOption, planOptions, PLAN_FEATURE_LABELS } from "@/lib/plan";
import { siteConfig } from "@/lib/site-config";
import { loadWorkspaceContext } from "@/lib/workspace";
import { UpgradePrompt } from "@/components/plan/upgrade-prompt";
import type { PlanFeature } from "@/lib/api";
import { PlanPicker } from "./picker";
import "../settings.css";
import "./plan.css";

const FEATURES = Object.keys(PLAN_FEATURE_LABELS) as PlanFeature[];

/** Plan & billing: the in-app plan picker (test mode, no payment taken yet). */
export default async function PlanPage({ searchParams }: PageProps<"/settings/plan">) {
  await guardRoute("/settings");
  const [subscription, context, params] = await Promise.all([getSubscription(), loadWorkspaceContext(), searchParams]);
  const workspace = context.ok ? context.data.selected : null;
  const owner = Boolean(workspace && roleFor(workspace) === "owner");
  const upgrade = typeof params.upgrade === "string" && (FEATURES as string[]).includes(params.upgrade) ? params.upgrade as PlanFeature : null;
  const plan = subscription.ok ? subscription.data.plan : workspace?.plan ?? null;
  return <div className="settings-page plan-page">
    <header><h1>Plan</h1><p>Prices in {siteConfig.pricing.currency}, billed monthly. Your plan covers every workspace you own.</p></header>
    {upgrade && plan === "SOLO" && <UpgradePrompt feature={upgrade} compact />}
    {!subscription.ok && <p className="form-error" role="alert">Your plan couldn&rsquo;t be loaded: {subscription.error.detail}</p>}
    {!owner && <p className="plan-note">Only the workspace owner can change the plan.</p>}
    <PlanPicker
      options={planOptions()}
      current={currentOption(plan)}
      currency={siteConfig.pricing.currency}
      canChange={owner && subscription.ok}
      excluded={siteConfig.solo.excluded}
    />
    <p className="plan-note">Test mode: changing plan takes no payment yet. Starter, Pro and Scale currently unlock the same studio features. <Link href="/pricing">Compare plans</Link></p>
  </div>;
}
