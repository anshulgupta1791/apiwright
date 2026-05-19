/**
 * Synthetic `EvaluationContext` fixtures for assertion corpus tests.
 *
 * All contexts have `now: FIXED_NOW` (never real `Date.now()`) so
 * `is_recent_timestamp` is fully deterministic and hermetic. Timestamps are
 * precomputed literal strings — no `Date` constructor called at import time.
 *
 * Named exports only; no default export. No `Date`, `Math.random`, network,
 * DB, or filesystem access anywhere in this file.
 */

import type { EvaluationContext } from "../../../src/assertions/index.js";
import type { NormalizedResult } from "../../../src/assertions/index.js";
import type { CtxKey } from "./corpus-types.js";

// ---- Fixed-clock constants -----------------------------------------------

/** Fixed evaluation instant (epoch ms). Chosen, NOT Date.now(). */
export const FIXED_NOW = 1_716_000_000_000;

/**
 * Same instant as an ISO-8601 date-time string (precomputed literal, not
 * constructed via `new Date(FIXED_NOW).toISOString()` at runtime).
 * Corresponds to 2024-05-18T02:40:00.000Z.
 */
export const FIXED_NOW_ISO = "2024-05-18T02:40:00.000Z";

/**
 * FIXED_NOW minus 10 minutes (600000 ms) as an ISO string — outside the
 * symmetric ±5 min window used by `is_recent_timestamp`.
 * Precomputed literal: 2024-05-18T02:30:00.000Z.
 */
export const OLD_NOW_ISO = "2024-05-18T02:30:00.000Z";

// ---- NormalizedResult instances for the db context -----------------------

/** DB result: one row, rowCount = 1 (user_check query). */
const userCheck: NormalizedResult = {
  rows: [{ id: 1 }],
  rowCount: 1,
  raw: {},
};

/** DB result: three rows, rowCount = 3 (multi_row query). */
const multiRow: NormalizedResult = {
  rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
  rowCount: 3,
  raw: {},
};

// ---- base context --------------------------------------------------------

/**
 * Primary context — exercises comparison, pattern, format, and aggregate/array
 * operators. Headers stored lowercased (proving case-insensitive lookup).
 */
const baseCtx: EvaluationContext = {
  request: {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer abc.def",
    },
    body: {
      subtotal: 100,
      profile: { name: "A", roles: ["x"] },
      tags: ["alpha", "beta", "gamma"],
      email: "user@example.com",
    },
    url: {
      full: "https://api.example.com/v1/users",
      path: "/v1/users",
      query: {},
    },
  },
  response: {
    status: 201,
    time_ms: 42,
    headers: { "content-type": "application/json" },
    body: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "user@example.com",
      message: "resource created",
      tags: ["alpha", "beta", "gamma"],
      profile: { name: "A", roles: ["x"] },
      total: 108,
      created_at: FIXED_NOW_ISO,
      link: "https://example.com/x",
      notUuid: "not-a-uuid",
      notTs: "not-a-timestamp",
      notEmail: "not-an-email",
      notUrl: "not a url",
    },
  },
  db: {},
  now: FIXED_NOW,
};

// ---- headers context -----------------------------------------------------

/**
 * Dedicated headers context with mixed-case stored headers to assert
 * case-insensitive lookup independently from `base`. Minimal otherwise.
 */
const headersCtx: EvaluationContext = {
  request: {
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": "abc123",
    },
    body: {},
    url: {
      full: "https://api.example.com/v1/items",
      path: "/v1/items",
      query: {},
    },
  },
  response: {
    status: 200,
    time_ms: 10,
    headers: { "Content-Type": "application/json" },
    body: {},
  },
  db: {},
  now: FIXED_NOW,
};

// ---- db context ----------------------------------------------------------

/**
 * Context for aggregate/db operator cases. `request`/`response` are minimal
 * valid shapes; the aggregate cases only navigate `db.*` targets.
 */
const dbCtx: EvaluationContext = {
  request: {
    headers: {},
    body: {},
    url: {
      full: "https://api.example.com/v1/db-test",
      path: "/v1/db-test",
      query: {},
    },
  },
  response: {
    status: 200,
    time_ms: 5,
    headers: {},
    body: {},
  },
  db: {
    primary_postgres: {
      user_check: userCheck,
      multi_row: multiRow,
    },
  },
  now: FIXED_NOW,
};

// ---- edge context --------------------------------------------------------

/**
 * Null-vs-missing + over-cap + prototype-pollution + format-fail context.
 * `response.body`:
 *   - `present = "v"` (present, non-null)
 *   - `nullField = null` (explicit JSON null)
 *   - NO `missingField` key (so resolver returns found:false)
 *   - `huge` = a 65537-character string (exceeds the regex cap of 65536)
 *   - `old_at` = OLD_NOW_ISO (10 min before FIXED_NOW — outside 5-min window)
 *   - `email` for existence-on-email sub-tests
 *
 * Prototype-pollution safety: accessing `__proto__` or `constructor` on a
 * plain object body must resolve as absent (the resolver is hasOwnProperty-
 * gated). The fixture does NOT pollute Object.prototype.
 */
const edgeCtx: EvaluationContext = {
  request: {
    headers: {},
    body: {},
    url: {
      full: "https://api.example.com/v1/edge",
      path: "/v1/edge",
      query: {},
    },
  },
  response: {
    status: 200,
    time_ms: 1,
    headers: {},
    body: {
      present: "v",
      nullField: null,
      huge: "x".repeat(65537),
      old_at: OLD_NOW_ISO,
      email: "user@example.com",
    },
  },
  db: {},
  now: FIXED_NOW,
};

// ---- Exported map --------------------------------------------------------

/**
 * All synthetic evaluation contexts, keyed by `CtxKey`.
 * The integration test accesses them as `ASSERTION_CONTEXTS[case.context]`.
 * `noUncheckedIndexedAccess`-safe: `CtxKey` is a closed union and the map is
 * total over it (all four keys present).
 */
export const ASSERTION_CONTEXTS: Readonly<Record<CtxKey, EvaluationContext>> = {
  base: baseCtx,
  headers: headersCtx,
  db: dbCtx,
  edge: edgeCtx,
};
