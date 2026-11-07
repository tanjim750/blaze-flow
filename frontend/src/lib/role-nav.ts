import type { DashboardRole, Workspace } from "./api";
import { roleFor } from "./dashboard-role";
import { isSolo } from "./plan";

/**
 * Who sees which part of the app.
 *
 * The sidebar and the route guards both read from here, so a link is never offered that
 * the guard would bounce, and a page hidden from the sidebar can't be reached by typing
 * its address. The API still enforces permissions on every request: this is the friendly
 * layer in front of that, not a replacement for it.
 */
export type NavIcon =
  | "home" | "analytics" | "projects" | "chat" | "tasks" | "files" | "clients" | "team" | "money"
  | "settings" | "help" | "approvals" | "requests"
  | "invoices" | "upload" | "pay";
/** Stable ids for the reorderable sidebar items (backend services/nav_order.py NAV_KEYS). */
export const NAV_KEYS = ["files", "projects", "tasks", "chat", "clients", "team", "money", "analytics"] as const;
export type NavKey = (typeof NAV_KEYS)[number];
export const DEFAULT_NAV_ORDER: NavKey[] = NAV_KEYS.filter((key) => key !== "files");
/** Names shown in the Settings reorder list. */
export const NAV_KEY_LABELS: Record<NavKey, string> = {
  files: "Files", projects: "Projects", tasks: "Tasks", chat: "Chat", clients: "Clients",
  team: "Team & Roles", money: "Money", analytics: "Analytics",
};

export type NavLink = { href: string; label: string; icon: NavIcon; key?: NavKey };
export type RoleNav = { role: DashboardRole; primary: NavLink[]; secondary: NavLink[] };

type Access = Pick<Workspace, "dashboard_role" | "my_membership_id" | "billing"> & Partial<Pick<Workspace, "plan" | "plan_features" | "nav_order">>;

/** A full, valid order: known keys from `stored` first (no repeats), then the rest in default order. */
export function effectiveNavOrder(stored: readonly string[] | null | undefined): NavKey[] {
  const seen: NavKey[] = [];
  for (const key of stored ?? []) if (key !== "files" && (NAV_KEYS as readonly string[]).includes(key) && !seen.includes(key as NavKey)) seen.push(key as NavKey);
  return [...seen, ...DEFAULT_NAV_ORDER.filter((key) => !seen.includes(key))];
}

/** Sorts links that have a key by the workspace order; links without a key keep their place at the end. */
export function sortNav(links: NavLink[], stored: readonly string[] | null | undefined): NavLink[] {
  const order = effectiveNavOrder(stored);
  const rank = (link: NavLink) => (link.key ? order.indexOf(link.key) : order.length);
  return links.map((link, index) => ({ link, index })).sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index).map(({ link }) => link);
}

/** Projects is the team home, regardless of a saved legacy sidebar order. */
export function landingFor(workspace: Access | null | undefined): string {
  return workspace && roleFor(workspace) === "client" ? "/" : "/projects";
}

