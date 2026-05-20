import { describe, it, expect } from "vitest";

import {
  evaluate,
  DB_EXPECT_FAILURE_CODES,
} from "../../../../src/db/expect/expect-evaluator.js";
import type {
  DbVerifyOutcome,
  DbExpectFailureCode,
} from "../../../../src/db/expect/expect-evaluator.js";
import type { NormalizedResult } from "../../../../src/core/normalized-result.js";
import type { CanonicalDbVerification } from "../../../../src/core/canonical-model.js";

/**
 * Unit tests for evaluate() (src/db/expect/expect-evaluator.ts).
 *
 * Covers: DB_EXPECT_FAILURE_CODES contract (frozen, key===value, 4 distinct
 * codes); D-A exists/not_exists (rows.length basis, NOT rowCount; count-query
 * caveat; DELETE verification shape); D-B match semantics (∃ row, extra keys
 * ignored, absent key ≠ null, nested-object, array order); D-C exact
 * semantics (key-set equality, D-C cardinality — one exact row among many
 * non-matching ⇒ pass); D-D malformed fields (before row iteration, not
 * throw); D4 zero-coercion trap table; pass:true invariant (no failureCode/
 * reason keys); secret-free reason; exhaustive-switch default; never-throws.
 *
 * RED PHASE: src/db/expect/expect-evaluator.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produces a minimal NormalizedResult. */
function makeResult(rows: Record<string, unknown>[], rowCount?: number): NormalizedResult {
  return { rows, rowCount: rowCount ?? rows.length, raw: null };
}

/** Produces a minimal CanonicalDbVerification for exists/not_exists (no fields). */
function makeVerification(
  mode: CanonicalDbVerification["expect"],
  fields?: Record<string, unknown>,
): CanonicalDbVerification {
  return {
    connection: "test_conn",
    query: "SELECT 1",
    expect: mode,
    fields,
  };
}

// ---------------------------------------------------------------------------
// DB_EXPECT_FAILURE_CODES — frozen record, key===value, four distinct codes
// ---------------------------------------------------------------------------

describe("DB_EXPECT_FAILURE_CODES", () => {
  it("is frozen (Object.isFrozen returns true)", () => {
    expect(Object.isFrozen(DB_EXPECT_FAILURE_CODES)).toBe(true);
  });

  it("has key === value for DB_EXPECT_EXISTS_EMPTY", () => {
    expect(DB_EXPECT_FAILURE_CODES.DB_EXPECT_EXISTS_EMPTY).toBe(
      "DB_EXPECT_EXISTS_EMPTY",
    );
  });

  it("has key === value for DB_EXPECT_NOT_EXISTS_NONEMPTY", () => {
    expect(DB_EXPECT_FAILURE_CODES.DB_EXPECT_NOT_EXISTS_NONEMPTY).toBe(
      "DB_EXPECT_NOT_EXISTS_NONEMPTY",
    );
  });

  it("has key === value for DB_EXPECT_NO_MATCHING_ROW", () => {
    expect(DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW).toBe(
      "DB_EXPECT_NO_MATCHING_ROW",
    );
  });

  it("has key === value for DB_EXPECT_MALFORMED", () => {
    expect(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED).toBe("DB_EXPECT_MALFORMED");
  });

  it("contains exactly four own enumerable keys", () => {
    expect(Object.keys(DB_EXPECT_FAILURE_CODES)).toHaveLength(4);
  });

  it("all four codes are mutually distinct string values", () => {
    const values = Object.values(DB_EXPECT_FAILURE_CODES);
    const unique = new Set<string>(values);
    expect(unique.size).toBe(4);
  });

  it("does not mutate when assignment is attempted (frozen)", () => {
    try {
      // @ts-expect-error — deliberate mutation attempt on frozen object
      DB_EXPECT_FAILURE_CODES["DB_EXPECT_EXISTS_EMPTY"] = "MUTATED";
    } catch {
      // expected in strict mode
    }
    expect(DB_EXPECT_FAILURE_CODES.DB_EXPECT_EXISTS_EMPTY).toBe(
      "DB_EXPECT_EXISTS_EMPTY",
    );
  });
});

// ---------------------------------------------------------------------------
// D-A — exists mode
// ---------------------------------------------------------------------------

