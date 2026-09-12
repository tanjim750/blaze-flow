import { expect, test } from "@playwright/test";
import { credentialsAvailable, signIn } from "./auth";

test.describe("authenticated review", () => {
  test.skip(!credentialsAvailable, "Set E2E_EMAIL and E2E_PASSWORD for an isolated test account.");
  test("opens the review workspace and annotation tools", async ({ page }) => {
    await signIn(page);
    await page.goto("/review");

    // The workspace only has a player when something has been uploaded to review. An
    // account seeded without media is not a failure of this page, so say so and stop.
    const blank = page.locator(".rv-blank");
    if (await blank.count()) test.skip(true, "The test workspace has no media to review.");

    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    for (const tool of ["point", "rectangle", "ellipse", "arrow", "freehand", "text"]) {
      await expect(page.getByRole("button", { name: `Draw ${tool}` })).toBeVisible();
    }
    await page.getByRole("button", { name: "Draw rectangle" }).click();
    await expect(page.getByRole("button", { name: "Draw rectangle" })).toHaveAttribute("aria-pressed", "true");

    // The details panel reads duration and resolution off the loaded file.
    await page.getByRole("tab", { name: "Fields" }).click();
    await expect(page.getByText("Version history")).toBeVisible();
  });
});
