import { describe, it, expect } from "vitest";

import {
  extractRefs,
  NEUTRAL_PLACEHOLDER_PREFIX,
} from "../../../../src/db/templating/ref-extractor.js";
import type {
  ExtractResult,
  NeutralQuery,
  Ref,
} from "../../../../src/db/templating/types.js";

/**
 * Unit tests for extractRefs (src/db/templating/ref-extractor.ts).
 *
 * Covers: no-refs passthrough; single-namespace extraction (env, request.body,
 * response.body); nested paths; de-duplication (one ref, two occurrences);
 * distinct refs; adjacent refs; unknown namespace rejection (UNKNOWN_NAMESPACE);
 * malformed token rejection (MALFORMED_REF); unclosed / bare-dollar passthrough;
 * mixed valid+invalid aggregation; Mongo object handling (value-leaf vs key);
 * __proto__ safety; input-not-mutated; non-string/non-object input; the
 * no-interpolation structural invariant.
 *
 * RED PHASE: src/db/templating/ref-extractor.ts does not exist yet.
 * These tests fail with module-not-found until implementation-engineer creates it.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOk(r: ExtractResult): r is { ok: true; neutral: NeutralQuery } {
  return r.ok === true;
}

function isFail(r: ExtractResult): r is { ok: false; rejections: readonly unknown[] } {
  return r.ok === false;
}

/**
 * Returns the neutralQuery string (asserts ok:true + string shape).
 * @param r - The `ExtractResult` to unwrap.
 * @returns The `neutralQuery` string.
 * @throws {Error} When the result is not `ok:true` or neutralQuery is not a string.
 */
function okString(r: ExtractResult): string {
  if (!isOk(r)) throw new Error(`Expected ok:true, got ok:false`);
  if (typeof r.neutral.neutralQuery !== "string") {
    throw new Error("Expected neutralQuery to be a string");
  }
  return r.neutral.neutralQuery;
}

/**
 * Returns the neutralQuery object (asserts ok:true + object shape).
 * @param r - The `ExtractResult` to unwrap.
 * @returns The `neutralQuery` object or array.
 * @throws {Error} When the result is not `ok:true` or neutralQuery is a string.
 */
function okObject(r: ExtractResult): Readonly<Record<string, unknown>> | readonly unknown[] {
  if (!isOk(r)) throw new Error(`Expected ok:true, got ok:false`);
  if (typeof r.neutral.neutralQuery === "string") {
    throw new Error("Expected neutralQuery to be an object");
  }
  return r.neutral.neutralQuery;
}

/**
 * Returns the refs array from a successful result.
 * @param r - The `ExtractResult` to unwrap.
 * @returns The `refs` array.
 * @throws {Error} When the result is not `ok:true`.
 */
function okRefs(r: ExtractResult): readonly Ref[] {
  if (!isOk(r)) throw new Error(`Expected ok:true, got ok:false`);
  return r.neutral.refs;
}

// ---------------------------------------------------------------------------
// NEUTRAL_PLACEHOLDER_PREFIX export — the sentinel contract
// ---------------------------------------------------------------------------

describe("NEUTRAL_PLACEHOLDER_PREFIX", () => {
  it("is a non-empty string", () => {
    expect(typeof NEUTRAL_PLACEHOLDER_PREFIX).toBe("string");
    expect(NEUTRAL_PLACEHOLDER_PREFIX.length).toBeGreaterThan(0);
  });

  it("contains 'APIWRIGHT_PARAM' (the sentinel is identifiable and non-value)", () => {
    expect(NEUTRAL_PLACEHOLDER_PREFIX).toContain("APIWRIGHT_PARAM");
  });
});

// ---------------------------------------------------------------------------
// String queries — no refs
// ---------------------------------------------------------------------------