describe("evaluate — 'exists' mode (D-A)", () => {
  it("returns pass:false DB_EXPECT_EXISTS_EMPTY for empty rows:[]", () => {
    const outcome = evaluate(makeResult([]), makeVerification("exists"));
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_EXISTS_EMPTY,
      );
    }
  });

  it("returns pass:true when rows has at least one entry", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists"),
    );
    expect(outcome.pass).toBe(true);
  });

  it("returns pass:true for multiple rows", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }, { id: 2 }]),
      makeVerification("exists"),
    );
    expect(outcome.pass).toBe(true);
  });

  it("D-A count-query caveat: rows:[{ count: 0 }] makes exists pass:true (a returned row IS a row)", () => {
    // A COUNT(*) returning 0 still returns one row — exists is true
    const outcome = evaluate(
      makeResult([{ count: 0 }]),
      makeVerification("exists"),
    );
    expect(outcome.pass).toBe(true);
    // This is correct and unavoidable per D-A; the caveat is documented in design
  });

  it("rowCount is NOT the basis: rows:[] rowCount:3 ⇒ pass:false DB_EXPECT_EXISTS_EMPTY", () => {
    // Even with rowCount=3 (e.g. affected rows from a write), empty rows ⇒ fail
    const result: NormalizedResult = { rows: [], rowCount: 3, raw: null };
    const outcome = evaluate(result, makeVerification("exists"));
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_EXISTS_EMPTY,
      );
    }
  });

  it("exists ignores any 'fields' present in verification (irrelevant to exists)", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists", { some_field: "some_value" }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("exists with empty fields {} still only checks row count (pass:true when rows non-empty)", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists", {}),
    );
    expect(outcome.pass).toBe(true);
  });

  it("exists outcome has mode 'exists' in the failure object", () => {
    const outcome = evaluate(makeResult([]), makeVerification("exists"));
    if (outcome.pass === false) {
      expect(outcome.mode).toBe("exists");
    }
  });

  it("pass:true outcome does NOT have failureCode key", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists"),
    );
    if (outcome.pass) {
      expect("failureCode" in outcome).toBe(false);
    }
  });

  it("pass:true outcome does NOT have reason key", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists"),
    );
    if (outcome.pass) {
      expect("reason" in outcome).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// D-A — not_exists mode
// ---------------------------------------------------------------------------

describe("evaluate — 'not_exists' mode (D-A)", () => {
  it("returns pass:true for rows:[]", () => {
    const outcome = evaluate(makeResult([]), makeVerification("not_exists"));
    expect(outcome.pass).toBe(true);
  });

  it("D-A DELETE-verification shape: rows:[] rowCount:3 ⇒ pass:true (rowCount is NOT the basis)", () => {
    const result: NormalizedResult = { rows: [], rowCount: 3, raw: null };
    const outcome = evaluate(result, makeVerification("not_exists"));
    expect(outcome.pass).toBe(true);
  });

  it("returns pass:false DB_EXPECT_NOT_EXISTS_NONEMPTY when rows has entries", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("not_exists"),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NOT_EXISTS_NONEMPTY,
      );
    }
  });

  it("not_exists ignores any 'fields' present in verification", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("not_exists", { field: "val" }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("not_exists with absent fields never produces DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("not_exists"),
    );
    if (outcome.pass === false) {
      expect(outcome.failureCode).not.toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// D-B — match mode
// ---------------------------------------------------------------------------

describe("evaluate — 'match' mode (D-B)", () => {
  it("returns pass:true when one row satisfies all declared fields", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice" }]),
      makeVerification("match", { id: 1 }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("extra row keys are ignored — pass:true when undeclared keys exist on the row", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice", extra: "ignored" }]),
      makeVerification("match", { id: 1 }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("returns pass:false DB_EXPECT_NO_MATCHING_ROW when declared field value differs", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice" }]),
      makeVerification("match", { id: 2 }),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
      );
    }
  });

  it("match passes when the SECOND of N rows satisfies the fields (∃ one match)", () => {
    const outcome = evaluate(
      makeResult([
        { id: 1, name: "bob" },
        { id: 2, name: "alice" },
      ]),
      makeVerification("match", { name: "alice" }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("declared key absent on the only row ⇒ pass:false (absent ≠ null)", () => {
    const outcome = evaluate(
      makeResult([{ name: "alice" }]),
      makeVerification("match", { id: 1 }),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
      );
    }
  });

  it("nested-object field with reordered keys ⇒ pass:true (deepEqual is key-order-independent for objects)", () => {
    const outcome = evaluate(
      makeResult([{ meta: { b: 2, a: 1 } }]),
      makeVerification("match", { meta: { a: 1, b: 2 } }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("array field with reordered elements ⇒ pass:false (deepEqual is order-sensitive for arrays)", () => {
    const outcome = evaluate(
      makeResult([{ tags: ["b", "a"] }]),
      makeVerification("match", { tags: ["a", "b"] }),
    );
    expect(outcome.pass).toBe(false);
  });

  it("match with 0 rows ⇒ pass:false DB_EXPECT_NO_MATCHING_ROW", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("match", { id: 1 }),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
      );
    }
  });

  it("outcome mode is 'match' in the failure object", () => {
    const outcome = evaluate(
      makeResult([{ id: 2 }]),
      makeVerification("match", { id: 1 }),
    );
    if (outcome.pass === false) {
      expect(outcome.mode).toBe("match");
    }
  });
});

// ---------------------------------------------------------------------------
// D-C — exact mode (including D-C cardinality decision)
// ---------------------------------------------------------------------------

describe("evaluate — 'exact' mode (D-C)", () => {
  it("returns pass:true when one row has exactly the declared key set + equal values", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice" }]),
      makeVerification("exact", { id: 1, name: "alice" }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("one extra row key ⇒ pass:false (key set not equal)", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice", extra: "unwanted" }]),
      makeVerification("exact", { id: 1, name: "alice" }),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
      );
    }
  });

  it("one missing declared key on the row ⇒ pass:false (key set not equal)", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exact", { id: 1, name: "alice" }),
    );
    expect(outcome.pass).toBe(false);
  });

  it("all declared keys present+equal but row has an extra undeclared key ⇒ pass:false", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, name: "alice", hidden: "extra" }]),
      makeVerification("exact", { id: 1, name: "alice" }),
    );
    expect(outcome.pass).toBe(false);
  });

  it("D-C cardinality: one exact-match row among several non-matching rows ⇒ pass:true", () => {
    // exact does NOT require result cardinality === 1 (spec says per-row shape)
    const outcome = evaluate(
      makeResult([
        { id: 1, name: "alice", extra: "not-exact" },
        { id: 2, name: "alice" },
        { id: 3, name: "bob", extra: "also-not-exact" },
      ]),
      makeVerification("exact", { id: 2, name: "alice" }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("exact with 0 rows ⇒ pass:false DB_EXPECT_NO_MATCHING_ROW", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("exact", { id: 1 }),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
      );
    }
  });

  it("outcome mode is 'exact' in the failure object", () => {
    const outcome = evaluate(
      makeResult([{ id: 1, extra: "key" }]),
      makeVerification("exact", { id: 1 }),
    );
    if (outcome.pass === false) {
      expect(outcome.mode).toBe("exact");
    }
  });
});

// ---------------------------------------------------------------------------
// D-D — malformed fields (absent or empty for match/exact)
// ---------------------------------------------------------------------------

describe("evaluate — D-D malformed fields", () => {
  it("match with fields:undefined ⇒ pass:false DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("match", undefined),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED);
    }
  });

  it("match with fields:{} (empty) ⇒ pass:false DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("match", {}),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED);
    }
  });

  it("exact with fields:undefined ⇒ pass:false DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exact", undefined),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED);
    }
  });

  it("exact with fields:{} (empty) ⇒ pass:false DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exact", {}),
    );
    expect(outcome.pass).toBe(false);
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED);
    }
  });

  it("D-D check fires BEFORE row iteration: rows:[{id:1}] + empty fields ⇒ DB_EXPECT_MALFORMED", () => {
    // Even with a matching row, empty fields is a malformed verification
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("match", {}),
    );
    if (outcome.pass === false) {
      expect(outcome.failureCode).toBe(DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED);
    }
  });

  it("exists with absent fields NEVER produces DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("exists", undefined),
    );
    if (outcome.pass === false) {
      expect(outcome.failureCode).not.toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
      );
    }
  });

  it("not_exists with empty fields {} NEVER produces DB_EXPECT_MALFORMED", () => {
    const outcome = evaluate(
      makeResult([]),
      makeVerification("not_exists", {}),
    );
    if (outcome.pass === false) {
      expect(outcome.failureCode).not.toBe(
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
      );
    }
  });

  it("D-D outcome has mode 'match' in the failure object", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("match", {}),
    );
    if (outcome.pass === false) {
      expect(outcome.mode).toBe("match");
    }
  });

  it("D-D outcome has mode 'exact' for exact with empty fields", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exact", undefined),
    );
    if (outcome.pass === false) {
      expect(outcome.mode).toBe("exact");
    }
  });
});

