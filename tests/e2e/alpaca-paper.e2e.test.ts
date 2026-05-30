import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson } from "../../src/core/safe-json.js";
import { SchemaValidator } from "../../src/core/schema-validator.js";
import type { ResolvedEnvironment } from "../../src/env/index.js";
import { EnvironmentLoader } from "../../src/env/loader.js";
import { JsonSchemaInferrer } from "../../src/importers/postman/schema-infer.js";

/**
 * OPT-IN LIVE E2E test against the real Alpaca PAPER trading API.
 *
 * NOT part of the gated suite: it lives under tests/e2e/** (excluded by
 * configs/vitest.config.ts) and only runs via `npm run test:e2e`. It is
 * skipped automatically unless BOTH `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY`
 * are set in the process environment (PAPER keys only), so CI, fork PRs,
 * and the merge gate never make a network call or need secrets.
 *
 * It exercises the shipped env/secret-resolution + schema engine against
 * the live paper API, and asserts the live response still matches the
 * committed recorded fixtures (tests/fixtures/alpaca/*) — the drift guard
 * that keeps the hermetic integration test's fixtures honest.
 *
 * Read-only, non-mutating endpoints only (clock/account/asset). No orders;
 * the live-trading base URL is never used. The full product E2E (APIWright's
 * own Test Runner executing a declared suite) is deferred to Phase 10, when
 * the Test Runner (§9) exists.
 */

const KEY_ID = process.env["ALPACA_KEY_ID"];
const SECRET_KEY = process.env["ALPACA_SECRET_KEY"];
const NO_CREDS = !KEY_ID || !SECRET_KEY;

/** Root the EnvironmentLoader resolves `environments/<name>.yaml` against. */
const FIXTURE_ROOT = join(process.cwd(), "tests/fixtures/env");

/** Directory holding the recorded representative Alpaca responses. */
const ALPACA_FIXTURE_DIR = join(process.cwd(), "tests/fixtures/alpaca");

/** Per-test timeout: a real network round-trip can exceed the default. */
const NET_TIMEOUT_MS = 20_000;

/** Narrowed shape of the custom `alpaca` block in the fixture env. */
interface AlpacaCreds {
  /** Resolved Alpaca API key id. */
  key_id: string;
  /** Resolved Alpaca API secret key. */
  secret_key: string;
}

/**
 * Loads the alpaca-paper fixture env with `${secret.*}` resolved from the
 * real process environment (live opt-in path).
 * @returns The resolved environment.
 * @throws {Error} When the environment fails to load or schema-validate.
 */
function loadEnv(): ResolvedEnvironment {
  const loader = new EnvironmentLoader({ rootDir: FIXTURE_ROOT });
  const result = loader.load("alpaca-paper");
  if (!result.valid || !result.environment) {
    throw new Error(
      `alpaca-paper env failed to load: ${(result.errors ?? []).join("; ")}`,
    );
  }
  return result.environment;
}

/**
 * Performs an authenticated GET against the resolved Alpaca paper base URL.
 * @param env - The resolved environment carrying base_url + creds.
 * @param path - The API path (e.g. "/v2/clock").
 * @returns The HTTP status and parsed JSON body (undefined if not JSON).
 */
async function alpacaGet(
  env: ResolvedEnvironment,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const creds = env["alpaca"] as AlpacaCreds;
  const res = await fetch(`${env.base_url}${path}`, {
    headers: {
      "APCA-API-KEY-ID": creds.key_id,
      "APCA-API-SECRET-KEY": creds.secret_key,
    },
  });
  const parsed = parseJson(await res.text());
  return { status: res.status, body: parsed.ok ? parsed.value : undefined };
}

/**
 * Asserts a live body round-trips through the shipped schema engine.
 * @param body - The live response body.
 */
function expectSchemaRoundTrip(body: unknown): void {
  const schema = new JsonSchemaInferrer().infer(body);
  expect(new SchemaValidator().validateResponseBody(schema, body)).toBe(true);
}

/**
 * Drift guard: every key in the recorded fixture must be present in the
 * live body with the same primitive `typeof`. Live may add fields; it must
 * not drop or retype the ones the hermetic integration test relies on.
 * @param live - The live response body.
 * @param fixtureName - Recorded fixture base name (e.g. "clock").
 * @throws {Error} When the fixture is missing or not valid JSON.
 */
function expectMatchesRecorded(live: unknown, fixtureName: string): void {
  const raw = readFileSync(
    join(ALPACA_FIXTURE_DIR, `${fixtureName}.json`),
    "utf8",
  );
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    throw new Error(`fixture ${fixtureName}.json invalid: ${parsed.error}`);
  }
  const recorded = parsed.value as Record<string, unknown>;
  const liveObj = live as Record<string, unknown>;
  for (const key of Object.keys(recorded)) {
    expect(typeof liveObj[key]).toBe(typeof recorded[key]);
  }
}

describe.skipIf(NO_CREDS)("Alpaca PAPER live API (opt-in E2E)", () => {
  it("EnvironmentLoader resolves real paper creds + base_url", () => {
    const env = loadEnv();
    expect(env.base_url).toBe("https://paper-api.alpaca.markets");
    const creds = env["alpaca"] as AlpacaCreds;
    expect(creds.key_id).toBe(KEY_ID);
    expect(creds.secret_key).toBe(SECRET_KEY);
  });

  it(
    "GET /v2/clock returns 200, contract-shaped, matches recorded fixture",
    async () => {
      const { status, body } = await alpacaGet(loadEnv(), "/v2/clock");
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(typeof b["is_open"]).toBe("boolean");
      expect(typeof b["timestamp"]).toBe("string");
      expectSchemaRoundTrip(body);
      expectMatchesRecorded(body, "clock");
    },
    NET_TIMEOUT_MS,
  );

  it(
    "GET /v2/account returns 200, authenticated, matches recorded fixture",
    async () => {
      const { status, body } = await alpacaGet(loadEnv(), "/v2/account");
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(typeof b["status"]).toBe("string");
      expect(typeof b["buying_power"]).toBe("string");
      expectSchemaRoundTrip(body);
      expectMatchesRecorded(body, "account");
    },
    NET_TIMEOUT_MS,
  );

  it(
    "GET /v2/assets/AAPL returns 200, the requested asset, matches fixture",
    async () => {
      const { status, body } = await alpacaGet(loadEnv(), "/v2/assets/AAPL");
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b["symbol"]).toBe("AAPL");
      expect(typeof b["tradable"]).toBe("boolean");
      expectSchemaRoundTrip(body);
      expectMatchesRecorded(body, "asset-aapl");
    },
    NET_TIMEOUT_MS,
  );
});