describe("extractRefs — string queries with no refs", () => {
  it("returns ok:true for a plain SQL string with no ${} tokens", () => {
    const r = extractRefs("SELECT 1");
    expect(r.ok).toBe(true);
  });

  it("neutralQuery equals the input string exactly when there are no refs", () => {
    const query = "SELECT id, name FROM users WHERE active = true";
    expect(okString(extractRefs(query))).toBe(query);
  });

  it("returns empty refs array when there are no refs", () => {
    expect(okRefs(extractRefs("SELECT 1"))).toHaveLength(0);
  });

  it("returns empty occurrences array when there are no refs", () => {
    const r = extractRefs("SELECT 1");
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.occurrences).toHaveLength(0);
  });

  it("source is the verbatim input string for a string query", () => {
    const query = "SELECT 1";
    const r = extractRefs(query);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.source).toBe(query);
  });

  it("a bare dollar sign is NOT a ref — passes through unchanged", () => {
    const query = "price > $100";
    expect(okString(extractRefs(query))).toBe(query);
  });

  it("$1 (pg native placeholder) is NOT a ref — passes through unchanged", () => {
    const query = "SELECT * FROM users WHERE id = $1";
    expect(okString(extractRefs(query))).toBe(query);
  });

  it("$param (neo4j native placeholder) is NOT a ref — passes through unchanged", () => {
    const query = "MATCH (n) WHERE n.id = $param RETURN n";
    expect(okString(extractRefs(query))).toBe(query);
  });

  it("$$ is NOT a ref — passes through unchanged", () => {
    const query = "$$BODY$$";
    expect(okString(extractRefs(query))).toBe(query);
  });
});

// ---------------------------------------------------------------------------
// String queries — single valid refs
// ---------------------------------------------------------------------------

describe("extractRefs — single env ref", () => {
  it("returns ok:true for a query with ${env.*}", () => {
    expect(extractRefs("SELECT * FROM users WHERE host = ${env.db_host}").ok).toBe(true);
  });

  it("produces exactly one Ref with namespace 'env'", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE x = ${env.db_host}"));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.namespace).toBe("env");
  });

  it("Ref.path is the namespace-relative path verbatim", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE x = ${env.db_host}"));
    expect(refs[0]?.path).toBe("db_host");
  });

  it("Ref.raw is the original token including delimiters", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE x = ${env.db_host}"));
    expect(refs[0]?.raw).toBe("${env.db_host}");
  });

  it("Ref.index is 0 for the first ref", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE x = ${env.db_host}"));
    expect(refs[0]?.index).toBe(0);
  });

  it("neutralQuery contains the sentinel placeholder, NOT the env path value", () => {
    const nq = okString(extractRefs("SELECT * FROM t WHERE x = ${env.db_host}"));
    expect(nq).not.toContain("${env.db_host}");
    expect(nq).toContain("APIWRIGHT_PARAM");
  });

  it("neutralQuery does NOT contain the literal ${env.*} token", () => {
    const nq = okString(extractRefs("SELECT 1 WHERE a = ${env.a}"));
    expect(nq).not.toContain("${env.a}");
  });

  it("produces exactly one occurrence for a single ref site", () => {
    const r = extractRefs("SELECT * FROM t WHERE x = ${env.db_host}");
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.occurrences).toHaveLength(1);
    expect(r.neutral.occurrences[0]?.refIndex).toBe(0);
  });
});

describe("extractRefs — single request.body ref", () => {
  it("returns ok:true for a query with ${request.body.*}", () => {
    expect(extractRefs("INSERT INTO t (x) VALUES (${request.body.userId})").ok).toBe(true);
  });

  it("produces one Ref with namespace 'request.body'", () => {
    const refs = okRefs(extractRefs("INSERT INTO t (x) VALUES (${request.body.userId})"));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.namespace).toBe("request.body");
  });

  it("Ref.path is the body-relative path verbatim (e.g. 'userId')", () => {
    const refs = okRefs(extractRefs("INSERT INTO t (x) VALUES (${request.body.userId})"));
    expect(refs[0]?.path).toBe("userId");
  });

  it("neutralQuery does NOT contain the original token", () => {
    const nq = okString(extractRefs("INSERT INTO t (x) VALUES (${request.body.userId})"));
    expect(nq).not.toContain("${request.body.userId}");
  });
});

describe("extractRefs — single response.body ref", () => {
  it("returns ok:true for a query with ${response.body.*}", () => {
    expect(extractRefs("SELECT * FROM t WHERE id = ${response.body.id}").ok).toBe(true);
  });

  it("produces one Ref with namespace 'response.body'", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE id = ${response.body.id}"));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.namespace).toBe("response.body");
  });

  it("Ref.path is 'id' for ${response.body.id}", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE id = ${response.body.id}"));
    expect(refs[0]?.path).toBe("id");
  });
});

// ---------------------------------------------------------------------------
// String queries — nested paths
// ---------------------------------------------------------------------------

