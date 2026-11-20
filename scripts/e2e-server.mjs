// Starts the production server for the end-to-end tests with an empty, throw-away data folder.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "pfos-e2e-data");
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const next = path.join("node_modules", "next", "dist", "bin", "next");
// Always build, so the tests can never run against a stale build. E2E_SKIP_BUILD=1 reuses the current one (faster reruns).
if (process.env.E2E_SKIP_BUILD !== "1" || !fs.existsSync(path.join(".next", "BUILD_ID"))) {
  console.log("[e2e] building the production app…");
  const b = spawnSync(process.execPath, [next, "build"], { stdio: "inherit" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
console.log(`[e2e] starting on :3100 with data in ${dataDir}`);
const child = spawn(process.execPath, [next, "start", "-H", "localhost", "-p", "3100"], { stdio: "inherit", env: { ...process.env, FINANCE_DATA_DIR: dataDir } });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
