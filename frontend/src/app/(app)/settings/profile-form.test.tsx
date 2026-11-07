import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateProfileAction } = vi.hoisted(() => ({ updateProfileAction: vi.fn(async () => ({ error: null, message: "Saved." })) }));
vi.mock("./actions", () => ({ updateProfileAction, changePasswordAction: vi.fn(), resendVerificationAction: vi.fn(), saveNotificationSettingAction: vi.fn(), saveWhatsAppSettingsAction: vi.fn(), updateNotificationsAction: vi.fn() }));

import { WorkspaceProfileForm } from "./forms";

afterEach(cleanup);

describe("WorkspaceProfileForm business name", () => {
  it("opts out of native validation and shows our inline error for a blank name", () => {
    const { container } = render(<WorkspaceProfileForm profile={null} workspaceName="" />);
    const form = container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    const input = container.querySelector('input[name="business_name"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert").textContent).toBe("Business name is required.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("business-name-error");
    expect(updateProfileAction).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Acme" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