// ---------------------------------------------------------------------------
// D4 zero-coercion trap table
// ---------------------------------------------------------------------------

describe("evaluate — D4 zero-coercion trap table", () => {
  // Each entry: declared value vs row value → should always fail (no coercion)
  const trapCases: Array<{
    label: string;
    declared: unknown;
    rowValue: unknown;
    remedy: string;
  }> = [
    {
      label: "string '201' vs number 201",
      declared: 201,
      rowValue: "201",
      remedy: "project column to integer in query (e.g. col::int)",
    },
    {
      label: "number 1 vs boolean true",
      declared: 1,
      rowValue: true,
      remedy: "compare using explicit cast",
    },
    {
      label: "string 'true' vs boolean true",
      declared: true,
      rowValue: "true",
      remedy: "project to boolean in query (e.g. col::boolean)",
    },
    {
      label: "ISO date string vs Date instance",
      declared: "2024-01-01",
      rowValue: new Date("2024-01-01"),
      remedy: "project to text in query (e.g. to_char(ts, 'YYYY-MM-DD'))",
    },
    {
      label: "neo4j Integer-shaped {low,high} vs number",
      declared: 42,
      rowValue: { low: 42, high: 0 },
      remedy: "convert neo4j Integer in query (e.g. n.toNumber())",
    },
    {
      label: "BSON ObjectId-shaped class instance vs hex string",
      declared: "507f1f77bcf86cd799439011",
      rowValue: { _bsontype: "ObjectID", id: new Uint8Array(12) },
      remedy: "project to string in query (e.g. Mongo $toString)",
    },
  ];

  for (const { label, declared, rowValue, remedy } of trapCases) {
    it(`${label} ⇒ pass:false (no coercion — projection remedy: ${remedy})`, () => {
      const outcome = evaluate(
        makeResult([{ col: rowValue }]),
        makeVerification("match", { col: declared }),
      );
      // Zero coercion: declared type !== row type ⇒ no match
      expect(outcome.pass).toBe(false);
    });
  }

  it("explicit null vs null ⇒ pass:true (null equals null, deepEqual)", () => {
    const outcome = evaluate(
      makeResult([{ col: null }]),
      makeVerification("match", { col: null }),
    );
    expect(outcome.pass).toBe(true);
  });

  it("declared null vs absent key ⇒ pass:false (missing ≠ null, D-B rule)", () => {
    const outcome = evaluate(
      makeResult([{ other_col: 1 }]),
      makeVerification("match", { col: null }),
    );
    expect(outcome.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pass:true invariant — no failureCode/reason keys
// ---------------------------------------------------------------------------

describe("evaluate — pass:true invariant (GroupOutcome omit-on-pass)", () => {
  const passingCases: Array<[string, NormalizedResult, CanonicalDbVerification]> = [
    [
      "exists with rows",
      makeResult([{ id: 1 }]),
      makeVerification("exists"),
    ],
    [
      "not_exists with empty rows",
      makeResult([]),
      makeVerification("not_exists"),
    ],
    [
      "match with matching row",
      makeResult([{ id: 1, name: "alice" }]),
      makeVerification("match", { id: 1 }),
    ],
    [
      "exact with exact row",
      makeResult([{ id: 1 }]),
      makeVerification("exact", { id: 1 }),
    ],
  ];

  for (const [label, result, verification] of passingCases) {
    it(`${label}: pass:true outcome has no 'failureCode' key`, () => {
      const outcome = evaluate(result, verification);
      if (outcome.pass) {
        expect("failureCode" in outcome).toBe(false);
      }
    });

    it(`${label}: pass:true outcome has no 'reason' key`, () => {
      const outcome = evaluate(result, verification);
      if (outcome.pass) {
        expect("reason" in outcome).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Secret-free reason
// ---------------------------------------------------------------------------

describe("evaluate — secret-free reason", () => {
  it("reason for a failing match does not contain fields values (secrets may be values)", () => {
    const secretValue = "super_secret_token_12345";
    const secretRow = "exposed_secret_cell_value";
    const outcome = evaluate(
      makeResult([{ col: secretRow }]),
      makeVerification("match", { col: secretValue }),
    );
    if (outcome.pass === false) {
      expect(outcome.reason).not.toContain(secretValue);
      expect(outcome.reason).not.toContain(secretRow);
    }
  });

  it("reason for a failing exists does not contain row data", () => {
    const outcome = evaluate(makeResult([]), makeVerification("exists"));
    if (outcome.pass === false) {
      // reason should contain mode name and counts, never row data
      expect(typeof outcome.reason).toBe("string");
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Exhaustive-switch default (out-of-union expect value)
// ---------------------------------------------------------------------------

describe("evaluate — exhaustive-switch default (defensive, never-throw)", () => {
  it("returns a structured pass:false (not throw) for an out-of-union expect value", () => {
    const weirdVerification = {
      connection: "conn",
      query: "SELECT 1",
      expect: "TOTALLY_UNKNOWN_MODE" as unknown as CanonicalDbVerification["expect"],
    } as CanonicalDbVerification;
    expect(() => evaluate(makeResult([]), weirdVerification)).not.toThrow();
    const outcome = evaluate(makeResult([]), weirdVerification);
    // The default arm returns a pass:false structured result
    expect(outcome.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Never-throws / total function
// ---------------------------------------------------------------------------

describe("evaluate — never-throws (total function)", () => {
  it("does not throw for any combination of mode and rows", () => {
    const modes: CanonicalDbVerification["expect"][] = [
      "exists",
      "not_exists",
      "match",
      "exact",
    ];
    const results = [makeResult([]), makeResult([{ a: 1 }])];
    for (const mode of modes) {
      for (const result of results) {
        expect(() =>
          evaluate(result, makeVerification(mode, { a: 1 })),
        ).not.toThrow();
      }
    }
  });

  it("does not throw when rows contains a deeply nested object", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(() =>
      evaluate(makeResult([deep]), makeVerification("match", deep)),
    ).not.toThrow();
  });

  it("does not throw when fields contains a cyclic-ish (but non-actual-circular) object", () => {
    // deepEqual is depth-guarded; non-trivially deep nested fields are fine
    const nested = { level1: { level2: { level3: "deep" } } };
    expect(() =>
      evaluate(makeResult([nested]), makeVerification("match", nested)),
    ).not.toThrow();
  });

  it("does not throw for a huge rows array", () => {
    const bigRows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    expect(() =>
      evaluate(makeResult(bigRows), makeVerification("exists")),
    ).not.toThrow();
  });

  it("empty rows + exists mode → pass:false with mode=exists (D-A determinism)", () => {
    const outcome = evaluate(makeResult([]), makeVerification("exists"));
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.mode).toBe("exists");
  });

  it("result is JSON-serializable for all pass:false outcomes", () => {
    const outcome = evaluate(makeResult([]), makeVerification("exists"));
    expect(() => JSON.stringify(outcome)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(outcome)) as DbVerifyOutcome;
    expect(parsed.pass).toBe(false);
  });

  it("result is JSON-serializable for pass:true outcome", () => {
    const outcome = evaluate(
      makeResult([{ id: 1 }]),
      makeVerification("exists"),
    );
    expect(() => JSON.stringify(outcome)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(outcome)) as DbVerifyOutcome;
    expect(parsed.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("evaluate — determinism", () => {
  it("same inputs produce JSON-stringify-equal outputs (pass case)", () => {
    const result = makeResult([{ id: 1 }]);
    const verification = makeVerification("exists");
    const o1 = evaluate(result, verification);
    const o2 = evaluate(result, verification);
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
  });

  it("same inputs produce JSON-stringify-equal outputs (fail case)", () => {
    const result = makeResult([]);
    const verification = makeVerification("match", { id: 1 });
    const o1 = evaluate(result, verification);
    const o2 = evaluate(result, verification);
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
  });
});

// ---------------------------------------------------------------------------
// DbExpectFailureCode type coverage — all four codes are valid values
// ---------------------------------------------------------------------------

describe("DbExpectFailureCode — all four code strings are valid at type level", () => {
  it("DB_EXPECT_EXISTS_EMPTY is a valid DbExpectFailureCode", () => {
    const code: DbExpectFailureCode = "DB_EXPECT_EXISTS_EMPTY";
    expect(code).toBe("DB_EXPECT_EXISTS_EMPTY");
  });

  it("DB_EXPECT_NOT_EXISTS_NONEMPTY is a valid DbExpectFailureCode", () => {
    const code: DbExpectFailureCode = "DB_EXPECT_NOT_EXISTS_NONEMPTY";
    expect(code).toBe("DB_EXPECT_NOT_EXISTS_NONEMPTY");
  });

  it("DB_EXPECT_NO_MATCHING_ROW is a valid DbExpectFailureCode", () => {
    const code: DbExpectFailureCode = "DB_EXPECT_NO_MATCHING_ROW";
    expect(code).toBe("DB_EXPECT_NO_MATCHING_ROW");
  });

  it("DB_EXPECT_MALFORMED is a valid DbExpectFailureCode", () => {
    const code: DbExpectFailureCode = "DB_EXPECT_MALFORMED";
    expect(code).toBe("DB_EXPECT_MALFORMED");
  });
});