export function navFor(workspace: Access | null | undefined): RoleNav {
  const role: DashboardRole = workspace ? roleFor(workspace) : "editor";
  const billing = workspace?.billing;
  if (role === "client") {
    return {
      role,
      primary: [
        { href: "/", label: "Home", icon: "home" },
        { href: "/#projects", label: "Projects", icon: "projects" },
        { href: "/#approvals", label: "Approvals", icon: "approvals" },
        { href: "/portal/chat", label: "Messages", icon: "chat" },
        { href: "/portal/requests", label: "Requests", icon: "requests" },
        { href: "/#invoices", label: "Invoices", icon: "invoices" },
        { href: "/#send-files", label: "Send files", icon: "upload" },
      ],
      secondary: [{ href: "/help", label: "Help", icon: "help" }],
    };
  }
  if (role === "editor") {
    const mine = workspace?.my_membership_id ? `/tasks?assignee=${workspace.my_membership_id}` : "/tasks";
    return {
      role,
      // Same workspace order as everyone else; "My work" is the editor's view of "/" (Analytics).
      primary: sortNav([
        { href: "/", label: "My work", icon: "home", key: "analytics" },
        { href: mine, label: "My tasks", icon: "tasks", key: "tasks" },
        { href: "/projects", label: "Projects", icon: "projects", key: "projects" },
        { href: "/chat", label: "Chat", icon: "chat", key: "chat" },
        // An editor whose role does include billing (rare, but a role can grant it) keeps Money.
        ...(billing?.view ? [{ href: "/money", label: "Money", icon: "money" as const, key: "money" as const }] : []),
        ...(billing?.rates_view ? [{ href: "/#earnings", label: "My pay", icon: "pay" as const }] : []),
      ], workspace?.nav_order),
      secondary: [
        { href: "/settings", label: "My profile", icon: "settings" },
        { href: "/help", label: "Help", icon: "help" },
      ],
    };
  }
  if (isSolo(workspace)) {
    // Solo is one person: no Team & Roles (the page itself shows the upgrade prompt if opened).
    return {
      role,
      primary: sortNav([
        { href: "/", label: "Analytics", icon: "analytics", key: "analytics" },
        { href: "/projects", label: "Projects", icon: "projects", key: "projects" },
        { href: "/tasks", label: "Tasks", icon: "tasks", key: "tasks" },
        { href: "/clients", label: "Clients", icon: "clients", key: "clients" },
        { href: "/chat", label: "Messages", icon: "chat", key: "chat" },
        ...(billing?.view ? [{ href: "/money", label: "Invoices", icon: "money" as const, key: "money" as const }] : []),
      ], workspace?.nav_order),
      secondary: [
        { href: "/settings/plan", label: "Plan", icon: "pay" },
        { href: "/settings", label: "Settings", icon: "settings" },
        { href: "/help", label: "Help", icon: "help" },
      ],
    };
  }
  return {
    role,
    // Role hiding first (Money needs billing.view), then the workspace order.
    primary: sortNav([
      { href: "/", label: "Analytics", icon: "analytics", key: "analytics" },
      { href: "/projects", label: "Projects", icon: "projects", key: "projects" },
      { href: "/chat", label: "Chat", icon: "chat", key: "chat" },
      { href: "/tasks", label: "Tasks", icon: "tasks", key: "tasks" },
      { href: "/clients", label: "Clients", icon: "clients", key: "clients" },
      { href: "/team", label: "Team & Roles", icon: "team", key: "team" },
      ...(billing?.view ? [{ href: "/money", label: "Money", icon: "money" as const, key: "money" as const }] : []),
    ], workspace?.nav_order),
    secondary: [
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/help", label: "Help", icon: "help" },
    ],
  };
}

/** Where a blocked visit lands instead, with the reason the dashboard shows. */
export type Redirect = { to: string; notice: string };

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Null when `path` is open to this viewer, otherwise where to send them. Clients get the
 * portal equivalent where one exists (chat → portal chat, client requests → their requests).
 */
export function guardFor(workspace: Access | null | undefined, path: string): Redirect | null {
  if (!workspace) return null;
  const role = roleFor(workspace);
  const billingView = Boolean(workspace.billing?.view);
  if (role === "owner") return null;
  if (under(path, "/money")) {
    // A client opens their own invoices from the dashboard; the API scopes them.
    if (role === "client" && under(path, "/money/invoices")) return null;
    if (billingView) return null;
    return { to: role === "editor" && workspace.billing?.rates_view ? "/#earnings" : "/", notice: role === "editor" ? "money-editor" : "money" };
  }
  if (under(path, "/clients")) return role === "client" ? { to: "/portal/requests", notice: "client-area" } : { to: "/", notice: "clients" };
  if (under(path, "/team")) return { to: "/", notice: "team" };
  if (role === "editor") return null;
  // Client from here on.
  if (under(path, "/chat")) return { to: "/portal/chat", notice: "client-area" };
  if (under(path, "/tasks")) return { to: "/", notice: "client-area" };
  if (under(path, "/projects")) return { to: "/#projects", notice: "client-area" };
  if (under(path, "/files")) return { to: "/#send-files", notice: "client-area" };
  if (under(path, "/render-queue")) return { to: "/", notice: "client-area" };
  if (under(path, "/settings")) return { to: "/", notice: "client-area" };
  return null;
}

/** What the dashboard says after a guard redirect, by `?notice=`. */
export const GUARD_NOTICES: Record<string, string> = {
  money: "Money is only for the studio's owners and admins.",
  "money-editor": "Studio money is for owners and admins. Your own pay is below.",
  clients: "The client list is managed by the studio's owners.",
  team: "Team & Roles is managed by the studio's owners.",
  "client-area": "That part of Krewsys is for the studio team. Everything for you is here.",
};

export function noticeFor(value: string | string[] | undefined): string | null {
  const key = Array.isArray(value) ? value[0] : value;
  return key ? GUARD_NOTICES[key] ?? null : null;
}
