import type { DashboardRole, Workspace } from "./api";

/**
 * Which dashboard layout to render.
 *
 * The API names the viewer's role in each workspace (`dashboard_role`, derived from
 * permissions on the server). Owners may preview the other two layouts with `?view=`; that
 * is a UI preview only — the data is still loaded with the owner's own access, and nobody
 * else can switch. Anyone else asking for `?view=` just gets their own layout.
 */
export type DashboardLayout = DashboardRole;

export const DASHBOARD_LAYOUTS: DashboardLayout[] = ["owner", "editor", "client"];
export const LAYOUT_LABELS: Record<DashboardLayout, string> = { owner: "Owner", editor: "Editor", client: "Client" };

export type LayoutChoice = {
  /** The viewer's own role in this workspace. */
  role: DashboardRole;
  /** What is rendered: the role, or the layout an owner is previewing. */
  layout: DashboardLayout;
  /** True when an owner is looking at another role's layout. */
  previewing: boolean;
  /** Only owners get the "View as" switch. */
  canSwitch: boolean;
};

const isLayout = (value: unknown): value is DashboardLayout =>
  typeof value === "string" && (DASHBOARD_LAYOUTS as string[]).includes(value);

/**
 * The viewer's role. An older backend sends no `dashboard_role`: then someone without a
 * membership of their own (in through a client team) is a client, everyone else an editor —
 * the safe default, since it never shows workspace-wide oversight to someone not entitled.
 */
export function roleFor(workspace: Pick<Workspace, "dashboard_role" | "my_membership_id">): DashboardRole {
  if (isLayout(workspace.dashboard_role)) return workspace.dashboard_role;
  return workspace.my_membership_id ? "editor" : "client";
}

export function chooseLayout(workspace: Pick<Workspace, "dashboard_role" | "my_membership_id">, requested: string | string[] | undefined): LayoutChoice {
  const role = roleFor(workspace);
  const canSwitch = role === "owner";
  const asked = Array.isArray(requested) ? requested[0] : requested;
  const layout = canSwitch && isLayout(asked) ? asked : role;
  return { role, layout, previewing: layout !== role, canSwitch };
}

/** The dashboard's address for a layout: the owner's own layout is plain `/`. */
export const viewAsHref = (layout: DashboardLayout) => (layout === "owner" ? "/" : `/?view=${layout}`);

/** What the preview banner says, so an owner never mistakes the preview for what others see. */
export function previewNotice(layout: DashboardLayout): string | null {
  if (layout === "editor") return "Previewing the editor dashboard with your own tasks, cuts and notes. Each editor sees theirs.";
  if (layout === "client") return "Previewing the client dashboard with every project you can see. A client sees only their own projects, and never tasks or team notes.";
  return null;
}
