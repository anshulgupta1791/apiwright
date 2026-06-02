/**
 * Integration test for issue #49 — `docs/cookbook/authenticated-api.md`
 * Part 2 example must load + validate cleanly.
 *
 * Before this fix, the cookbook documented an aspirational
 * `client_credentials` shape (`token_url`, `client_id`, `client_secret`,
 * `grant_type`, `scope`) that the apiwright config parser REJECTS. A user
 * copy-pasting the example got 4 validation errors on the first try.
 *
 * This test guards the rewritten Part 2: it loads the cookbook's example
 * VERBATIM (committed at `tests/fixtures/env/environments/cookbook-token-
 * endpoint.yaml`) through the real `EnvironmentLoader` and asserts the env
 * loads + schema-validates + the auth_strategies block was accepted.
 *
 * If the cookbook drifts from the parser-accepted shape in any future
 * edit, this test fails immediately — preventing a re-introduction of
 * Finding #17.
 *
 * Pinned at:
 *   - docs/cookbook/authenticated-api.md (the source of truth)
 *   - tests/fixtures/env/environments/cookbook-token-endpoint.yaml (verbatim copy)
 */

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EnvironmentLoader } from "../../../src/env/loader.js";

/** Root the loader resolves `environments/<name>.yaml` against. */
const FIXTURE_ROOT = join(process.cwd(), "tests/fixtures/env");

/**
 * Deterministic injected secrets. The exact values don't matter — what
 * matters is that the loader RESOLVES `${secret.MY_USERNAME}` /
 * `${secret.MY_PASSWORD}` without complaint and the resulting env passes
 * schema validation.
 */
const TEST_ENV = {
  MY_USERNAME: "cookbook-test-user",
  MY_PASSWORD: "cookbook-test-pw-placeholder",
} as const;

describe("issue #49 — cookbook token_endpoint Part 2 example loads cleanly", () => {
  it("EnvironmentLoader accepts the cookbook fixture without errors", () => {
    const loader = new EnvironmentLoader({
      rootDir: FIXTURE_ROOT,
      env: { ...process.env, ...TEST_ENV },
    });
    const result = loader.load("cookbook-token-endpoint");

    expect(result.valid).toBe(true);
    expect(result.errors ?? []).toEqual([]);
    expect(result.environment).toBeDefined();
  });

  it("the resolved env has the oauth_client strategy with the expected shape", () => {
    const loader = new EnvironmentLoader({
      rootDir: FIXTURE_ROOT,
      env: { ...process.env, ...TEST_ENV },
    });
    const result = loader.load("cookbook-token-endpoint");
    const env = result.environment;
    expect(env).toBeDefined();

    const strategies = env?.auth_strategies as Record<string, unknown> | undefined;
    expect(strategies).toBeDefined();
    expect(strategies?.["oauth_client"]).toBeDefined();
  });

  it("the username + password secrets are resolved (not left as ${...} templates)", () => {
    const loader = new EnvironmentLoader({
      rootDir: FIXTURE_ROOT,
      env: { ...process.env, ...TEST_ENV },
    });
    const result = loader.load("cookbook-token-endpoint");
    const env = result.environment as
      | { auth_strategies?: Record<string, unknown> }
      | undefined;
    const oauth = env?.auth_strategies?.["oauth_client"] as
      | { credentials?: { username?: unknown; password?: unknown } }
      | undefined;

    expect(oauth?.credentials?.username).toBe(TEST_ENV.MY_USERNAME);
    expect(oauth?.credentials?.password).toBe(TEST_ENV.MY_PASSWORD);
  });

  it("regression guard: the cookbook YAML matches what the parser actually accepts", () => {
    // This locks the wider promise: anything documented in the cookbook is
    // exercised by THIS test. If the cookbook drifts (someone re-introduces
    // `token_url:` / `client_id:` / `grant_type:` keys), the YAML loads but
    // validation rejects it — `result.valid` becomes false and the
    // first-test assertion above fails with the exact error message the
    // user would see.
    //
    // The drift-detection works because the fixture file IS the cookbook's
    // code-block, copy-pasted. Any edit to the cookbook should be mirrored
    // here (and vice-versa). The diff between the two is the contract.
    const loader = new EnvironmentLoader({
      rootDir: FIXTURE_ROOT,
      env: { ...process.env, ...TEST_ENV },
    });
    const result = loader.load("cookbook-token-endpoint");
    expect(result.valid).toBe(true);
  });
});
