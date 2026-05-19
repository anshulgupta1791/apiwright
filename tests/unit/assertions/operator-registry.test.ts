import { describe, it, expect } from "vitest";

import {
  OPERATOR_REGISTRY,
  OPERATOR_COUNT,
  lookupOperator,
  isOperatorName,
  allOperatorNames,
} from "../../../src/assertions/operator-registry.js";

/**
 * Unit tests for the assertions operator registry.
 *
 * Covers: exact membership (all 20 Layer-A OperatorName literals), per-row
 * metadata (group/operandShape/allowsArithmeticRhs), derived-arity cross-check,
 * group/flag invariant, key↔name identity, lookupOperator hit/miss/no-throw,
 * isOperatorName guard, frozen/read-only, OPERATOR_COUNT sanity.
 *
 * The registry is pure data + lookup. No evaluation or parsing logic is tested
 * here. The exact operator count is driven by the Layer-A OperatorName union;
 * the test table matches the design's 20 named operators.
 */

// The full set of Layer-A OperatorName literals — the source of truth the
// registry is type-bound to reproduce exactly.
const EXPECTED_NAMES = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "in_range",
  "matches",
  "contains",
  "starts_with",
  "ends_with",
  "exists",
  "not_exists",
  "is_null",
  "is_not_null",
  "is_uuid_v4",
  "is_iso_timestamp",
  "is_recent_timestamp",
  "is_email",
  "is_url",
  "count_equals",
  "count_greater_than",
] as const;

// Per-row table: [name, group, operandShape, allowsArithmeticRhs, arity].
// Arity is derived: none→0, range→2, else→1.
const ROW_TABLE = [
  ["equals", "comparison", "comparand", true, 1],
  ["not_equals", "comparison", "comparand", true, 1],
  ["greater_than", "comparison", "comparand", true, 1],
  ["less_than", "comparison", "comparand", true, 1],
  ["in_range", "comparison", "range", true, 2],
  ["matches", "pattern", "regex", false, 1],
  ["contains", "pattern", "value", false, 1],
  ["starts_with", "pattern", "value", false, 1],
  ["ends_with", "pattern", "value", false, 1],
  ["exists", "existence", "none", false, 0],
  ["not_exists", "existence", "none", false, 0],
  ["is_null", "existence", "none", false, 0],
  ["is_not_null", "existence", "none", false, 0],
  ["is_uuid_v4", "format", "none", false, 0],
  ["is_iso_timestamp", "format", "none", false, 0],
  ["is_recent_timestamp", "format", "none", false, 0],
  ["is_email", "format", "none", false, 0],
  ["is_url", "format", "none", false, 0],
  ["count_equals", "aggregate", "numeric", false, 1],
  ["count_greater_than", "aggregate", "numeric", false, 1],
] as const;

// ---- 1. Exact membership ------------------------------------------------
describe("OPERATOR_REGISTRY — exact membership", () => {
  it("allOperatorNames() returns exactly the expected operators", () => {
    const names = allOperatorNames();
    expect([...names].sort()).toEqual([...EXPECTED_NAMES].sort());
  });

  it("allOperatorNames() length matches the expected names array", () => {
    expect(allOperatorNames().length).toBe(EXPECTED_NAMES.length);
  });

  it("contains no extra operators beyond the expected set", () => {
    const registryKeys = Object.keys(OPERATOR_REGISTRY).sort();
    expect(registryKeys).toEqual([...EXPECTED_NAMES].sort());
  });
});

// ---- 2. Per-row metadata (table-driven) ---------------------------------
describe("OPERATOR_REGISTRY — per-row metadata", () => {
  for (const [name, group, operandShape, allowsArithmeticRhs] of ROW_TABLE) {
    it(`${name} has correct group, operandShape, allowsArithmeticRhs, and name field`, () => {
      const meta = OPERATOR_REGISTRY[name];
      expect(meta.name).toBe(name);
      expect(meta.group).toBe(group);
      expect(meta.operandShape).toBe(operandShape);
      expect(meta.allowsArithmeticRhs).toBe(allowsArithmeticRhs);
    });

    it(`lookupOperator("${name}") returns the same descriptor as the registry`, () => {
      const via_lookup = lookupOperator(name);
      expect(via_lookup).toBe(OPERATOR_REGISTRY[name]);
    });
  }
});

// ---- 3. Derived-arity cross-check (honours the spec's 0/1/2 wording) ---
describe("OPERATOR_REGISTRY — derived-arity cross-check", () => {
  function shapeToArity(shape: string): number {
    if (shape === "none") return 0;
    if (shape === "range") return 2;
    return 1;
  }

  for (const [name, , operandShape, , expectedArity] of ROW_TABLE) {
    it(`${name} operandShape "${operandShape}" maps to arity ${expectedArity}`, () => {
      expect(shapeToArity(operandShape)).toBe(expectedArity);
    });
  }
});

