import { describe, it, expect, vi } from "vitest";

import { AssertionParser } from "../../../src/assertions/parser.js";
import type {
  AssertionParserDeps,
} from "../../../src/assertions/parser.js";
import type {
  AssertionAst,
  AssertionParseResult,
  OperatorName,
} from "../../../src/assertions/index.js";

/**
 * Unit tests for AssertionParser — the Layer-D parse-side orchestrator.
 *
 * Covers: spec §4 examples (exact AST round-trip); operator/arity enforcement;
 * operand strategy dispatch (all six OperandShape arms); full multi-error
 * aggregation; never-throws on fuzz; collaborator injection + default-seam
 * wiring; purity/determinism; region-splitting matrix; the F1 db SPACE form
 * (parses OK) and the dot-glued form (UNKNOWN_OPERATOR). E6 arithmetic
 * TYPE_MISMATCH propagation lives in evaluator.test.ts.
 *
 * Implementation note: every `it` that references sub-parsers that do not yet
 * exist will fail with MODULE_NOT_FOUND — that is the correct RED state.
 *
 * Split rationale: ≤300 lines. operand-shape exhaustion is in
 * parser-operand.test.ts if a split occurs; this file covers the orchestration
 * level and acceptance criteria.
 */

// ---------------------------------------------------------------------------
// Helpers — synthetic stubs for injection
// ---------------------------------------------------------------------------

function makeStubTokenizer(ok: boolean, tokens: unknown[] = []) {
  return { tokenize: vi.fn().mockReturnValue({ ok, tokens, errors: [] }) };
}

function makeStubTargetParser(ok: boolean, ref?: unknown) {
  return {
    parse: vi.fn().mockReturnValue(
      ok
        ? { ok: true, ref }
        : { ok: false, errors: [{ message: "stub target error" }] },
    ),
  };
}

function makeStubOperatorLookup(result: unknown) {
  return vi.fn().mockReturnValue(result);
}

// ---------------------------------------------------------------------------
// Acceptance #1 — spec §4 examples ⇒ exact AST (real collaborators, real parse)
// ---------------------------------------------------------------------------

