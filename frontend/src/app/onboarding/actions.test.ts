import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
const revalidatePath = vi.fn();
const api = { createWorkspace: vi.fn(), getCurrentUser: vi.fn(), listWorkspaces: vi.fn(), requestEmailVerification: vi.fn() };

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/lib/api", () => api);

const { createWorkspaceAction } = await import("./actions");

const form = (name: string) => { const data = new FormData(); data.set("name", name); data.set("timezone", "UTC"); return data; };
const initial = { error: null, message: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentUser.mockResolvedValue({ ok: true, data: { email: "j@example.com", email_verified_at: "2026-10-30T11:03:49Z" } });
});

describe("createWorkspaceAction", () => {
  it("selects the new workspace and refreshes the app shell before redirecting", async () => {
    api.createWorkspace.mockResolvedValue({ ok: true, data: { id: "ws-new", name: "Jacobie" } });
    await expect(createWorkspaceAction(initial, form("Jacobie"))).rejects.toThrow("REDIRECT:/");
    expect(jar.set).toHaveBeenCalledWith("blazeflow_workspace", "ws-new", expect.objectContaining({ path: "/", httpOnly: true }));
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(redirect.mock.invocationCallOrder[0]);
  });

  it("takes a repeated submit into the workspace the first submit already made", async () => {
    api.createWorkspace.mockResolvedValue({ ok: false, error: { status: 400, detail: "The FREE plan allows up to 1 owned workspace(s). Upgrade to create another." } });
    api.listWorkspaces.mockResolvedValue({ ok: true, data: [{ id: "ws-made", name: "Jacobie", created_at: new Date().toISOString() }] });
    await expect(createWorkspaceAction(initial, form("Jacobie"))).rejects.toThrow("REDIRECT:/");
    expect(jar.set).toHaveBeenCalledWith("blazeflow_workspace", "ws-made", expect.anything());
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("still reports a real failure", async () => {
    api.createWorkspace.mockResolvedValue({ ok: false, error: { status: 400, detail: "This workspace slug is already in use." } });
    api.listWorkspaces.mockResolvedValue({ ok: true, data: [{ id: "old", name: "Jacobie", created_at: "2025-01-01T00:00:00Z" }] });
    await expect(createWorkspaceAction(initial, form("Jacobie"))).resolves.toEqual({ error: "This workspace slug is already in use.", message: null });
    expect(jar.set).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
