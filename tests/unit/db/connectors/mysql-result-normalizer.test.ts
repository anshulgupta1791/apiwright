import { describe, it, expect } from "vitest";

import { mapMysqlResult } from "../../../../src/db/connectors/mysql-result-normalizer.js";
import type { MysqlQueryResult } from "../../../../src/db/drivers/mysql-seam.js";
import type { NormalizedResult } from "../../../../src/core/normalized-result.js";

/**
 * Unit tests for mapMysqlResult (src/db/connectors/mysql-result-normalizer.ts).
 *
 * Pure function — no seam, no DB. Covers: SELECT arm rows-as-is/rowCount=rows.length;
 * zero-row SELECT; OK arm DML with affectedRows; OK arm DDL with absent/null/0
 * affectedRows → rowCount=0; D4 pass-through pins (Date/DECIMAL-string/Buffer/null);
 * raw=my identity on both arms; defensive non-array rows on "rows" arm → [].
 *
 * RED PHASE: src/db/connectors/mysql-result-normalizer.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowsArm(rows: Record<string, unknown>[]): MysqlQueryResult {
  return { kind: "rows", rows };
}

function okArm(affectedRows?: number): MysqlQueryResult {
  return affectedRows !== undefined
    ? { kind: "ok", affectedRows }
    : { kind: "ok" } as MysqlQueryResult;
}

// ---------------------------------------------------------------------------
// "rows" arm — SELECT / SHOW / DESCRIBE
// ---------------------------------------------------------------------------

describe("mapMysqlResult", () => {
  describe("rows arm — SELECT/SHOW/DESCRIBE", () => {
    it("passes rows verbatim for multi-row SELECT", () => {
      const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
      const my = rowsArm(rows);
      const result: NormalizedResult = mapMysqlResult(my);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: 1, name: "Alice" });
    });

    it("rowCount equals rows.length for multi-row SELECT", () => {
      const my = rowsArm([{ id: 1 }, { id: 2 }]);
      const result = mapMysqlResult(my);
      expect(result.rowCount).toBe(2);
    });

    it("zero-row SELECT: rows=[], rowCount=0", () => {
      const my = rowsArm([]);
      const result = mapMysqlResult(my);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
    });

    it("raw === the entire my object (identity)", () => {
      const my = rowsArm([{ id: 1 }]);
      const result = mapMysqlResult(my);
      expect(result.raw).toBe(my);
    });

    it("D4: Date cell in rows stays a Date instance (no string coercion)", () => {
      const date = new Date("2024-06-01T00:00:00Z");
      const my = rowsArm([{ created_at: date }]);
      const result = mapMysqlResult(my);
      expect(result.rows[0]["created_at"]).toBeInstanceOf(Date);
      expect(result.rows[0]["created_at"]).toBe(date);
    });

    it("D4: DECIMAL/BIGINT-as-string stays a string (not coerced to number)", () => {
      const bigDecimal = "9999999999999999.99";
      const my = rowsArm([{ amount: bigDecimal }]);
      const result = mapMysqlResult(my);
      expect(result.rows[0]["amount"]).toBe(bigDecimal);
      expect(typeof result.rows[0]["amount"]).toBe("string");
    });

    it("D4: Buffer cell stays a Buffer (not coerced)", () => {
      const buf = Buffer.from("raw bytes");
      const my = rowsArm([{ blob_col: buf }]);
      const result = mapMysqlResult(my);
      expect(result.rows[0]["blob_col"]).toBe(buf);
    });

    it("D4: null cell stays null", () => {
      const my = rowsArm([{ optional: null }]);
      const result = mapMysqlResult(my);
      expect(result.rows[0]["optional"]).toBeNull();
    });

    it("defensive non-array rows → rows:[] (backstop)", () => {
      // Contract-impossible per seam design; backstop must fire
      const my = { kind: "rows", rows: null as unknown as Record<string, unknown>[] };
      const result = mapMysqlResult(my as MysqlQueryResult);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // "ok" arm — INSERT / UPDATE / DELETE / DDL
  // ---------------------------------------------------------------------------

  describe("ok arm — INSERT/UPDATE/DELETE/DDL", () => {
    it("DML with affectedRows=5: rows=[], rowCount=5", () => {
      const my = okArm(5);
      const result = mapMysqlResult(my);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(5);
    });

    it("DDL with absent affectedRows: rowCount=0 (the ?? 0 fallback)", () => {
      const my = okArm(undefined);
      const result = mapMysqlResult(my);
      expect(result.rowCount).toBe(0);
      expect(typeof result.rowCount).toBe("number");
    });

    it("OK arm with affectedRows=0 (e.g. UPDATE that matched nothing): rowCount=0", () => {
      const my = okArm(0);
      const result = mapMysqlResult(my);
      expect(result.rowCount).toBe(0);
    });

    it("raw === the my object (identity) on the ok arm", () => {
      const my = okArm(3);
      const result = mapMysqlResult(my);
      expect(result.raw).toBe(my);
    });

    it("rows is [] on the ok arm (no rows for non-row statements)", () => {
      const my = okArm(10);
      const result = mapMysqlResult(my);
      expect(result.rows).toEqual([]);
    });

    it("rowCount is always a number, never null/undefined on the ok arm", () => {
      // absent affectedRows → 0, not null/undefined
      const my = { kind: "ok" } as MysqlQueryResult;
      const result = mapMysqlResult(my);
      expect(typeof result.rowCount).toBe("number");
    });
  });
});
