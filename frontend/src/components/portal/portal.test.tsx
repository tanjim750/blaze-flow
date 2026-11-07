import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();

import { ProjectRequestForm } from "./request-form";
import { RequestInbox } from "./request-inbox";
import { PortalBrandBar } from "./brand-bar";
import type { ProjectRequest } from "@/lib/portal";

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const request = (extra: Partial<ProjectRequest> = {}): ProjectRequest => ({
  id: "r1", title: "Summer menu launch", status: "pending", client_team: { id: "t1", name: "Northlight Coffee" },
  requester_name: "Sam Lee", requester_email: "sam@client.example", deliverables: [{ kind: "hero_film", quantity: 1 }, { kind: "social_cutdown", quantity: 3 }],
  platform: "Instagram", aspect_ratio: "9:16", target_length_seconds: 30, brief: "Three new cold brews.", references: "",
  wanted_by: "2026-11-01", budget_range: "5k_10k", decision_note: "", decided_at: null, decided_by_name: null, project_id: null,
  created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...extra,
});

describe("brand bar", () => {
  it("shows the logo when there is one, else a monogram, and the welcome line", () => {
    const { rerender } = render(<PortalBrandBar branding={{ studio_name: "Blackfen Studio Ltd", brand_color: "#2FCB9A", logo_url: "/api/public/studios/w/logo/?v=1", portal_welcome: "Hello" }} />);
    expect(screen.getByRole("img", { name: "Blackfen Studio Ltd logo" })).toHaveAttribute("src", "/api/public/studios/w/logo/?v=1");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    rerender(<PortalBrandBar branding={{ studio_name: "Blackfen Studio Ltd", brand_color: null, logo_url: null, portal_welcome: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("BL")).toBeInTheDocument();
  });
});

describe("project request form", () => {
  const renderForm = () => render(<ProjectRequestForm workspaceId="w1" studioName="Blackfen" clientTeams={[{ id: "t1", name: "Northlight" }]} today="2026-10-04" />);

  it("shows what is missing and sends nothing until it is fixed", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));
    expect(await screen.findByText("Give the project a working title.")).toBeInTheDocument();
    expect(screen.getByText("Pick at least one thing you would like made.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the brief with quantities and shows the confirmation", async () => {
    fetchMock.mockReturnValueOnce(ok({ ...request(), title: "Summer" }, 201));
    renderForm();
    fireEvent.change(screen.getByLabelText("Working title"), { target: { value: "Summer" } });
    fireEvent.click(screen.getByLabelText(/Social cut-down/));
    fireEvent.click(screen.getByRole("button", { name: "More Social cut-down" }));
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    fireEvent.change(screen.getByLabelText(/^Brief/), { target: { value: "Three cold brews for summer, bright and outdoorsy." } });
    expect(within(screen.getByRole("complementary", { name: "Request summary" })).getByText("2 Social cut-downs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));
    await screen.findByText(/Blackfen has your request/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces/w1/project-requests/");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ client_team_id: "t1", title: "Summer", deliverables: [{ kind: "social_cutdown", quantity: 2 }], platform: "Instagram" });
  });
});

describe("request inbox", () => {
  it("accepts with a project name and declines only with a note", async () => {
    fetchMock.mockReturnValue(ok(request({ status: "accepted", project_id: "p9" })));
    render(<RequestInbox workspaceId="w1" requests={[request(), request({ id: "r2", title: "Old one", status: "declined", decision_note: "Booked" })]} />);
    expect(screen.queryByText("Old one")).not.toBeInTheDocument();
    expect(screen.getByText("1 Hero film + 3 Social cut-downs")).toBeInTheDocument();
    expect(screen.getByText(/sam@client.example/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Send decline" }));
    expect(await screen.findByText("Add a short note so the client knows why.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: /Accept and open project/ }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Summer 2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Open draft project" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces/w1/project-requests/r1/");
    expect(JSON.parse(init.body)).toEqual({ action: "accept", note: "", name: "Summer 2027" });

    fireEvent.click(screen.getByRole("button", { name: /^Declined/ }));
    expect(screen.getByText("Old one")).toBeInTheDocument();
  });
});
