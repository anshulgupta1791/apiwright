import { defineConfig } from 'vitest/config';

/**
 * APIWright E2E (opt-in, live) Vitest configuration.
 *
 * Runs ONLY via `npm run test:e2e`. These suites hit real external services
 * (e.g. the Alpaca PAPER API) and are deliberately excluded from the gated
 * `npm test` (configs/vitest.config.ts excludes `tests/e2e/**`). No coverage
 * thresholds: E2E does not gate the 95% coverage budget. Suites self-skip
 * when their required credentials are absent, so this config is safe to run
 * with no secrets (everything skips, exit 0).
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['node_modules/**'],
    globals: false,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