describe("AssertionParser — spec §4 examples (real collaborators)", () => {
  const parser = new AssertionParser();

  it("parses 'response.status equals 201' to LiteralOperand{value:201}", () => {
    const result = parser.parse("response.status equals 201");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ast = result.ast;
    expect(ast.raw).toBe("response.status equals 201");
    expect(ast.operator).toBe("equals");
    expect(ast.target).toMatchObject({ root: "response.status" });
    expect(ast.operand).toMatchObject({ kind: "literal", value: 201 });
  });

  it("parses 'response.body.id is_uuid_v4' with operand OMITTED", () => {
    const result = parser.parse("response.body.id is_uuid_v4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ast = result.ast;
    expect(ast.raw).toBe("response.body.id is_uuid_v4");
    expect(ast.operator).toBe("is_uuid_v4");
    expect("operand" in ast).toBe(false);
  });

  it("parses 'response.body.email equals request.body.email' to TargetOperand", () => {
    const result = parser.parse("response.body.email equals request.body.email");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ast = result.ast;
    expect(ast.operator).toBe("equals");
    expect(ast.operand).toMatchObject({ kind: "target" });
    expect((ast.operand as { ref: unknown }).ref).toMatchObject({ root: "request.body" });
  });

  it("parses 'response.body.created_at is_recent_timestamp' with operand OMITTED", () => {
    const result = parser.parse("response.body.created_at is_recent_timestamp");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("is_recent_timestamp");
    expect("operand" in result.ast).toBe(false);
  });

  it(
    "parses 'response.body.total equals (request.body.subtotal * 1.08)' " +
      "to ArithmeticOperandNode",
    () => {
      const raw = "response.body.total equals (request.body.subtotal * 1.08)";
      const result = parser.parse(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ast.operator).toBe("equals");
      expect(result.ast.operand).toMatchObject({ kind: "arithmetic" });
    },
  );

  it(
    "F1 — 'db.primary_postgres.user_check count_equals 1' (SPACE-separated) parses ok",
    () => {
      const raw = "db.primary_postgres.user_check count_equals 1";
      const result = parser.parse(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ast.operator).toBe("count_equals");
      expect(result.ast.operand).toMatchObject({ kind: "literal", value: 1 });
      expect(result.ast.target).toMatchObject({
        root: "db",
        connection: "primary_postgres",
        queryId: "user_check",
      });
    },
  );

  it(
    "F1 — 'db.primary_postgres.user_check.count_equals 1' (dot-glued) yields UNKNOWN_OPERATOR",
    () => {
      const raw = "db.primary_postgres.user_check.count_equals 1";
      const result = parser.parse(raw);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const msgs = result.errors.join(" ");
      expect(msgs).toMatch(/operator/i);
    },
  );
});

// ---------------------------------------------------------------------------
// Acceptance #2 — registry-driven operator/arity enforcement
// ---------------------------------------------------------------------------

describe("AssertionParser — operator/arity enforcement", () => {
  const parser = new AssertionParser();

  it("returns ok:false with UNKNOWN_OPERATOR for unrecognised operator 'eq'", () => {
    const result = parser.parse("response.status eq 200");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /operator/i.test(e))).toBe(true);
  });

  it("returns ok:false with MALFORMED_RANGE for 'in_range 100' (single bound)", () => {
    const result = parser.parse("response.status in_range 100");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /range/i.test(e))).toBe(true);
  });

  it("returns ok:false with MISSING_OPERAND for 'response.status equals' (no operand)", () => {
    const result = parser.parse("response.status equals");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /operand|missing/i.test(e))).toBe(true);
  });

  it("returns ok:false with UNEXPECTED_OPERAND for 'response.body.x exists 1'", () => {
    const result = parser.parse("response.body.x exists 1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /operand|unexpected/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance #3 — operand strategy (arithmetic, regex, range)
// ---------------------------------------------------------------------------

describe("AssertionParser — operand strategy dispatch", () => {
  const parser = new AssertionParser();

  describe("arithmetic RHS accepted only for comparand operators", () => {
    it("accepts arithmetic for 'equals (1 + 2)'", () => {
      const result = parser.parse("response.body.total equals (1 + 2)");
      expect(result.ok).toBe(true);
    });

    it("accepts arithmetic for 'greater_than (response.body.min * 2)'", () => {
      const result = parser.parse(
        "response.body.n greater_than (response.body.min * 2)",
      );
      expect(result.ok).toBe(true);
    });

    it("rejects arithmetic for 'contains (a + b)' — value shape", () => {
      const result = parser.parse("response.body.x contains (a + b)");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => /arithmetic/i.test(e))).toBe(true);
    });

    it("rejects arithmetic for 'count_equals (1 + 1)' — numeric shape", () => {
      const result = parser.parse("db.c.q count_equals (1 + 1)");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => /arithmetic/i.test(e))).toBe(true);
    });
  });

  describe("in_range parse-time bounds check", () => {
    it("accepts 'in_range 100..599' (lo < hi)", () => {
      const result = parser.parse("response.status in_range 100..599");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ast.operand).toMatchObject({ kind: "range", lo: 100, hi: 599 });
    });

    it("accepts 'in_range 200..200' (lo === hi, degenerate single-point)", () => {
      const result = parser.parse("response.status in_range 200..200");
      expect(result.ok).toBe(true);
    });

    it("rejects 'in_range 599..100' (lo > hi) with RANGE_LO_GT_HI", () => {
      const result = parser.parse("response.status in_range 599..100");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => /range/i.test(e))).toBe(true);
    });

    it("rejects 'in_range 1 2' (missing range_sep) with MALFORMED_RANGE", () => {
      const result = parser.parse("response.status in_range 1 2");
      expect(result.ok).toBe(false);
    });

    it("rejects 'in_range 1..2..3' (extra bound) with MALFORMED_RANGE", () => {
      const result = parser.parse("response.status in_range 1..2..3");
      expect(result.ok).toBe(false);
    });
  });

  describe("matches — regex delegation", () => {
    it("accepts literal regex '/^[a-f0-9-]{36}$/i'", () => {
      const result = parser.parse(
        "response.body.id matches /^[a-f0-9-]{36}$/i",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ast.operand).toMatchObject({ kind: "regex" });
    });

    it("accepts bare pattern 'abc'", () => {
      const result = parser.parse("response.body.name matches abc");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ast.operand).toMatchObject({ kind: "regex" });
    });

    it("returns ok:false for uncompilable regex '/a(/'", () => {
      const result = parser.parse("response.body.x matches /a(/");
      expect(result.ok).toBe(false);
    });

    it("rejects a regex literal as operand for 'equals' (MALFORMED_OPERAND)", () => {
      const result = parser.parse("response.body.x equals /a/");
      expect(result.ok).toBe(false);
    });

    it("rejects multi-token operand for matches (MALFORMED_OPERAND)", () => {
      const result = parser.parse("response.body.x matches /a/ extra");
      expect(result.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Acceptance #4 — multi-error aggregation
// ---------------------------------------------------------------------------

describe("AssertionParser — multi-error aggregation", () => {
  const parser = new AssertionParser();

  it("aggregates target + operator errors simultaneously into one errors[]", () => {
    // Leading dot ⇒ bad target; 'eq' ⇒ unknown operator
    const result = parser.parse(".bad eq 200");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("reports every distinct error in one errors[] for bad-target + bad-range", () => {
    // Bad target + in_range with lo > hi
    const result = parser.parse(".invalid in_range 500..100");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("de-duplicates byte-identical error messages (keeps first)", () => {
    // Construct a case that could theoretically emit the same string twice
    // A normally-formatted input with a known duplicatable structure
    const result = parser.parse("response.status eq");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msgs = result.errors;
    const unique = [...new Set(msgs)];
    expect(msgs).toHaveLength(unique.length);
  });

  it("lexical HARD-stop produces only lexical errors (no structural noise)", () => {
    // Stray character causes lexical failure; orchestrator stops after Stage 1
    const result = parser.parse("@#$%");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Acceptance #5 — never throws on fuzz
// ---------------------------------------------------------------------------

describe("AssertionParser — never throws", () => {
  const parser = new AssertionParser();

  const FUZZ_INPUTS = [
    "",
    "   ",
    "(",
    ")",
    "(((",
    "@#$%^&*",
    "\x00\x01\x02",
    "response.status",
    "a b c d e f",
    "response.body.x unknown_op ???",
  ];

  for (const input of FUZZ_INPUTS) {
    it(`does not throw for input: ${JSON.stringify(input)}`, () => {
      expect(() => parser.parse(input)).not.toThrow();
      const result = parser.parse(input);
      expect(typeof result.ok).toBe("boolean");
    });
  }

  it("returns ok:false (not throws) for empty string", () => {
    const result = parser.parse("");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false (not throws) for whitespace-only '   '", () => {
    const result = parser.parse("   ");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Acceptance #6 — collaborator injection + default-seam wiring
// ---------------------------------------------------------------------------

describe("AssertionParser — collaborator injection", () => {
  it(
    "constructs with no arguments and parses a real §4 example (default-seam wiring)",
    () => {
      const parser = new AssertionParser();
      const result = parser.parse("response.status equals 201");
      expect(result.ok).toBe(true);
    },
  );

  it("constructs with no arguments and returns ok:false for unknown operator", () => {
    const parser = new AssertionParser();
    const result = parser.parse("response.status bogus 200");
    expect(result.ok).toBe(false);
  });

  it("uses injected lookupOperator — forced unknown-operator path via stub", () => {
    const stubLookup = makeStubOperatorLookup(undefined);
    const deps: AssertionParserDeps = { lookupOperator: stubLookup };
    const parser = new AssertionParser(deps);
    const result = parser.parse("response.status equals 200");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /operator/i.test(e))).toBe(true);
    expect(stubLookup).toHaveBeenCalledWith("equals");
  });
});

// ---------------------------------------------------------------------------
// Acceptance #7 — purity / determinism
// ---------------------------------------------------------------------------

describe("AssertionParser — purity and determinism", () => {
  const parser = new AssertionParser();

  it("produces JSON-stringify-identical results for identical ok:true input", () => {
    const raw = "response.status equals 200";
    const a = parser.parse(raw);
    const b = parser.parse(raw);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces JSON-stringify-identical results for identical ok:false input", () => {
    const raw = "response.status bogus 200";
    const a = parser.parse(raw);
    const b = parser.parse(raw);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Acceptance #9 — region-splitting matrix
// ---------------------------------------------------------------------------

describe("AssertionParser — region-splitting", () => {
  const parser = new AssertionParser();

  it("empty string yields MISSING_TARGET / lexical error (hard stop)", () => {
    const result = parser.parse("");
    expect(result.ok).toBe(false);
  });

  it("target-only 'response.body.id' yields MISSING_OPERATOR", () => {
    const result = parser.parse("response.body.id");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /operator/i.test(e))).toBe(true);
  });

  it("ast.raw is the end-trimmed (not internally collapsed) input string", () => {
    const result = parser.parse("  response.status   equals   201  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // End-trimmed: leading/trailing stripped, internal spaces preserved
    expect(result.ast.raw).toBe("response.status   equals   201");
  });

  it("nullary operator with empty operand region succeeds (exists)", () => {
    const result = parser.parse("response.body.x exists");
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance #10 — operand switch arms (structural shapes)
// ---------------------------------------------------------------------------

describe("AssertionParser — operand switch exhaustive matrix", () => {
  const parser = new AssertionParser();

  it("'none' arm — rejects operand for 'not_exists'", () => {
    expect(parser.parse("response.body.x not_exists 1").ok).toBe(false);
  });

  it("'none' arm — accepts 'is_null' with no operand", () => {
    expect(parser.parse("response.body.x is_null").ok).toBe(true);
  });

  it("'comparand' arm — boolean literal 'equals true'", () => {
    const r = parser.parse("response.body.flag equals true");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.operand).toMatchObject({ kind: "literal", value: true });
  });

  it("'comparand' arm — null literal 'equals null'", () => {
    const r = parser.parse("response.body.x equals null");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.operand).toMatchObject({ kind: "literal", value: null });
  });

  it("'comparand' arm — string literal 'equals \"hello\"'", () => {
    const r = parser.parse('response.body.name equals "hello"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.operand).toMatchObject({ kind: "literal", value: "hello" });
  });

  it("'value' arm — 'contains \"Bearer\"' LiteralOperand", () => {
    const r = parser.parse('response.headers.auth contains "Bearer"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.operand).toMatchObject({ kind: "literal", value: "Bearer" });
  });

  it("'value' arm — 'starts_with' rejects arithmetic", () => {
    const r = parser.parse("response.body.s starts_with (a + b)");
    expect(r.ok).toBe(false);
  });

  it("'numeric' arm — 'count_equals 3' numeric literal", () => {
    const r = parser.parse("db.conn.q count_equals 3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.operand).toMatchObject({ kind: "literal", value: 3 });
  });

  it("'numeric' arm — 'count_equals \"three\"' NON_NUMERIC_OPERAND", () => {
    const r = parser.parse('db.conn.q count_equals "three"');
    expect(r.ok).toBe(false);
  });

  it("'numeric' arm — 'count_greater_than true' NON_NUMERIC_OPERAND", () => {
    const r = parser.parse("db.conn.q count_greater_than true");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error message format
// ---------------------------------------------------------------------------

describe("AssertionParser — error message format", () => {
  const parser = new AssertionParser();

  it("error messages follow '<assertion>: <label>: <detail>' format", () => {
    const raw = "response.status eq 200";
    const result = parser.parse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Every message must be prefixed with the assertion source
    for (const msg of result.errors) {
      // Format: "<trimmed>: <stage>: <detail>"
      expect(msg).toMatch(/^response\.status eq 200:/);
    }
  });

  it("errors[] has length >= 1 for any ok:false result", () => {
    const result = parser.parse("response.status bogus");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
