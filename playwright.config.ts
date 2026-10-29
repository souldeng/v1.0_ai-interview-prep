import { defineConfig, devices } from "@playwright/test";

const productionPreview = process.env.PLAYWRIGHT_PRODUCTION === "1";
const port = productionPreview ? 4175 : 4174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "narrow", use: { ...devices["Desktop Chrome"], viewport: { width: 800, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    // Artifact writes and builds must not reload an in-progress isolated test page.
    env: { DISABLE_HMR: "true" },
    command: productionPreview
      ? `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
