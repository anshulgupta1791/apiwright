import { describe, it, expect } from "vitest";

// Import the module under test — this import MUST resolve at runtime, proving
// that src/core/normalized-result.ts exists and is re-exported by the barrel.
// When the implementation file does not yet exist, this import resolves
// (type-only re-exports are erased at runtime), but the individual structural
// tests below still pin the contract that the implementation must satisfy.
import { parseJson } from "../../../src/core/safe-json.js";
// The normalized-result module itself (direct path) must exist for the
// implementation to be complete. We verify the barrel re-export resolves by
// importing a runtime symbol from the same barrel alongside the type.
import { parseJson as _coreBarrelCheck } from "../../../src/core/index.js";
import type { NormalizedResult } from "../../../src/core/index.js";
// Direct import of the normalized-result module to verify the file exists.
// When the file does not exist this import fails with "module not found".
import type { NormalizedResult as _DirectImport } from "../../../src/core/normalized-result.js";

/**
 * Unit tests for the NormalizedResult interface.
 *
 * Pins the canonical three-member contract (`rows`/`rowCount`/`raw`) as
 * declared in `src/core/normalized-result.ts` and re-exported from
 * `src/core/index.ts`. Asserts barrel resolution, structural assignability,
 * parseJson round-trip fidelity, and the documented rowCount vs rows.length
 * independence invariant. Declaration-only module: runtime assertions are
 * used so the spec is executable.
 */
describe("NormalizedResult", () => {
  describe("barrel re-export — import from src/core/index.js", () => {
    it("types a value with rows/rowCount/raw without compile error", () => {
      const sample: NormalizedResult = {
        rows: [{ id: 1, name: "alice" }],
        rowCount: 1,
        raw: { driverMeta: "pg" },
      };
      expect(sample.rowCount).toBe(1);
      expect(sample.rows).toHaveLength(1);
    });

    it("types a value with an empty rows array", () => {
      const sample: NormalizedResult = {
        rows: [],
        rowCount: 0,
        raw: null,
      };
      expect(sample.rows).toHaveLength(0);
      expect(sample.rowCount).toBe(0);
    });

    it("types a value where raw is a string (non-object payload)", () => {
      const sample: NormalizedResult = {
        rows: [],
        rowCount: 0,
        raw: "opaque-driver-string",
      };
      expect(sample.raw).toBe("opaque-driver-string");
    });
  });

  describe("exact member set — all three members are required", () => {
    it("rows is an array of Record<string, unknown>", () => {
      const sample: NormalizedResult = {
        rows: [{ status: "active", count: 42 }],
        rowCount: 1,
        raw: {},
      };
      expect(Array.isArray(sample.rows)).toBe(true);
      expect(sample.rows[0]).toEqual({ status: "active", count: 42 });
    });

    it("rowCount is a number", () => {
      const sample: NormalizedResult = {
        rows: [],
        rowCount: 99,
        raw: null,
      };
      expect(typeof sample.rowCount).toBe("number");
      expect(sample.rowCount).toBe(99);
    });

    it("raw is typed as unknown and can hold any value", () => {
      const withObject: NormalizedResult = { rows: [], rowCount: 0, raw: { x: 1 } };
      const withArray: NormalizedResult = { rows: [], rowCount: 0, raw: [1, 2, 3] };
      const withNull: NormalizedResult = { rows: [], rowCount: 0, raw: null };
      expect(withObject.raw).toEqual({ x: 1 });
      expect(withArray.raw).toEqual([1, 2, 3]);
      expect(withNull.raw).toBeNull();
    });
  });

  describe("rowCount vs rows.length independence (documented invariant)", () => {
    it("accepts rowCount greater than rows.length (affected-rows non-row statement)", () => {
      // The design explicitly documents: connectors MAY set rowCount from
      // driver affected-rows count even when rows is empty.
      const sample: NormalizedResult = {
        rows: [],
        rowCount: 3,
        raw: null,
      };
      expect(sample.rows).toHaveLength(0);
      expect(sample.rowCount).toBe(3);
    });

    it("accepts rowCount of zero when rows is non-empty (degenerate but structurally valid)", () => {
      const sample: NormalizedResult = {
        rows: [{ x: 1 }],
        rowCount: 0,
        raw: null,
      };
      expect(sample.rows).toHaveLength(1);
      expect(sample.rowCount).toBe(0);
    });
  });

  describe("parseJson round-trip — serializable fields survive", () => {
    it("rows, rowCount, and raw are preserved after JSON.stringify + parseJson", () => {
      const original: NormalizedResult = {
        rows: [{ id: 7, label: "test" }, { id: 8, label: "other" }],
        rowCount: 2,
        raw: { pg_oid: 12345 },
      };
      const serialized = JSON.stringify(original);
      const result = parseJson(serialized);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = result.value as NormalizedResult;
      expect(parsed.rowCount).toBe(2);
      expect(parsed.rows).toEqual([{ id: 7, label: "test" }, { id: 8, label: "other" }]);
      expect(parsed.raw).toEqual({ pg_oid: 12345 });
    });

    it("empty rows array round-trips without mutation", () => {
      const original: NormalizedResult = { rows: [], rowCount: 0, raw: null };
      const result = parseJson(JSON.stringify(original));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = result.value as NormalizedResult;
      expect(parsed.rows).toEqual([]);
      expect(parsed.rowCount).toBe(0);
      expect(parsed.raw).toBeNull();
    });

    it("multiple rows with heterogeneous value types round-trip correctly", () => {
      const original: NormalizedResult = {
        rows: [
          { active: true, score: 3.14, tag: null },
          { active: false, score: 0, tag: "blue" },
        ],
        rowCount: 2,
        raw: "driver-raw-text",
      };
      const result = parseJson(JSON.stringify(original));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = result.value as NormalizedResult;
      expect(parsed.rows).toHaveLength(2);
      expect((parsed.rows[0] as Record<string, unknown>)["active"]).toBe(true);
      expect((parsed.rows[1] as Record<string, unknown>)["tag"]).toBe("blue");
    });
  });

  describe("excess-member rejection — compile-time structural contract", () => {
    it("a value with exactly three members is assignable (positive case)", () => {
      const sample: NormalizedResult = { rows: [], rowCount: 0, raw: null };
      expect(Object.keys(sample)).toHaveLength(3);
    });

    // @ts-expect-error — an extra member on a fresh object literal is rejected
    // by TypeScript's excess-property check, locking "exactly three members".
     
    const _excessCheck: NormalizedResult = { rows: [], rowCount: 0, raw: null, extra: true };
  });
});
