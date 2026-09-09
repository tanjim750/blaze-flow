import { expect, type Page } from "@playwright/test";

export const credentialsAvailable = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}
