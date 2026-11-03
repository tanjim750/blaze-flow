import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_ORDER, effectiveNavOrder, guardFor, landingFor, navFor, noticeFor, sortNav } from "./role-nav";

const owner = { dashboard_role: "owner" as const, my_membership_id: "m0", billing: { view: true, manage: true, rates_view: true } };
const editor = { dashboard_role: "editor" as const, my_membership_id: "m1", billing: { view: false, manage: false, rates_view: true } };
const client = { dashboard_role: "client" as const, my_membership_id: null, billing: { view: false, manage: false, rates_view: false } };
const labels = (w: Parameters<typeof navFor>[0]) => { const n = navFor(w); return [...n.primary, ...n.secondary].map((l) => l.label); };

describe("role sidebars", () => {
  it("owners keep the whole studio", () => {
    expect(labels(owner)).toEqual(["Files", "Projects", "Tasks", "Chat", "Clients", "Team & Roles", "Money", "Analytics", "Settings", "Help"]);
    const analytics = navFor(owner).primary.find((l) => l.label === "Analytics");
    expect(analytics).toMatchObject({ href: "/", icon: "analytics", key: "analytics" });
  });
  it("editors get their own work, their pay, and no studio admin", () => {
    const l = labels(editor);
    expect(l).toEqual(["Files", "Projects", "My tasks", "Chat", "My work", "My pay", "My profile", "Help"]);
    expect(navFor(editor).primary[2].href).toBe("/tasks?assignee=m1");
    expect(labels({ ...editor, billing: { view: false, manage: false, rates_view: false } })).not.toContain("My pay");
  });
  it("clients get the portal and nothing internal", () => {
    const l = labels(client);
    expect(l).toEqual(["Home", "Projects", "Approvals", "Messages", "Requests", "Invoices", "Send files", "Help"]);
    for (const hidden of ["Tasks", "Team & Roles", "Clients", "Money", "Render Queue", "Deliverables", "Settings", "Files", "Chat"]) expect(l).not.toContain(hidden);
  });
  it("every sidebar link passes its own route guard", () => {
    for (const w of [owner, editor, client]) {
      for (const link of [...navFor(w).primary, ...navFor(w).secondary]) expect(guardFor(w, link.href.split(/[?#]/)[0])).toBeNull();
    }
  });
});

describe("route guards", () => {
  it("never bounce an owner", () => {
    for (const path of ["/money", "/team", "/clients", "/settings", "/tasks"]) expect(guardFor(owner, path)).toBeNull();
  });
  it("send editors from studio admin to their dashboard", () => {
    expect(guardFor(editor, "/team")).toEqual({ to: "/", notice: "team" });
    expect(guardFor(editor, "/clients/requests")).toEqual({ to: "/", notice: "clients" });
    expect(guardFor(editor, "/money")).toEqual({ to: "/#earnings", notice: "money-editor" });
    expect(guardFor({ ...editor, billing: { view: true, manage: false, rates_view: true } }, "/money")).toBeNull();
    expect(guardFor(editor, "/tasks")).toBeNull();
  });
  it("send clients to the portal equivalent, but let them open their invoices", () => {
    expect(guardFor(client, "/chat")).toEqual({ to: "/portal/chat", notice: "client-area" });
    expect(guardFor(client, "/tasks")?.to).toBe("/");
    expect(guardFor(client, "/files")?.to).toBe("/#send-files");
    expect(guardFor(client, "/money/invoices/abc")).toBeNull();
    expect(guardFor(client, "/money")?.to).toBe("/");
  });
  it("only known notices are shown", () => {
    expect(noticeFor("team")).toContain("Team & Roles");
    expect(noticeFor("<script>")).toBeNull();
  });
});

describe("workspace sidebar order", () => {
  const custom = ["analytics", "chat", "files", "projects", "tasks", "clients", "team", "money"];
  it("defaults to Files first and lands there after sign-in", () => {
    expect(DEFAULT_NAV_ORDER[0]).toBe("files");
    expect(landingFor(owner)).toBe("/files");
    expect(landingFor(editor)).toBe("/files");
  });
  it("applies the owner's order to every team role, keeping role hiding", () => {
    expect(navFor({ ...owner, nav_order: custom }).primary.map((l) => l.label)).toEqual(["Analytics", "Chat", "Files", "Projects", "Tasks", "Clients", "Team & Roles", "Money"]);
    expect(navFor({ ...owner, nav_order: custom, billing: { view: false, manage: false, rates_view: false } }).primary.map((l) => l.label)).not.toContain("Money");
    expect(navFor({ ...editor, nav_order: custom }).primary.map((l) => l.label)).toEqual(["My work", "Chat", "Files", "Projects", "My tasks", "My pay"]);
    expect(landingFor({ ...owner, nav_order: custom })).toBe("/");
  });
  it("leaves the client portal menu alone", () => {
    expect(navFor({ ...client, nav_order: custom }).primary).toEqual(navFor(client).primary);
  });
  it("ignores unknown or repeated keys and appends missing ones", () => {
    expect(effectiveNavOrder(["money", "bogus", "money"])).toEqual(["money", ...DEFAULT_NAV_ORDER.filter((k) => k !== "money")]);
    expect(effectiveNavOrder(undefined)).toEqual(DEFAULT_NAV_ORDER);
    expect(sortNav([{ href: "/x", label: "X", icon: "help" }, { href: "/files", label: "Files", icon: "files", key: "files" }], [])[0].label).toBe("Files");
  });
});
