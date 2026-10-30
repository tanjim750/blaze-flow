import type { PlanFeature, Workspace, WorkspacePlan } from "./api";
import { siteConfig } from "./site-config";

/**
 * Plan helpers for the app. The backend is the source of truth (gated endpoints answer 403
 * `plan_upgrade_required`); these only decide what to show, so a Solo owner sees an
 * "Upgrade to Starter" prompt instead of a control that would fail.
 */
type PlanAccess = Partial<Pick<Workspace, "plan" | "plan_features">> | null | undefined;

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  ai_qa: "AI QA",
  team_members: "Team members",
  editor_payouts: "Editor payouts",
};

export function isSolo(workspace: PlanAccess): boolean {
  return workspace?.plan === "SOLO";
}

/** True unless the backend listed the workspace's features and this one isn't among them. */
export function hasFeature(workspace: PlanAccess, feature: PlanFeature): boolean {
  if (!workspace || !Array.isArray(workspace.plan_features)) return true;
  return workspace.plan_features.includes(feature);
}

export type PlanOption = {
  id: "solo" | "starter" | "pro" | "scale";
  name: string;
  monthly: number;
  /** What the backend stores: Solo is SOLO; the studio tiers are all PRO for now. */
  backend: Exclude<WorkspacePlan, "FREE">;
  storage: string;
  users: string;
  points: string[];
  highlighted?: boolean;
};

/** Solo first, then the marketing tiers, from the same site-config the pricing page uses. */
export function planOptions(): PlanOption[] {
  const { solo, plans } = siteConfig;
  return [
    { id: "solo", name: solo.name, monthly: solo.monthly, backend: "SOLO", storage: solo.storage, users: solo.users, points: solo.included.slice(0, 4) },
    ...plans.map((p) => ({
      id: p.id as PlanOption["id"], name: p.name, monthly: p.monthly, backend: "PRO" as const,
      storage: p.features[0], users: p.features[1], points: ["Everything in Solo", "Team members and editor roles", "Editor payouts", "AI QA"], highlighted: p.highlighted,
    })),
  ];
}

/** Which option the current backend plan corresponds to (PRO shows as the Starter+ tiers). */
export function currentOption(plan: WorkspacePlan | undefined | null): PlanOption["id"] | null {
  if (plan === "SOLO") return "solo";
  if (plan === "PRO") return "starter";
  return null;
}
