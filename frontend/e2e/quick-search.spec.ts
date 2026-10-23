import { expect, test } from "@playwright/test";
import { credentialsAvailable, signIn } from "./auth";

test.describe("⌘K quick search", () => {
  test.skip(!credentialsAvailable, "Set E2E_EMAIL and E2E_PASSWORD for an isolated test account.");
  test("opens with Ctrl+K, shows quick actions, and closes with Escape", async ({ page }) => {
    await signIn(page);
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: "Quick search" });
    await expect(input).toBeFocused();
    await expect(page.locator(".qs-heading", { hasText: "Quick actions" })).toBeVisible();
    await input.fill("zzzz-no-such-thing");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
  });
});
