import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@/lib/app-router", () => ({ useAppRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/google-sign-in", () => ({ GoogleSignIn: () => <div data-testid="google" /> }));

import { SignInForm } from "./sign-in/form";
import { SignUpForm } from "./sign-up/form";
import ForgotPassword from "./forgot-password/page";
import { ResetPasswordForm } from "./reset-password/form";
import { PasswordField } from "@/components/auth/password-field";
import { parseFieldErrors, safeNext } from "@/lib/auth-client";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => push.mockReset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("PasswordField", () => {
  it("toggles visibility with an accessible button", () => {
    render(<PasswordField name="password" label="Password" autoComplete="current-password" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows a strength hint when metered", () => {
    render(<PasswordField name="password" label="Password" autoComplete="new-password" meter />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Tangerine-Kite-42" } });
    expect(screen.getByText(/Strong/)).toBeInTheDocument();
  });
});

describe("SignInForm", () => {
  it("validates before calling the API", async () => {
    const fetch = mockFetch(200, {});
    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows the server error and keeps autofill attributes", async () => {
    mockFetch(400, { non_field_errors: ["Invalid email or password."] });
    render(<SignInForm />);
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    fireEvent.change(email, { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope-nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });
  it("redirects to a safe next path on success", async () => {
    mockFetch(200, { id: "u", email: "a@b.co", csrf_token: "x" });
    render(<SignInForm next="/invite?token=abc" />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-enough" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/invite?token=abc"));
  });
  it("shows the signed-out notice", () => {
    render(<SignInForm signedOut />);
    expect(screen.getByRole("status")).toHaveTextContent("signed out");
  });
});

describe("SignUpForm", () => {
  it("maps field errors from the API onto fields", async () => {
    mockFetch(400, { email: ["An account with this email already exists."] });
    render(<SignUpForm />);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ada@x.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findAllByText(/already exists/)).not.toHaveLength(0);
    expect(screen.getByLabelText("Work email")).toHaveAttribute("aria-invalid", "true");
  });
  it("explains invite-only rejections", async () => {
    mockFetch(403, { detail: "Sign-up is invite-only right now.", code: "signup_closed" });
    render(<SignUpForm inviteOnly />);
    expect(screen.getByText(/Sign-up is invite-only. Use the email/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "L" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ada@x.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("invite-only");
    expect(alert.querySelector("a")).toHaveAttribute("href", "/sign-in");
  });
  it("locks the email to the invitation and sends the token", async () => {
    const fetch = mockFetch(400, { password: ["Too common."] });
    render(<SignUpForm inviteToken="tok" invite={{ kind: "workspace", state: "valid", workspace_name: "Acme", role_name: "Editor", email: "ed@acme.co", inviter_name: "Olive", expires_at: "2030-01-01T00:00:00Z" }} />);
    expect(screen.getByRole("heading", { name: "Join Acme" })).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ed" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "D" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account & join" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ email: "ed@acme.co", invite_token: "tok" });
  });
});

describe("ForgotPassword", () => {
  it("confirms without revealing accounts and rate-limits resend", async () => {
    mockFetch(202, { detail: "ok" });
    render(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    const resend = screen.getByRole("button", { name: /Resend in \d+s/ });
    expect(resend).toBeDisabled();
  });
});

describe("ResetPasswordForm", () => {
  it("requires matching passwords", async () => {
    render(<ResetPasswordForm token="t" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different-one" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update password" })); });
    expect(screen.getByText("Passwords don’t match.")).toBeInTheDocument();
  });
  it("offers a new link when the token expired", async () => {
    mockFetch(400, { detail: "This password-reset token is invalid or expired." });
    render(<ResetPasswordForm token="t" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Tangerine-Kite-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("This link has expired")).toBeInTheDocument();
  });
});

describe("auth-client helpers", () => {
  it("parses field errors and codes", () => {
    expect(parseFieldErrors('{"email":["Taken."],"detail":"x","code":"signup_closed"}')).toEqual({ fieldErrors: { email: "Taken." }, code: "signup_closed" });
  });
  it("only allows same-origin next paths", () => {
    expect(safeNext("/invite?token=1")).toBe("/invite?token=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
  });
});