describe("extractRefs — nested path", () => {
  it("handles deeply nested path ${response.body.data.items.0.id}", () => {
    const refs = okRefs(extractRefs(
      "SELECT * FROM t WHERE id = ${response.body.data.items.0.id}",
    ));
    expect(refs).toHaveLength(1);
    expect(refs[0]?.namespace).toBe("response.body");
    expect(refs[0]?.path).toBe("data.items.0.id");
  });

  it("handles multi-segment env path ${env.db.host}", () => {
    const refs = okRefs(extractRefs("SELECT * FROM t WHERE h = ${env.db.host}"));
    expect(refs[0]?.namespace).toBe("env");
    expect(refs[0]?.path).toBe("db.host");
  });
});

// ---------------------------------------------------------------------------
// String queries — de-duplication
// ---------------------------------------------------------------------------

describe("extractRefs — repeated identical ref (de-duplication)", () => {
  const query = "SELECT ${env.x} FROM t WHERE y = ${env.x}";

  it("returns ok:true", () => {
    expect(extractRefs(query).ok).toBe(true);
  });

  it("de-duplicates to exactly ONE Ref for two identical tokens", () => {
    expect(okRefs(extractRefs(query))).toHaveLength(1);
  });

  it("produces TWO occurrences for the two token sites", () => {
    const r = extractRefs(query);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.occurrences).toHaveLength(2);
  });

  it("both occurrences reference refIndex 0 (the single de-duplicated Ref)", () => {
    const r = extractRefs(query);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.occurrences[0]?.refIndex).toBe(0);
    expect(r.neutral.occurrences[1]?.refIndex).toBe(0);
  });

  it("neutralQuery contains two sentinel sites for the two occurrences", () => {
    const nq = okString(extractRefs(query));
    // Both occurrences must have been replaced; original token must be absent
    expect(nq).not.toContain("${env.x}");
    // The sentinel should appear twice (once per occurrence site)
    const sentinel0 = `${NEUTRAL_PLACEHOLDER_PREFIX}0`;
    const occurrenceCount = nq.split(sentinel0).length - 1;
    expect(occurrenceCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// String queries — two distinct refs
// ---------------------------------------------------------------------------

describe("extractRefs — two distinct refs", () => {
  const query = "INSERT INTO t (a, b) VALUES (${env.a_val}, ${request.body.b_val})";

  it("returns two Refs (distinct namespaces/paths)", () => {
    expect(okRefs(extractRefs(query))).toHaveLength(2);
  });

  it("Refs are ordered by first occurrence (env.a_val is index 0)", () => {
    const refs = okRefs(extractRefs(query));
    expect(refs[0]?.namespace).toBe("env");
    expect(refs[0]?.index).toBe(0);
    expect(refs[1]?.namespace).toBe("request.body");
    expect(refs[1]?.index).toBe(1);
  });

  it("produces two occurrences (one per site)", () => {
    const r = extractRefs(query);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.occurrences).toHaveLength(2);
  });

  it("neutralQuery contains neither original token", () => {
    const nq = okString(extractRefs(query));
    expect(nq).not.toContain("${env.a_val}");
    expect(nq).not.toContain("${request.body.b_val}");
  });
});

// ---------------------------------------------------------------------------
// String queries — adjacent refs
// ---------------------------------------------------------------------------

describe("extractRefs — adjacent refs ${a}${b}", () => {
  const query = "${env.x}${env.y}";

  it("returns ok:true for adjacent refs", () => {
    expect(extractRefs(query).ok).toBe(true);
  });

  it("produces two distinct Refs", () => {
    expect(okRefs(extractRefs(query))).toHaveLength(2);
  });

  it("neutralQuery does not contain the original tokens", () => {
    const nq = okString(extractRefs(query));
    expect(nq).not.toContain("${env.x}");
    expect(nq).not.toContain("${env.y}");
  });
});

// ---------------------------------------------------------------------------
// UNKNOWN_NAMESPACE rejections
// ---------------------------------------------------------------------------

describe("extractRefs — UNKNOWN_NAMESPACE rejections", () => {
  const unknownCases = [
    { token: "${secret.api_key}", label: "secret.* namespace" },
    { token: "${db.host}", label: "db.* namespace" },
    { token: "${token}", label: "token (bare, no path)" },
    { token: "${foo.bar}", label: "arbitrary unknown namespace" },
    { token: "${request.x}", label: "request without .body" },
    { token: "${response.x}", label: "response without .body" },
  ] as const;

  for (const { token, label } of unknownCases) {
    it(`returns ok:false for ${label}`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      expect(r.ok).toBe(false);
    });

    it(`rejection for ${label} has code UNKNOWN_NAMESPACE`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      if (!isFail(r)) throw new Error("expected ok:false");
      const rejection = r.rejections[0] as { code: string };
      expect(rejection.code).toBe("UNKNOWN_NAMESPACE");
    });

    it(`rejection for ${label} includes the raw token in ref field`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      if (!isFail(r)) throw new Error("expected ok:false");
      const rejection = r.rejections[0] as { ref: string };
      expect(rejection.ref).toBe(token);
    });

    it(`rejection for ${label} has a human-readable message`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      if (!isFail(r)) throw new Error("expected ok:false");
      const rejection = r.rejections[0] as { message: string };
      expect(typeof rejection.message).toBe("string");
      expect(rejection.message.length).toBeGreaterThan(0);
    });
  }

  it("secret.* is explicitly rejected — not passed through (credential-leak-safe divergence)", () => {
    const r = extractRefs("SELECT * FROM t WHERE key = ${secret.api_key}");
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rejection = r.rejections[0] as { code: string };
    expect(rejection.code).toBe("UNKNOWN_NAMESPACE");
  });

  it("db.* is explicitly rejected — not passed through", () => {
    const r = extractRefs("SELECT * FROM t WHERE host = ${db.host}");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MALFORMED_REF rejections
// ---------------------------------------------------------------------------

describe("extractRefs — MALFORMED_REF rejections", () => {
  const malformedCases = [
    { token: "${}", label: "empty braces" },
    { token: "${ }", label: "whitespace only inside braces" },
    { token: "${env.}", label: "env namespace with empty path" },
    { token: "${env}", label: "env namespace only (no path)" },
    { token: "${request.body.}", label: "request.body with empty trailing path" },
  ] as const;

  for (const { token, label } of malformedCases) {
    it(`returns ok:false for ${label}`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      expect(r.ok).toBe(false);
    });

    it(`rejection for ${label} has code MALFORMED_REF`, () => {
      const r = extractRefs(`SELECT * FROM t WHERE x = ${token}`);
      if (!isFail(r)) throw new Error("expected ok:false");
      const rejection = r.rejections[0] as { code: string };
      expect(rejection.code).toBe("MALFORMED_REF");
    });
  }
});

// ---------------------------------------------------------------------------
// Unclosed token — passthrough (no ref, no rejection)
// ---------------------------------------------------------------------------

describe("extractRefs — unclosed ${env.x token (no closing brace)", () => {
  it("returns ok:true (the unclosed token is not a ref)", () => {
    expect(extractRefs("SELECT * FROM t WHERE x = ${env.x").ok).toBe(true);
  });

  it("produces no refs for an unclosed token", () => {
    expect(okRefs(extractRefs("SELECT * FROM t WHERE x = ${env.x"))).toHaveLength(0);
  });

  it("leaves the unclosed token verbatim in neutralQuery", () => {
    const query = "SELECT * FROM t WHERE x = ${env.x";
    expect(okString(extractRefs(query))).toBe(query);
  });
});

// ---------------------------------------------------------------------------
// Mixed valid + invalid in one query (aggregated failure)
// ---------------------------------------------------------------------------

describe("extractRefs — mixed valid and invalid refs (aggregated)", () => {
  const query =
    "SELECT ${env.db_host}, ${secret.key}, ${request.body.user_id}, ${}";

  it("returns ok:false for a query with any invalid ref", () => {
    expect(extractRefs(query).ok).toBe(false);
  });

  it("aggregates ALL invalid refs (does not stop at the first)", () => {
    const r = extractRefs(query);
    if (!isFail(r)) throw new Error("expected ok:false");
    // secret.key = UNKNOWN_NAMESPACE, ${} = MALFORMED_REF → at least 2 rejections
    expect(r.rejections.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT emit a partial neutralQuery on failure (all-or-nothing)", () => {
    const r = extractRefs(query);
    expect(r.ok).toBe(false);
    expect((r as { neutral?: unknown }).neutral).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No-interpolation structural invariant
// ---------------------------------------------------------------------------

describe("extractRefs — no-interpolation invariant (structural proof)", () => {
  it("a ref whose resolved value would be sql-injection text is NOT in neutralQuery", () => {
    // Even the worst-case payload can't appear in neutralQuery because
    // extractRefs never receives or emits values — structural impossibility.
    const injectionValue = "'; DROP TABLE users; --";
    const query = `SELECT * FROM t WHERE id = \${env.user_id}`;
    const nq = okString(extractRefs(query));
    // The injection VALUE is not in scope here, so it cannot appear.
    expect(nq).not.toContain(injectionValue);
    // The original ref is replaced by the sentinel, not the value.
    expect(nq).not.toContain("${env.user_id}");
    expect(nq).toContain("APIWRIGHT_PARAM");
  });
});

// ---------------------------------------------------------------------------
// Mongo object queries — value leaves
// ---------------------------------------------------------------------------

describe("extractRefs — Mongo object queries", () => {
  it("returns ok:true for a flat object with no refs", () => {
    expect(extractRefs({ find: "users" }).ok).toBe(true);
  });

  it("produces an object-shaped neutralQuery for a plain-object input", () => {
    const r = extractRefs({ find: "users" });
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(typeof r.neutral.neutralQuery).not.toBe("string");
  });

  it("source is { kind: 'mongo-document' } for an object input", () => {
    const r = extractRefs({ find: "users" });
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.source).toEqual({ kind: "mongo-document" });
  });

  it("deep-clones the document (object output is not the same reference)", () => {
    const input = { filter: { name: "alice" } };
    const r = extractRefs(input);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.neutralQuery).not.toBe(input);
  });

  it("does NOT mutate the input document", () => {
    const input = { filter: { name: "alice" } };
    const originalStr = JSON.stringify(input);
    extractRefs(input);
    expect(JSON.stringify(input)).toBe(originalStr);
  });

  it("${...} in a value leaf is extracted as a Ref and leaf replaced by sentinel", () => {
    const r = extractRefs({ name: "${request.body.user}" });
    expect(r.ok).toBe(true);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.refs).toHaveLength(1);
    expect(r.neutral.refs[0]?.namespace).toBe("request.body");
    // The leaf value in neutralQuery must NOT be the original token
    const nq = r.neutral.neutralQuery as Record<string, unknown>;
    expect(nq["name"]).not.toBe("${request.body.user}");
  });

  it("${...} in a Mongo OBJECT KEY is NOT extracted (keys are not walked)", () => {
    // Keys represent field/operator names — identifier position, not parameterizable.
    const input: Record<string, unknown> = {};
    input["${env.col}"] = 1;
    const r = extractRefs(input);
    // No ref extracted; the key is left verbatim
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.refs).toHaveLength(0);
  });

  it("nested object value refs are walked", () => {
    const r = extractRefs({ filter: { userId: "${request.body.uid}" } });
    expect(r.ok).toBe(true);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.refs).toHaveLength(1);
    expect(r.neutral.refs[0]?.namespace).toBe("request.body");
  });

  it("array-shaped command is handled (array input is Mongo document)", () => {
    const r = extractRefs(["${env.x}", "literal"]);
    expect(r.ok).toBe(true);
    if (!isOk(r)) throw new Error("expected ok:true");
    expect(r.neutral.refs).toHaveLength(1);
  });

  it("__proto__ key in Mongo document does not mutate the prototype (safe clone)", () => {
    // Create a document that has a '__proto__' own key via Object.create(null)
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "__proto__", {
      value: { injected: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    // Must not throw and must not mutate Object.prototype
    expect(() => extractRefs(input)).not.toThrow();
    // @ts-expect-error — deliberate prototype pollution check
    expect(({} as Record<string, unknown>)["injected"]).toBeUndefined();
  });

  it("unknown-namespace ref in Mongo value leaf is a rejection", () => {
    const r = extractRefs({ name: "${secret.value}" });
    expect(r.ok).toBe(false);
    if (!isFail(r)) throw new Error("expected ok:false");
    const rejection = r.rejections[0] as { code: string };
    expect(rejection.code).toBe("UNKNOWN_NAMESPACE");
  });
});

// ---------------------------------------------------------------------------
// Non-string, non-object input (defensive — total function)
// ---------------------------------------------------------------------------

describe("extractRefs — non-string non-object input (defensive)", () => {
  it("returns ok:false for null input", () => {
    const r = extractRefs(null as unknown as string);
    expect(r.ok).toBe(false);
  });

  it("returns ok:false for numeric input", () => {
    const r = extractRefs(42 as unknown as string);
    expect(r.ok).toBe(false);
  });

  it("never throws for any defensive input", () => {
    expect(() => extractRefs(null as unknown as string)).not.toThrow();
    expect(() => extractRefs(42 as unknown as string)).not.toThrow();
    expect(() => extractRefs(true as unknown as string)).not.toThrow();
  });
});
