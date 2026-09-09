import { expect, test } from "@playwright/test";
import { credentialsAvailable, signIn } from "./auth";

test.describe("authenticated review", () => {
  test.skip(!credentialsAvailable, "Set E2E_EMAIL and E2E_PASSWORD for an isolated test account.");
  test("opens the review workspace and annotation tools", async ({ page }) => {
    await signIn(page); await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    for (const tool of ["point", "rectangle", "ellipse", "arrow", "path", "text"]) await expect(page.getByRole("button", { name: `Draw ${tool}` })).toBeVisible();
    await page.getByRole("button", { name: "Draw rectangle" }).click();
    await expect(page.getByRole("button", { name: "Draw rectangle" })).toHaveAttribute("aria-pressed", "true");
  });
});
