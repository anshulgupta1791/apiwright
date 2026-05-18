import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import { SchemaValidator } from "../../../src/core/schema-validator.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { EnvironmentLoader } from "../../../src/env/loader.js";
import { JsonSchemaInferrer } from "../../../src/importers/postman/schema-infer.js";

/**
 * HERMETIC integration test for the Alpaca paper-trading wiring.
 *
 * No network, no real credentials, runs in the gated suite on every push.
 * It exercises the SHIPPED pipeline against the Alpaca contract:
 *   1. EnvironmentLoader reads the alpaca-paper fixture env and resolves
 *      `${secret.*}` from an INJECTED env map (deterministic, no process.env
 *      dependence) and schema-validates it.
 *   2. Representative recorded Alpaca responses (tests/fixtures/alpaca/*)
 *      round-trip through JsonSchemaInferrer + SchemaValidator — the same
 *      schema engine the importers use.
 *
 * The recorded fixtures are hand-authored to Alpaca's documented Trading
 * API v2 shapes. The opt-in live E2E suite (configs/vitest.e2e.config.ts,
 * `npm run test:e2e`) re-fetches the real paper API and asserts the live
 * shape still matches these fixtures — that is the drift guard that keeps
 * these representative fixtures honest without putting network in the gate.
 */

/** Root the EnvironmentLoader resolves `environments/<name>.yaml` against. */
const FIXTURE_ROOT = join(process.cwd(), "tests/fixtures/env");

/** Directory holding the recorded representative Alpaca responses. */
const ALPACA_FIXTURE_DIR = join(process.cwd(), "tests/fixtures/alpaca");

/**
 * Injected, obviously-fake credentials — proves `${secret.*}` resolution
 * without reading the real process environment.
 */
const TEST_ENV = {
  ALPACA_KEY_ID: "pk_test_integration_only",
  ALPACA_SECRET_KEY: "sk_test_integration_only",
} as const;

/** Narrowed shape of the custom `alpaca` block in the fixture env. */
interface AlpacaCreds {
  /** Resolved Alpaca API key id. */
  key_id: string;
  /** Resolved Alpaca API secret key. */
  secret_key: string;
}

/**
 * Loads the alpaca-paper fixture env with `${secret.*}` resolved from an
 * injected env map (hermetic; never touches the real process environment).
 * @returns The resolved environment.
 * @throws {Error} When the environment fails to load or schema-validate.
 */
function loadEnvHermetic(): ResolvedEnvironment {
  const loader = new EnvironmentLoader({
    rootDir: FIXTURE_ROOT,
    env: { ...TEST_ENV },
  });
  const result = loader.load("alpaca-paper");
  if (!result.valid || !result.environment) {
    throw new Error(
      `alpaca-paper env failed to load: ${(result.errors ?? []).join("; ")}`,
    );
  }
  return result.environment;
}

/**
 * Reads a recorded Alpaca response fixture as parsed JSON.
 * @param name - Fixture base name (e.g. "clock").
 * @returns The parsed JSON value.
 * @throws {Error} When the fixture is missing or not valid JSON.
 */
function readFixture(name: string): unknown {
  const raw = readFileSync(join(ALPACA_FIXTURE_DIR, `${name}.json`), "utf8");
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    throw new Error(`fixture ${name}.json is not valid JSON: ${parsed.error}`);
  }
  return parsed.value;
}

/**
 * Asserts a body round-trips through the shipped schema engine: a schema
 * inferred from it must validate it (the importers' response contract).
 * @param body - The response body to round-trip.
 */
function expectSchemaRoundTrip(body: unknown): void {
  const schema = new JsonSchemaInferrer().infer(body);
  expect(new SchemaValidator().validateResponseBody(schema, body)).toBe(true);
}

describe("Alpaca paper env + schema engine (hermetic integration)", () => {
  it("resolves ${secret.*} creds + base_url from an injected env", () => {
    const env = loadEnvHermetic();
    expect(env.base_url).toBe("https://paper-api.alpaca.markets");
    expect(env.prod).toBe(false);
    const creds = env["alpaca"] as AlpacaCreds;
    expect(creds.key_id).toBe(TEST_ENV.ALPACA_KEY_ID);
    expect(creds.secret_key).toBe(TEST_ENV.ALPACA_SECRET_KEY);
  });

  it("does not leak literal credentials into the committed fixture", () => {
    const raw = readFileSync(
      join(FIXTURE_ROOT, "environments/alpaca-paper.yaml"),
      "utf8",
    );
    expect(raw).toContain("${secret.ALPACA_KEY_ID}");
    expect(raw).toContain("${secret.ALPACA_SECRET_KEY}");
    expect(raw).not.toContain(TEST_ENV.ALPACA_KEY_ID);
    expect(raw).not.toContain(TEST_ENV.ALPACA_SECRET_KEY);
  });

  describe("recorded responses round-trip through the importer schema engine", () => {
    it("/v2/clock fixture is contract-shaped and round-trips", () => {
      const body = readFixture("clock") as Record<string, unknown>;
      expect(typeof body["is_open"]).toBe("boolean");
      expect(typeof body["timestamp"]).toBe("string");
      expect(typeof body["next_open"]).toBe("string");
      expect(typeof body["next_close"]).toBe("string");
      expectSchemaRoundTrip(body);
    });

    it("/v2/account fixture is contract-shaped and round-trips", () => {
      const body = readFixture("account") as Record<string, unknown>;
      expect(typeof body["status"]).toBe("string");
      expect(typeof body["currency"]).toBe("string");
      expect(typeof body["buying_power"]).toBe("string");
      expect(typeof body["pattern_day_trader"]).toBe("boolean");
      expectSchemaRoundTrip(body);
    });

    it("/v2/assets/AAPL fixture is contract-shaped and round-trips", () => {
      const body = readFixture("asset-aapl") as Record<string, unknown>;
      expect(body["symbol"]).toBe("AAPL");
      expect(typeof body["tradable"]).toBe("boolean");
      expect(typeof body["exchange"]).toBe("string");
      expectSchemaRoundTrip(body);
    });
  });
});
