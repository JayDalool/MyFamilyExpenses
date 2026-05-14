import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
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
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
