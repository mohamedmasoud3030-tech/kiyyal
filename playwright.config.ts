import { defineConfig } from '@playwright/test';

/**
 * Browser journeys are intentionally separate from Vitest's real-Postgres unit
 * suites. `tests/e2e/operator-journey.spec.ts` starts its isolated database and
 * Next server, so this config does not point at a shared deployment.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
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
