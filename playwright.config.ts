import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

/**
 * End-to-end tests run against the PRODUCTION build on port 3100 with a throw-away data folder, so they never touch real data.
 * Run: npm run test:e2e   (builds first if needed). Set PW_CHROMIUM_PATH to use an already-installed Chromium.
 */
const dataDir = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "pfos-e2e-data");
process.env.E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // the specs share one database and run in file order
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1360, height: 1000 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      ...(process.env.PW_NO_SANDBOX === "1" ? { args: ["--no-sandbox"] } : {}), // needed only inside the network-less namespace (fake root)
    },
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:3100/api/health",
    timeout: 400_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_DATA_DIR: dataDir },
  },
});
