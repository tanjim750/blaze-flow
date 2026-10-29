import { describe, expect, it } from "vitest";
import { currentOption, hasFeature, isSolo, planOptions } from "./plan";
import { guardFor, navFor } from "./role-nav";
import { buildSoloDashboard, buildSoloMoney } from "./solo-dashboard-view";
import type { MoneySummary } from "./money-view";

const solo = { dashboard_role: "owner" as const, my_membership_id: "m0", billing: { view: true, manage: true, rates_view: true }, plan: "SOLO" as const, plan_features: [] };

describe("plan helpers", () => {
  it("detects Solo and its missing features", () => {
    expect(isSolo(solo)).toBe(true);
    expect(isSolo({ plan: "PRO" })).toBe(false);
    for (const f of ["ai_qa", "team_members", "editor_payouts"] as const) expect(hasFeature(solo, f)).toBe(false);
    expect(hasFeature({ plan: "PRO", plan_features: ["ai_qa", "team_members", "editor_payouts"] }, "ai_qa")).toBe(true);
    expect(hasFeature({}, "team_members")).toBe(true); // older API without features: never lock
  });
  it("lists Solo first at 5.99 and the studio tiers as PRO", () => {
    const options = planOptions();
    expect(options[0]).toMatchObject({ id: "solo", monthly: 5.99, backend: "SOLO" });
    expect(options.slice(1).every((o) => o.backend === "PRO")).toBe(true);
    expect(currentOption("SOLO")).toBe("solo");
    expect(currentOption("PRO")).toBe("starter");
    expect(currentOption("FREE")).toBeNull();
  });
});

describe("Solo sidebar", () => {
  it("is trimmed: no team, keeps clients, invoices and plan", () => {
    const n = navFor(solo);
    const labels = [...n.primary, ...n.secondary].map((l) => l.label);
    expect(labels).not.toContain("Team & Roles");
    for (const l of ["Home", "Projects", "Tasks", "Clients", "Invoices", "Plan", "Settings"]) expect(labels).toContain(l);
    for (const link of [...n.primary, ...n.secondary]) expect(guardFor(solo, link.href.split(/[?#]/)[0])).toBeNull();
  });
});

const now = new Date(2026, 9, 29, 12);
const money = {
  currency: "USD", totals: { clients_owe: "300.00", overdue: "100.00" }, receivables: [], access: {},
  invoices: [
    { currency: "USD", status: "sent", display_status: "overdue", outstanding: "100.00", paid: "0.00", paid_at: null },
    { currency: "USD", status: "sent", display_status: "sent", outstanding: "200.00", paid: "50.00", paid_at: "2026-10-10T10:00:00Z" },
    { currency: "USD", status: "paid", display_status: "paid", outstanding: "0.00", paid: "80.00", paid_at: "2026-09-10T10:00:00Z" },
    { currency: "USD", status: "draft", display_status: "draft", outstanding: "40.00", paid: "0.00", paid_at: null },
  ],
} as unknown as MoneySummary;

describe("Solo dashboard", () => {
  it("money snapshot: unpaid, paid this month, overdue", () => {
    expect(buildSoloMoney(money, now)).toEqual({ currency: "USD", unpaid: "300.00", unpaidCount: 2, paidThisMonth: "50.00", overdue: "100.00", overdueCount: 1 });
  });
  it("splits today's and overdue tasks and writes a headline", () => {
    const task = (id: string, due: string | null, status = "IN_PROGRESS") => ({ id, title: id, status, due_at: due, project_id: "p1" });
    const view = buildSoloDashboard({
      greetingName: "Sam", now, workspace: { name: "Sam Edits" },
      projects: [{ id: "p1", name: "Promo", status: "ACTIVE", due_at: null, client_team_id: null }] as never,
      tasks: [task("late", "2026-10-27T10:00:00"), task("today", "2026-10-29T17:00:00"), task("done", "2026-10-27T10:00:00", "COMPLETED"), task("later", "2026-11-05T10:00:00")] as never,
      clients: [], files: [], stages: [], notes: { results: [] }, activity: [], money,
    });
    expect(view.tasks.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(view.tasks.today.map((t) => t.id)).toEqual(["today"]);
    expect(view.projects).toHaveLength(1);
    expect(view.projects[0].openTasks).toBe(3);
    expect(view.headline).toBe("You have 1 overdue task, 1 due today.");
    expect(view.money?.unpaid).toBe("300.00");
  });
  it("reports a failed section without breaking the rest", () => {
    const view = buildSoloDashboard({
      greetingName: "Sam", now, workspace: { name: "W" }, projects: [], tasks: { status: 500, detail: "boom" } as never,
      clients: [], files: [], stages: [], notes: { results: [] }, activity: [], money: null,
    });
    expect(view.problems.tasks).toContain("boom");
    expect(view.headline).toMatch(/caught up/);
  });
});
