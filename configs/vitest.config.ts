import { defineConfig } from 'vitest/config';

/**
 * APIWright Vitest configuration.
 *
 * Enforces strict 95% coverage thresholds for branches, functions, lines,
 * and statements. Coverage gating is checked both locally (pre-commit hook)
 * and in CI (security-gate.yml). Any drop below 95% on any metric blocks
 * the commit and the PR merge.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globals: false,
    environment: 'node',

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts', 'src/**/interface.ts', 'src/cli/entry.ts'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
        autoUpdate: false,
      },
      reportOnFailure: true,
    },

    testTimeout: 10_000,
    hookTimeout: 30_000,
  },

  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
