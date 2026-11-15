import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run start:standalone",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    env: { DATABASE_URL: process.env.POLO_TEST_DATABASE_URL ?? "", PORT: "3107", HOSTNAME: "127.0.0.1" },
  },
});
