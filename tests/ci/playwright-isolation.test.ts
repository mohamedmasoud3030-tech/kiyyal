import { describe, expect, it } from 'vitest';

import playwrightConfig from '../../playwright.config.js';

describe('isolated browser E2E runner', () => {
  it('must serialize specs sharing the embedded Postgres directory and Next build output', () => {
    // The suites currently share /tmp/kayyal-pg-55433 and the .next output
    // directory across Playwright worker processes. Two workers can race
    // during initdb, stopServer(), and next build.
    expect(playwrightConfig.fullyParallel).toBe(false);
    expect(playwrightConfig.workers).toBe(1);
    expect(playwrightConfig.retries).toBe(0);
  });
});
