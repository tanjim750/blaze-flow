import { expect, test } from "@playwright/test";
import { credentialsAvailable, signIn } from "./auth";

test("only real text fields get a text caret", async ({ page }) => {
  await page.goto("/sign-in");
  const caret = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).caretColor);
  expect(await caret("h1, h2, p")).toBe("rgba(0, 0, 0, 0)");
  expect(await caret("input[type=email]")).not.toBe("rgba(0, 0, 0, 0)");
  // Hiding the caret must not cost text selection.
  expect(await page.locator("p").first().evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
});

test.describe("authenticated navigation feedback", () => {
  test.skip(!credentialsAvailable, "Set E2E_EMAIL and E2E_PASSWORD for an isolated test account.");
  test("a sidebar click shows a skeleton or the page at once, never a dead click", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await page.locator('nav[aria-label="Main navigation"] a', { hasText: "Team" }).first().click();
    // Within a frame or two either the route skeleton or the page itself is on screen.
    await expect(page.locator(".sk-body, .nav-progress, main h1").first()).toBeVisible({ timeout: 500 });
    await expect(page).toHaveURL(/\/team/);
  });
});