// ---- 4. Group/flag invariant -------------------------------------------
describe("OPERATOR_REGISTRY — group/allowsArithmeticRhs invariant", () => {
  it("allowsArithmeticRhs is true iff group is comparison — for every row", () => {
    for (const key of allOperatorNames()) {
      const meta = OPERATOR_REGISTRY[key];
      expect(meta.allowsArithmeticRhs).toBe(meta.group === "comparison");
    }
  });

  it("comparison operators all have allowsArithmeticRhs true", () => {
    const comparisonOps = allOperatorNames().filter(
      (k) => OPERATOR_REGISTRY[k].group === "comparison"
    );
    for (const op of comparisonOps) {
      expect(OPERATOR_REGISTRY[op].allowsArithmeticRhs).toBe(true);
    }
  });

  it("non-comparison operators all have allowsArithmeticRhs false", () => {
    const nonComparison = allOperatorNames().filter(
      (k) => OPERATOR_REGISTRY[k].group !== "comparison"
    );
    for (const op of nonComparison) {
      expect(OPERATOR_REGISTRY[op].allowsArithmeticRhs).toBe(false);
    }
  });
});

// ---- 5. Key↔name identity -----------------------------------------------
describe("OPERATOR_REGISTRY — key equals value.name for every row", () => {
  it("every registry key matches its value.name field", () => {
    for (const key of allOperatorNames()) {
      expect(OPERATOR_REGISTRY[key].name).toBe(key);
    }
  });
});

// ---- 6. lookupOperator — hit and miss -----------------------------------
describe("lookupOperator()", () => {
  it("returns the descriptor for a known operator", () => {
    const result = lookupOperator("equals");
    expect(result).toBeDefined();
    expect(result?.name).toBe("equals");
  });

  it("returns undefined for a misspelled operator — never throws", () => {
    expect(() => lookupOperator("euqals")).not.toThrow();
    expect(lookupOperator("euqals")).toBeUndefined();
  });

  it("returns undefined for an empty string — never throws", () => {
    expect(() => lookupOperator("")).not.toThrow();
    expect(lookupOperator("")).toBeUndefined();
  });

  it("returns undefined for a whitespace-only string — never throws", () => {
    expect(() => lookupOperator("  ")).not.toThrow();
    expect(lookupOperator("  ")).toBeUndefined();
  });

  it("returns undefined for UPPERCASE variant — case-sensitive, never throws", () => {
    expect(() => lookupOperator("EQUALS")).not.toThrow();
    expect(lookupOperator("EQUALS")).toBeUndefined();
  });

  it("returns undefined for a truncated alias — never throws", () => {
    expect(() => lookupOperator("equal")).not.toThrow();
    expect(lookupOperator("equal")).toBeUndefined();
  });

  it("returns undefined for a completely unknown string", () => {
    expect(lookupOperator("unknown_operator_xyz")).toBeUndefined();
  });
});

// ---- 7. isOperatorName guard --------------------------------------------
describe("isOperatorName()", () => {
  it("returns true for a known operator", () => {
    expect(isOperatorName("equals")).toBe(true);
  });

  it("returns true for every expected operator name (table-driven)", () => {
    for (const name of EXPECTED_NAMES) {
      expect(isOperatorName(name)).toBe(true);
    }
  });

  it("returns false for an unknown string", () => {
    expect(isOperatorName("nope")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isOperatorName("")).toBe(false);
  });

  it("returns false for a near-miss with different case", () => {
    expect(isOperatorName("Equals")).toBe(false);
  });
});

// ---- 8. Frozen / read-only ----------------------------------------------
describe("OPERATOR_REGISTRY — frozen and read-only", () => {
  it("Object.isFrozen returns true", () => {
    expect(Object.isFrozen(OPERATOR_REGISTRY)).toBe(true);
  });

  it("cannot add a new property — property remains absent after attempt", () => {
    const reg = OPERATOR_REGISTRY as Record<string, unknown>;
    try {
      reg["new_op"] = { name: "new_op" };
    } catch {
      // TypeError in strict mode — acceptable; property must be absent
    }
    expect("new_op" in OPERATOR_REGISTRY).toBe(false);
  });

  it("cannot overwrite an existing property — value unchanged", () => {
    const reg = OPERATOR_REGISTRY as Record<string, unknown>;
    const original = OPERATOR_REGISTRY["equals"];
    try {
      reg["equals"] = null;
    } catch {
      // TypeError in strict mode — acceptable
    }
    expect(OPERATOR_REGISTRY["equals"]).toBe(original);
  });
});

// ---- 9. OPERATOR_COUNT sanity -------------------------------------------
describe("OPERATOR_COUNT", () => {
  it("equals the length of the expected names array — not a bare magic number", () => {
    expect(OPERATOR_COUNT).toBe(EXPECTED_NAMES.length);
  });

  it("equals the number of keys in the registry", () => {
    expect(OPERATOR_COUNT).toBe(Object.keys(OPERATOR_REGISTRY).length);
  });
});
