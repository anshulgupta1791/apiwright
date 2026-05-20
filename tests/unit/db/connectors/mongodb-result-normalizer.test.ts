import { describe, it, expect } from "vitest";

import { mapMongoResult } from "../../../../src/db/connectors/mongodb-result-normalizer.js";
import type { MongoCommandResult } from "../../../../src/db/drivers/mongodb-seam.js";
import type { NormalizedResult } from "../../../../src/core/normalized-result.js";

/**
 * Unit tests for mapMongoResult (src/db/connectors/mongodb-result-normalizer.ts).
 *
 * Pure function — no seam, no DB. Covers: read with documents→rows/rowCount;
 * empty read (documents.length=0, affected=undefined)→rowCount=0; write with
 * affected count; write with absent affected→rowCount=0 (?? 0 branch); the
 * single total formula: rowCount = docs.length>0 ? docs.length : (affected??0);
 * D4 pass-through (ObjectId/Date/Decimal128/Binary verbatim); raw=m identity.
 *
 * RED PHASE: src/db/connectors/mongodb-result-normalizer.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readResult(docs: Record<string, unknown>[], affected?: number): MongoCommandResult {
  return affected !== undefined ? { documents: docs, affected } : { documents: docs };
}

function writeResult(affected: number): MongoCommandResult {
  return { documents: [], affected };
}

function noAffectedWrite(): MongoCommandResult {
  return { documents: [] };
}

// ---------------------------------------------------------------------------
// Read command — documents present
// ---------------------------------------------------------------------------

describe("mapMongoResult", () => {
  describe("read command — documents.length > 0", () => {
    it("rows = m.documents verbatim (2 docs)", () => {
      const docs = [{ _id: "abc", name: "Alice" }, { _id: "def", name: "Bob" }];
      const m = readResult(docs);
      const result: NormalizedResult = mapMongoResult(m);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(docs[0]);
    });

    it("rowCount = documents.length", () => {
      const m = readResult([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const result = mapMongoResult(m);
      expect(result.rowCount).toBe(3);
    });

    it("raw === the m argument (identity)", () => {
      const m = readResult([{ x: 1 }]);
      const result = mapMongoResult(m);
      expect(result.raw).toBe(m);
    });

    it("D4: ObjectId-like value stays verbatim (not .toHexString()'d)", () => {
      // Simulate an ObjectId wrapper object — the connector must not call methods on it
      const objectId = { toHexString: () => "abc123", _bsontype: "ObjectId" };
      const m = readResult([{ _id: objectId }]);
      const result = mapMongoResult(m);
      expect(result.rows[0]["_id"]).toBe(objectId);
    });

    it("D4: Date field stays a Date instance (not ISO-stringified)", () => {
      const date = new Date("2024-07-01T00:00:00Z");
      const m = readResult([{ created: date }]);
      const result = mapMongoResult(m);
      expect(result.rows[0]["created"]).toBeInstanceOf(Date);
      expect(result.rows[0]["created"]).toBe(date);
    });

    it("D4: Decimal128-like value stays verbatim (not parsed to number)", () => {
      const dec = { valueOf: () => 123.45, _bsontype: "Decimal128", bytes: Buffer.alloc(16) };
      const m = readResult([{ amount: dec }]);
      const result = mapMongoResult(m);
      expect(result.rows[0]["amount"]).toBe(dec);
    });

    it("D4: null field value stays null", () => {
      const m = readResult([{ optional: null }]);
      const result = mapMongoResult(m);
      expect(result.rows[0]["optional"]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Empty read — documents.length === 0, affected === undefined
  // ---------------------------------------------------------------------------

  describe("empty read — documents.length=0 and no affected → rowCount=0", () => {
    it("rows=[], rowCount=0 for empty find result", () => {
      const m = readResult([]);
      const result = mapMongoResult(m);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
    });

    it("rowCount is a number (not undefined or null)", () => {
      const m = readResult([]);
      const result = mapMongoResult(m);
      expect(typeof result.rowCount).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Write / admin command — documents.length=0, affected present
  // ---------------------------------------------------------------------------

  describe("write/admin command — documents.length=0, affected present", () => {
    it("rows=[], rowCount=affected for insert command", () => {
      const m = writeResult(3);
      const result = mapMongoResult(m);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(3);
    });

    it("rowCount=0 via ?? 0 fallback when affected is absent", () => {
      const m = noAffectedWrite();
      const result = mapMongoResult(m);
      expect(result.rowCount).toBe(0);
      expect(typeof result.rowCount).toBe("number");
    });

    it("raw === the m argument (identity) on write arm", () => {
      const m = writeResult(5);
      const result = mapMongoResult(m);
      expect(result.raw).toBe(m);
    });
  });

  // ---------------------------------------------------------------------------
  // Single total formula: docs.length>0 ? docs.length : (affected??0)
  // ---------------------------------------------------------------------------

  describe("single total rowCount formula", () => {
    it("docs present + affected present: uses docs.length (read dominates)", () => {
      // Both present — documents.length > 0 takes priority
      const m = readResult([{ id: 1 }, { id: 2 }], 999);
      const result = mapMongoResult(m);
      expect(result.rowCount).toBe(2);
    });

    it("no docs + affected=7: uses affected", () => {
      const m = writeResult(7);
      const result = mapMongoResult(m);
      expect(result.rowCount).toBe(7);
    });

    it("no docs + no affected: uses 0 (the ?? 0 fallback)", () => {
      const m = noAffectedWrite();
      const result = mapMongoResult(m);
      expect(result.rowCount).toBe(0);
    });
  });
});
