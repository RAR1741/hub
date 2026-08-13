import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Load local env for the Playwright process itself (the dev server loads its
// own via Next.js). dotenv does NOT override already-set process.env vars, so
// in CI (no .env.local/.env present, and env already provided by the workflow)
// this is a harmless no-op.
for (const file of [".env.local", ".env"]) {
  const filePath = path.resolve(__dirname, file);
  if (existsSync(filePath)) dotenv.config({ path: filePath });
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // specs share one DB; keep them serial
  // `fullyParallel: false` only serializes tests *within* a file — without
  // pinning workers, Playwright still runs multiple spec *files*
  // concurrently (one per worker), which is exactly what the comment above
  // says not to do: specs share one DB, and concurrent workers are also
  // what turns the local dev server's lazy per-route compile into a flake
  // (whichever spec's first hit on a given route loses the race against
  // the 30s test timeout). Force a single worker so runs are fully serial,
  // both for DB safety and for determinism against the dev server.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
