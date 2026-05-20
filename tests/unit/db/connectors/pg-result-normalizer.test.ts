import { describe, it, expect } from "vitest";

import { mapPgResult } from "../../../../src/db/connectors/pg-result-normalizer.js";
import type { PgQueryResult } from "../../../../src/db/drivers/postgres-seam.js";
import type { NormalizedResult } from "../../../../src/core/normalized-result.js";

/**
 * Unit tests for mapPgResult (src/db/connectors/pg-result-normalizer.ts).
 *
 * Pure function — no seam, no DB. Covers: multi-row SELECT rows-as-is/rowCount;
 * zero-row SELECT; DDL with rowCount:null → rowCount=rows.length=0; DML
 * affectedRows; INSERT RETURNING; D4 pass-through pins (Date/bigint-string/
 * numeric-string/null verbatim); raw === pg identity; defensive non-array rows
 * → [].
 *
 * RED PHASE: src/db/connectors/pg-result-normalizer.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakePgResult(rows: Record<string, unknown>[], rowCount: number | null): PgQueryResult {
  return { rows, rowCount };
}

// ---------------------------------------------------------------------------
// Multi-row SELECT
// ---------------------------------------------------------------------------

describe("mapPgResult", () => {
  describe("multi-row SELECT — rows as-is, rowCount from driver", () => {
    it("passes rows verbatim (same reference equality / values)", () => {
      const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
      const pg = fakePgResult(rows, 2);
      const result: NormalizedResult = mapPgResult(pg);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: 1, name: "Alice" });
      expect(result.rows[1]).toEqual({ id: 2, name: "Bob" });
    });

    it("rowCount equals the pg.rowCount value", () => {
      const pg = fakePgResult([{ id: 1 }, { id: 2 }], 2);
      const result = mapPgResult(pg);
      expect(result.rowCount).toBe(2);
    });

    it("raw is the exact pg object (identity)", () => {
      const pg = fakePgResult([{ id: 1 }], 1);
      const result = mapPgResult(pg);
      expect(result.raw).toBe(pg);
    });
  });

  // ---------------------------------------------------------------------------
  // Zero-row SELECT
  // ---------------------------------------------------------------------------

  describe("zero-row SELECT — rows:[], rowCount:0", () => {
    it("produces rows:[] and rowCount:0 for empty SELECT result", () => {
      const pg = fakePgResult([], 0);
      const result = mapPgResult(pg);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // DDL / command with rowCount:null → rowCount = rows.length = 0
  // ---------------------------------------------------------------------------

  describe("DDL/utility command with rowCount:null → rowCount = rows.length", () => {
    it("maps rowCount:null to 0 when rows is empty (CREATE TABLE / SET)", () => {
      const pg = fakePgResult([], null);
      const result = mapPgResult(pg);
      expect(result.rowCount).toBe(0);
      expect(result.rowCount).not.toBeNull();
    });

    it("maps rowCount:null to rows.length when rows is non-empty (edge case)", () => {
      // Unlikely in practice but the ?? rows.length formula handles it correctly
      const pg = fakePgResult([{ col: 1 }, { col: 2 }], null);
      const result = mapPgResult(pg);
      expect(result.rowCount).toBe(2);
    });

    it("rowCount is always a number, never null or undefined", () => {
      const pg = fakePgResult([], null);
      const result = mapPgResult(pg);
      expect(typeof result.rowCount).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // DML affected rows
  // ---------------------------------------------------------------------------

  describe("DML — affected rowCount surfaced in rowCount", () => {
    it("UPDATE/DELETE: rows=[], rowCount=N from pg.rowCount", () => {
      const pg = fakePgResult([], 5);
      const result = mapPgResult(pg);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // INSERT ... RETURNING
  // ---------------------------------------------------------------------------

  describe("INSERT RETURNING — rows present, rowCount from driver", () => {
    it("passes rows and rowCount correctly for INSERT RETURNING", () => {
      const rows = [{ id: 42, created_at: "2024-01-01" }];
      const pg = fakePgResult(rows, 1);
      const result = mapPgResult(pg);
      expect(result.rows).toHaveLength(1);
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]).toEqual(rows[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // D4 pass-through pins — ZERO coercion
  // ---------------------------------------------------------------------------

  describe("D4 pass-through — cell values verbatim, no coercion", () => {
    it("Date cell stays as a Date instance (not coerced to ISO string)", () => {
      const date = new Date("2024-06-15T12:00:00Z");
      const pg = fakePgResult([{ created_at: date }], 1);
      const result = mapPgResult(pg);
      expect(result.rows[0]["created_at"]).toBeInstanceOf(Date);
      expect(result.rows[0]["created_at"]).toBe(date);
    });

    it("bigint/numeric-as-string cell stays as a string (not coerced to number)", () => {
      const bigNumStr = "9007199254740993"; // beyond Number.MAX_SAFE_INTEGER
      const pg = fakePgResult([{ big_id: bigNumStr }], 1);
      const result = mapPgResult(pg);
      expect(result.rows[0]["big_id"]).toBe(bigNumStr);
      expect(typeof result.rows[0]["big_id"]).toBe("string");
    });

    it("null cell stays null (not coerced to undefined)", () => {
      const pg = fakePgResult([{ optional_field: null }], 1);
      const result = mapPgResult(pg);
      expect(result.rows[0]["optional_field"]).toBeNull();
    });

    it("JS bigint cell is left untouched", () => {
      const big = BigInt("9007199254740993");
      const pg = fakePgResult([{ big_col: big }], 1);
      const result = mapPgResult(pg);
      expect(result.rows[0]["big_col"]).toBe(big);
    });

    it("JSON-as-string cell is not parsed (left as string)", () => {
      const jsonStr = '{"key":"value"}';
      const pg = fakePgResult([{ json_col: jsonStr }], 1);
      const result = mapPgResult(pg);
      expect(result.rows[0]["json_col"]).toBe(jsonStr);
      expect(typeof result.rows[0]["json_col"]).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // raw identity
  // ---------------------------------------------------------------------------

  describe("raw is the exact pg driver result (identity, not a clone)", () => {
    it("raw === the pg argument object passed in", () => {
      const pg = fakePgResult([{ x: 1 }], 1);
      const result = mapPgResult(pg);
      expect(result.raw).toBe(pg);
    });

    it("raw is still the original pg object even on rowCount:null path", () => {
      const pg = fakePgResult([], null);
      const result = mapPgResult(pg);
      expect(result.raw).toBe(pg);
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive: non-array rows → []
  // ---------------------------------------------------------------------------

  describe("defensive: non-array rows input → rows:[] (backstop)", () => {
    it("non-array pg.rows is coalesced to [] to keep NormalizedResult well-formed", () => {
      // This is contract-impossible per the seam design but the backstop must run
      const pg = { rows: null as unknown as Record<string, unknown>[], rowCount: 0 };
      const result = mapPgResult(pg);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows).toHaveLength(0);
    });
  });
});
