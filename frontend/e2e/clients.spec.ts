import { expect, test } from "@playwright/test";
import { credentialsAvailable, signIn } from "./auth";

test.describe("client administration", () => {
  test.skip(!credentialsAvailable, "Set E2E_EMAIL and E2E_PASSWORD for an isolated test account.");
  test("opens the client directory and create dialog", async ({ page }) => {
    await signIn(page); await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    const create = page.getByRole("button", { name: "New client" });
    await expect(create).toBeEnabled(); await create.click();
    await expect(page.getByRole("heading", { name: "Create client" })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
  });
});
