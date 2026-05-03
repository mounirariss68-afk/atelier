import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 22132);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @workspace/maven-ai run dev`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: "../..",
    env: { PORT: String(PORT), BASE_PATH: "/" },
    stdout: "ignore",
    stderr: "pipe",
  },
});
