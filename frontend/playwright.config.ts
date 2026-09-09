import { defineConfig, devices } from "@playwright/test";

const external = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: "./e2e", fullyParallel: false, retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: external ?? "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external ? undefined : { command: "npm run dev", url: "http://127.0.0.1:3000/sign-in", reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
