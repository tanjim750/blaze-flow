import { choose } from "@/test/choose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const setMemberRate = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("@/components/money/billing-client", () => ({ setMemberRate: (...args: unknown[]) => setMemberRate(...args) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { GlossaryForm, InvoiceSettingsForm, RatesForm } from "./studio-settings";

afterEach(() => { cleanup(); api.mockReset(); setMemberRate.mockReset(); });

describe("InvoiceSettingsForm", () => {
  it("validates, then saves terms and prefix (currency lives in Billing & currency)", async () => {
    api.mockResolvedValue({ currency: "GBP", payment_terms_days: 30, invoice_prefix: "ACME" });
    render(<InvoiceSettingsForm workspaceId="w" initial={{ currency: "GBP", payment_terms_days: 14, invoice_prefix: "INV" }} canEdit />);
    expect(screen.queryByLabelText(/Currency/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Invoice prefix/), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Save invoicing/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/1–20 characters/);
    expect(api).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Payment terms/), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Invoice prefix/), { target: { value: "ACME" } });
    expect(screen.getByText("Numbers look like ACME-0001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save invoicing/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/settings/", "PATCH", { payment_terms_days: 30, invoice_prefix: "ACME" }));
  });
  it("is read-only without manage", () => {
    render(<InvoiceSettingsForm workspaceId="w" initial={{ currency: "GBP", payment_terms_days: 14, invoice_prefix: "INV" }} canEdit={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText(/Payment terms/)).toBeDisabled();
  });
});

describe("RatesForm", () => {
  it("saves a changed rate on blur and clears with an empty value", async () => {
    setMemberRate.mockResolvedValueOnce({ default_task_rate: "120.00" }).mockResolvedValueOnce({ default_task_rate: null });
    render(<RatesForm workspaceId="w" currency="GBP" canEdit rows={[{ membership_id: "m1", name: "Maya", email: "m@x.com", active: true, default_rate: null }, { membership_id: "m2", name: "Gone", email: null, active: false, default_rate: null }]} />);
    expect(screen.queryByText("Gone")).toBeNull();
    const input = screen.getByLabelText(/Default rate per task for Maya/);
    fireEvent.change(input, { target: { value: "120" } }); fireEvent.blur(input);
    await waitFor(() => expect(setMemberRate).toHaveBeenCalledWith("w", "m1", "120"));
    await waitFor(() => expect(input).toHaveValue("120.00"));
    fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
    await waitFor(() => expect(setMemberRate).toHaveBeenLastCalledWith("w", "m1", null));
  });
});

describe("GlossaryForm", () => {
  const term = { id: "t1", project_id: null, term: "BlazeFlow", normalized: "blazeflow", kind: "brand" as const, enabled: true, created_at: "" };
  it("adds a term, refuses duplicates and removes", async () => {
    api.mockResolvedValueOnce({ ...term, id: "t2", term: "NHS", normalized: "nhs", kind: "acronym" }).mockResolvedValueOnce(undefined);
    render(<GlossaryForm workspaceId="w" initial={[term]} canEdit />);
    fireEvent.change(screen.getByPlaceholderText(/e.g./), { target: { value: "blazeflow" } });
    fireEvent.click(screen.getByRole("button", { name: /Add term/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already/);
    fireEvent.change(screen.getByPlaceholderText(/e.g./), { target: { value: "NHS" } });
    choose(screen.getByLabelText("Kind"), /acronym/i);
    fireEvent.click(screen.getByRole("button", { name: /Add term/ }));
    expect(await screen.findByText("NHS")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("workspaces/w/ai-glossary/", "POST", { term: "NHS", kind: "acronym" });
    fireEvent.click(screen.getByRole("button", { name: "Remove BlazeFlow" }));
    await waitFor(() => expect(screen.queryByText("BlazeFlow")).toBeNull());
    expect(api).toHaveBeenLastCalledWith("workspaces/w/ai-glossary/t1/", "DELETE");
  });
});
