import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/onmic_e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    // The green screen and the door are one-handed, standing-up screens.
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: `node_modules/.bin/next start -p ${PORT}`,
    // A readiness probe that touches no data — the fixtures apply the schema.
    url: `http://127.0.0.1:${PORT}/admin/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL,
      ADMIN_PASSCODE: "test-passcode-9910",
      AUTH_SECRET: "0".repeat(48) + "abcdef",
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
    },
  },
});
