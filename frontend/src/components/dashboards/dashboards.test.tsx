import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { chooseLayout } from "@/lib/dashboard-role";
import type { ClientDashboard as ClientView, EditorDashboard as EditorView } from "@/lib/role-dashboard-view";
import { ClientDashboard } from "./client-dashboard";
import { EditorDashboard } from "./editor-dashboard";
import { ViewAsSwitch } from "./parts";

afterEach(cleanup);

const owner = { dashboard_role: "owner" as const, my_membership_id: "m1" };
const client = { dashboard_role: "client" as const, my_membership_id: null };

const clientView: ClientView = {
  layout: "client", greetingName: "Sam", workspaceName: "Studio", today: "Sat, Oct 3",
  strip: [{ label: "Your projects", value: 1 }, { label: "Waiting for your review", value: 1 }, { label: "Approved", value: 1 }],
  projects: [{ id: "p1", title: "Spring Launch", status: "Active", tone: "accent", due: "Due Oct 5", waiting: 1, href: "/projects?campaign=p1" }],
  waiting: [{ id: "m1", title: "Hero 30s", version: "V2", project: "Spring Launch", stage: "In Review", age: "1d ago", tone: "blue", href: "/review?media=f1", poster: null, createdAt: "" }],
  delivered: [{ id: "m2", title: "Bumper 6s", version: "V3", project: "Spring Launch", stage: "Approved", age: "1d ago", poster: null, href: "/review?media=f2", downloadable: true, downloadHref: "/api/x/download/" }],
  problems: { reviews: null },
};

const editorView: EditorView = {
  layout: "editor", greetingName: "Maya", workspaceName: "Studio", today: "Sat, Oct 3",
  strip: [{ label: "My tasks due today", value: 0 }],
  tasks: { overdue: [{ id: "t1", name: "Cut hero", project: "Spring", priority: "High", when: "2 days overdue", tone: "danger", href: "/tasks?task=t1" }], dueSoon: [], later: 2, undated: 0, total: 3 },
  membershipId: "m1",
  notes: [{ id: "n1", author: "Priya", initials: "P", avatarUrl: null, guest: false, text: "Pull saturation", cut: "Hero 30s · V2", project: "Spring", timecode: "00:05", age: "3h ago", replies: 1, team: true, href: "/review?media=f1&comment=n1&t=5200" }],
  notesTotal: 4, cuts: [], activity: [],
  problems: { tasks: null, notes: null, cuts: null, activity: null },
};

describe("View as switch", () => {
  it("links all three layouts and marks the current one and the owner's own", () => {
    render(<ViewAsSwitch choice={chooseLayout(owner, "editor")} />);
    const nav = screen.getByRole("navigation", { name: "View dashboard as" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/?view=editor", "/?view=client"]);
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("Editor");
    expect(links[0]).toHaveTextContent("Owner (you)");
  });
});

describe("client dashboard", () => {
  it("shows review work and projects, no switch, and nothing internal", () => {
    render(<ClientDashboard view={clientView} choice={chooseLayout(client, "owner")} />);
    expect(screen.getByRole("heading", { name: "Waiting for your review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open review: Hero 30s V2/ })).toHaveAttribute("href", "/review?media=f1");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/x/download/");
    expect(screen.queryByRole("navigation", { name: "View dashboard as" })).not.toBeInTheDocument();
    expect(screen.queryByText(/tasks?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workload|team only|notes to address/i)).not.toBeInTheDocument();
  });

  it("is the client portal: a send-files area per project and recent activity", () => {
    render(<ClientDashboard view={{
      ...clientView,
      problems: { reviews: null, activity: null },
      activity: [{ id: "a1", initials: "AM", avatarUrl: null, tone: "success", actor: "Alex Morgan", action: "uploaded 'Hero 30s' V2", detail: "1 hour ago · Spring Launch", href: "/review?project=p1" }],
      portal: {
        workspaceId: "w1", maxBytes: 2 * 1024 ** 3, accept: ["video/*"],
        projects: [{ id: "p1", name: "Spring Launch", status: "ACTIVE" }, { id: "p2", name: "Holiday Teaser", status: "DRAFT" }],
        recent: [{ id: "u1", project_id: "p1", project_file_id: "f1", folder_id: "d1", file_name: "brand-guide.pdf", mime_type: "application/pdf", size_bytes: 48 * 1024, kind: "document", status: "READY", removed: false, uploader_name: "Sam", uploader_email: "sam@client.example", via: "portal", upload_link_label: null, batch_id: "b1", created_at: "2026-10-03T10:00:00Z" }],
      },
    }} choice={chooseLayout(client, "owner")} />);
    expect(screen.getByRole("heading", { name: "Send files to the studio" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "For project" })).toHaveValue("p1");
    expect(screen.getByText("brand-guide.pdf")).toBeInTheDocument();
    expect(screen.getByText(/48 KB · Spring Launch/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alex Morgan uploaded 'Hero 30s' V2/ })).toHaveAttribute("href", "/review?project=p1");
  });

  it("leaves the send-files area out when the client cannot send anywhere", () => {
    render(<ClientDashboard view={clientView} choice={chooseLayout(client, "owner")} />);
    expect(screen.queryByRole("heading", { name: "Send files to the studio" })).not.toBeInTheDocument();
  });

  it("labels an owner's preview and offers the way back", () => {
    render(<ClientDashboard view={clientView} choice={chooseLayout(owner, "client")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Preview: Client dashboard.");
    expect(screen.getByRole("link", { name: "Back to your dashboard" })).toHaveAttribute("href", "/");
  });
});

describe("editor dashboard", () => {
  it("lists my overdue tasks and notes with a deep link to the timecode", () => {
    render(<EditorDashboard view={editorView} choice={chooseLayout({ dashboard_role: "editor", my_membership_id: "m1" }, undefined)} />);
    expect(screen.getByText("Cut hero")).toBeInTheDocument();
    expect(screen.getByText("Also open: 2 later")).toBeInTheDocument();
    const noteLink = screen.getByRole("link", { name: /Open note by Priya on Hero 30s · V2 at 00:05/ });
    expect(noteLink).toHaveAttribute("href", "/review?media=f1&comment=n1&t=5200");
    expect(within(noteLink).getByText("Team only")).toBeInTheDocument();
    expect(screen.getByText("4 unresolved on your cuts")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "View dashboard as" })).not.toBeInTheDocument();
  });
});
