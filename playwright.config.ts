import { defineConfig } from '@playwright/test';

/**
 * Browser journeys are intentionally separate from Vitest's real-Postgres unit
 * suites. `tests/e2e/operator-journey.spec.ts` starts its isolated database and
 * Next server, so this config does not point at a shared deployment.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // All E2E specs currently share the embedded PostgreSQL port/directory and
  // the Next.js .next build output. Playwright workers are separate processes,
  // so serial test declarations alone do not prevent races across spec files.
  // Keep one worker until both resources are isolated per worker.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
