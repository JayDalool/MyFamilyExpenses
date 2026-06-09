import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "\"C:\\Program Files\\nodejs\\npm.cmd\" run dev -- --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: "development",
      GOOGLE_OAUTH_ENABLED: "false",
      MICROSOFT_OAUTH_ENABLED: "false",
      APP_BASE_URL: "http://localhost:3001",
      SESSION_SECRET: "playwright-session-secret-32-characters-minimum",
      DEV_SHOW_VERIFICATION_LINKS: "true",
      ...(process.env.TEST_DATABASE_URL
        ? { DATABASE_URL: process.env.TEST_DATABASE_URL }
        : {}),
    },
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      grep: /@mobile/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
