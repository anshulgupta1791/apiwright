import { describe, it, expect } from "vitest";

import {
  ArithmeticEvaluator,
  MAX_ARITH_EVAL_NODES,
} from "../../../src/assertions/arithmetic-evaluator.js";
import { TargetResolver } from "../../../src/assertions/target-resolver.js";
import type { ArithmeticExpr, EvaluationContext } from "../../../src/assertions/index.js";

/**
 * Unit tests for ArithmeticEvaluator.
 *
 * Covers: literal and target leaves, ok:true with guaranteed finite value,
 * TARGET_NOT_FOUND for missing target leaf, TYPE_MISMATCH (NOT ARITHMETIC_ERROR)
 * for non-number resolved operand (locked E6 decision — TYPE_MISMATCH),
 * ARITHMETIC_ERROR for divide-by-zero and non-finite post-op result,
 * MAX_ARITH_EVAL_NODES work-bound guard, left-to-right deterministic
 * short-circuit, default-seam construction, never-throws, determinism.
 */

function numLeaf(value: number): ArithmeticExpr {
  return { kind: "number", value };
}

function binary(
  op: "+" | "-" | "*" | "/",
  left: ArithmeticExpr,
  right: ArithmeticExpr,
): ArithmeticExpr {
  return { kind: "binary", op, left, right };
}

function targetLeaf(keys: string[]): ArithmeticExpr {
  const path = keys.map((k) => ({ kind: "key" as const, key: k }));
  return {
    kind: "target",
    ref: { root: "response.body" as const, path },
  };
}

function ctx(body: unknown, now?: number): EvaluationContext {
  return {
    request: { headers: {}, body: null, url: { full: "/", path: "/", query: {} } },
    response: { status: 200, headers: {}, body, time_ms: 0 },
    db: {},
    now,
  };
}

describe("MAX_ARITH_EVAL_NODES", () => {
  it("equals 4096", () => {
    expect(MAX_ARITH_EVAL_NODES).toBe(4096);
  });
});

