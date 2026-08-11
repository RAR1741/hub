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
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // specs share one DB; keep them serial
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
