import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Real-Postgres suites deliberately bind one fixed local port and must not tear down another file's server.
    fileParallelism: false,
  },
});