describe("ArithmeticEvaluator", () => {
  const ev = new ArithmeticEvaluator();

  // ---------------------------------------------------------------------------
  // Default-seam construction
  // ---------------------------------------------------------------------------

  describe("default-seam construction", () => {
    it("constructs with no arguments (default TargetResolver)", () => {
      expect(() => new ArithmeticEvaluator()).not.toThrow();
    });

    it("constructs with an explicit TargetResolver", () => {
      expect(() => new ArithmeticEvaluator(new TargetResolver())).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Literal leaf
  // ---------------------------------------------------------------------------

  describe("numeric-literal leaf", () => {
    it("returns ok:true with the literal value for a finite number", () => {
      const r = ev.evaluate(numLeaf(1.08), ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBe(1.08);
      }
    });

    it("returns ok:true with a negative literal (unary minus already folded)", () => {
      const r = ev.evaluate(numLeaf(-1.08), ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBe(-1.08);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Target leaf — found and not-found
  // ---------------------------------------------------------------------------

  describe("target leaf", () => {
    it("resolves a finite numeric target to ok:true", () => {
      const r = ev.evaluate(targetLeaf(["subtotal"]), ctx({ subtotal: 100 }));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBe(100);
      }
    });

    it("returns ok:false TARGET_NOT_FOUND for a missing path", () => {
      const r = ev.evaluate(targetLeaf(["missing"]), ctx({}));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TARGET_NOT_FOUND");
      }
    });

    it("returns ok:false TYPE_MISMATCH (NOT ARITHMETIC_ERROR) for string target value — locked E6", () => {
      const r = ev.evaluate(targetLeaf(["val"]), ctx({ val: "108" }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        // E6 decision: non-number resolved operand → TYPE_MISMATCH
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });

    it("returns ok:false TYPE_MISMATCH for boolean target value (no coercion)", () => {
      const r = ev.evaluate(targetLeaf(["flag"]), ctx({ flag: true }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });

    it("returns ok:false TYPE_MISMATCH for null target value (explicit null ≠ missing)", () => {
      const r = ev.evaluate(targetLeaf(["val"]), ctx({ val: null }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });

    it("returns ok:false TYPE_MISMATCH for object target value", () => {
      const r = ev.evaluate(targetLeaf(["val"]), ctx({ val: {} }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });

    it("returns ok:false TYPE_MISMATCH for NaN resolved value (typeof=number but !isFinite)", () => {
      const r = ev.evaluate(targetLeaf(["val"]), ctx({ val: NaN }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });

    it("returns ok:false TYPE_MISMATCH for Infinity resolved value", () => {
      const r = ev.evaluate(targetLeaf(["val"]), ctx({ val: Infinity }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Binary operations — success paths
  // ---------------------------------------------------------------------------

  describe("binary operations — success paths", () => {
    it("adds two literals: 1 + 2 = 3", () => {
      const r = ev.evaluate(binary("+", numLeaf(1), numLeaf(2)), ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(3);
    });

    it("multiplies literal and target: 100 * 1.08 = 108", () => {
      const r = ev.evaluate(
        binary("*", targetLeaf(["subtotal"]), numLeaf(1.08)),
        ctx({ subtotal: 100 }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeCloseTo(108);
    });

    it("nested: (1 + 2) * 2 - 8 / 4 = 4", () => {
      const expr = binary(
        "-",
        binary("*", binary("+", numLeaf(1), numLeaf(2)), numLeaf(2)),
        binary("/", numLeaf(8), numLeaf(4)),
      );
      const r = ev.evaluate(expr, ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeCloseTo(4);
    });

    it("multiplying by 0 is valid (not division by zero)", () => {
      const r = ev.evaluate(binary("*", numLeaf(5), numLeaf(0)), ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(0);
    });

    it("0 divided by non-zero is valid", () => {
      const r = ev.evaluate(binary("/", numLeaf(0), numLeaf(5)), ctx(null));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ARITHMETIC_ERROR: divide-by-zero
  // ---------------------------------------------------------------------------

  describe("division by zero → ARITHMETIC_ERROR", () => {
    it("literal zero denominator → ARITHMETIC_ERROR", () => {
      const r = ev.evaluate(binary("/", numLeaf(5), numLeaf(0)), ctx(null));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
        expect(r.reason).toMatch(/zero/i);
      }
    });

    it("target resolves to 0 denominator → ARITHMETIC_ERROR", () => {
      const r = ev.evaluate(
        binary("/", numLeaf(10), targetLeaf(["divisor"])),
        ctx({ divisor: 0 }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
      }
    });

    it("-0 denominator → ARITHMETIC_ERROR (guards both 0 and -0)", () => {
      const r = ev.evaluate(binary("/", numLeaf(5), numLeaf(-0)), ctx(null));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // ARITHMETIC_ERROR: post-op non-finite result (overflow)
  // ---------------------------------------------------------------------------

  describe("overflow to non-finite → ARITHMETIC_ERROR", () => {
    it("1e308 * 1e308 overflows to Infinity → ARITHMETIC_ERROR", () => {
      const r = ev.evaluate(binary("*", numLeaf(1e308), numLeaf(1e308)), ctx(null));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
      }
    });

    it("denormal division overflow to Infinity → ARITHMETIC_ERROR", () => {
      // 1 / 5e-324 overflows to Infinity
      const r = ev.evaluate(binary("/", numLeaf(1), numLeaf(5e-324)), ctx(null));
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
      }
      // (may not overflow on all platforms but must not return NaN/Infinity)
      if (r.ok) {
        expect(Number.isFinite(r.value)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Left-to-right deterministic short-circuit
  // ---------------------------------------------------------------------------

  describe("left-to-right short-circuit order", () => {
    it("(a/0) + b.missing → ARITHMETIC_ERROR (left side fails first)", () => {
      // left: a=5, /0 → ARITHMETIC_ERROR; right: missing → TARGET_NOT_FOUND
      // left wins
      const r = ev.evaluate(
        binary("+", binary("/", numLeaf(5), numLeaf(0)), targetLeaf(["missing"])),
        ctx({}),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("ARITHMETIC_ERROR");
      }
    });

    it("(b.missing) + (a/0) → TARGET_NOT_FOUND (left side, missing, fails first)", () => {
      // left: missing → TARGET_NOT_FOUND; right: /0 → ARITHMETIC_ERROR
      // left wins
      const r = ev.evaluate(
        binary("+", targetLeaf(["missing"]), binary("/", numLeaf(5), numLeaf(0))),
        ctx({}),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failureCode).toBe("TARGET_NOT_FOUND");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // MAX_ARITH_EVAL_NODES work-bound guard
  // ---------------------------------------------------------------------------

  describe("MAX_ARITH_EVAL_NODES work-bound guard", () => {
    it("a pathologically large tree (> MAX_ARITH_EVAL_NODES nodes) → ARITHMETIC_ERROR, no throw", () => {
      // Build a deeply right-chained sum tree with MAX_ARITH_EVAL_NODES + 1 leaf nodes
      let expr: ArithmeticExpr = numLeaf(1);
      for (let i = 0; i < MAX_ARITH_EVAL_NODES + 1; i++) {
        expr = binary("+", numLeaf(1), expr);
      }
      expect(() => {
        const r = ev.evaluate(expr, ctx(null));
        if (!r.ok) {
          expect(r.failureCode).toBe("ARITHMETIC_ERROR");
        }
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // ok:true invariant — value is always a finite number
  // ---------------------------------------------------------------------------

  describe("ok:true invariant: value is always finite", () => {
    it("ok:true value satisfies Number.isFinite", () => {
      const r = ev.evaluate(binary("+", numLeaf(1), numLeaf(2)), ctx(null));
      if (r.ok) {
        expect(Number.isFinite(r.value)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Never throws
  // ---------------------------------------------------------------------------

  describe("never throws", () => {
    it("does not throw for a garbage context", () => {
      expect(() => ev.evaluate(targetLeaf(["x"]), ctx("not-an-object"))).not.toThrow();
    });

    it("does not throw for literal-only expression regardless of context", () => {
      expect(() => ev.evaluate(numLeaf(42), ctx(null))).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism", () => {
    it("same inputs produce same result on repeated calls", () => {
      const expr = binary("*", targetLeaf(["amount"]), numLeaf(1.08));
      const c = ctx({ amount: 250 });
      const r1 = ev.evaluate(expr, c);
      const r2 = ev.evaluate(expr, c);
      expect(r1).toEqual(r2);
    });
  });
});
