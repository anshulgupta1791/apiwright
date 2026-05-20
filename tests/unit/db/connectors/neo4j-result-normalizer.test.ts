import { describe, it, expect } from "vitest";

import { mapNeo4jResult } from "../../../../src/db/connectors/neo4j-result-normalizer.js";
import type { Neo4jQueryResult } from "../../../../src/db/drivers/neo4j-seam.js";
import type { NormalizedResult } from "../../../../src/core/normalized-result.js";

/**
 * Unit tests for mapNeo4jResult (src/db/connectors/neo4j-result-normalizer.ts).
 *
 * Pure function — no seam, no DB. Covers: read arm (records present→
 * rows=records-as-is, rowCount=records.length); write arm (records empty,
 * countersTotal>0→rowCount=countersTotal); empty MATCH (records empty,
 * countersTotal=0→rowCount=0); single total formula:
 * records.length>0 ? records.length : (countersTotal??0); D4 pass-through
 * pins — Integer/Node/Relationship/temporal-type/Point verbatim (NO coercion);
 * raw=n identity; defensive non-array records → [].
 *
 * The sharpest D4 case: neo4j-driver returns Integer/Node/temporal objects that
 * must NOT be coerced by the connector. The seam already normalizes record shape
 * to plain Record<string,unknown>; the connector does NOT call record.toObject().
 *
 * RED PHASE: src/db/connectors/neo4j-result-normalizer.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readResult(records: Record<string, unknown>[], countersTotal = 0): Neo4jQueryResult {
  return { records, countersTotal };
}

function writeResult(countersTotal: number): Neo4jQueryResult {
  return { records: [], countersTotal };
}

// ---------------------------------------------------------------------------
// Read arm — records present
// ---------------------------------------------------------------------------

describe("mapNeo4jResult", () => {
  describe("read arm — records.length > 0", () => {
    it("rows = n.records verbatim for multi-record result", () => {
      const records = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
      const n = readResult(records);
      const result: NormalizedResult = mapNeo4jResult(n);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(records[0]);
    });

    it("rowCount = records.length", () => {
      const n = readResult([{ a: 1 }, { a: 2 }, { a: 3 }]);
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(3);
    });

    it("raw === the n argument (identity)", () => {
      const n = readResult([{ x: 1 }]);
      const result = mapNeo4jResult(n);
      expect(result.raw).toBe(n);
    });

    it("D4: Integer-like object stays verbatim (NOT coerced to JS number)", () => {
      // Simulate a neo4j-driver Integer object — must NOT call .toNumber() or .toString()
      const intObj = { low: 42, high: 0, _isBigInteger: true, toNumber: () => 42 };
      const n = readResult([{ count: intObj }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["count"]).toBe(intObj);
      // Must still be the object, not a primitive
      expect(typeof result.rows[0]["count"]).toBe("object");
    });

    it("D4: Node-like object stays verbatim (NOT reduced to its properties map)", () => {
      // Simulate a neo4j Node object with identity, labels, properties
      const nodeObj = {
        identity: { low: 1, high: 0 },
        labels: ["User"],
        properties: { name: "Alice", age: 30 },
        _isNode: true,
      };
      const n = readResult([{ node: nodeObj }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["node"]).toBe(nodeObj);
      // The connector must NOT reduce Node → properties; the full node object stays
      expect((result.rows[0]["node"] as typeof nodeObj).labels).toEqual(["User"]);
    });

    it("D4: Relationship-like object stays verbatim", () => {
      const relObj = {
        identity: { low: 5, high: 0 },
        start: { low: 1, high: 0 },
        end: { low: 2, high: 0 },
        type: "KNOWS",
        properties: { since: 2020 },
        _isRelationship: true,
      };
      const n = readResult([{ rel: relObj }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["rel"]).toBe(relObj);
    });

    it("D4: temporal-type (neo4j Date-like) stays verbatim (NOT JS Date, not stringified)", () => {
      // Simulate neo4j.types.Date — NOT a JS Date
      const neo4jDate = {
        year: { low: 2024, high: 0 },
        month: { low: 7, high: 0 },
        day: { low: 1, high: 0 },
        _isNeo4jDate: true,
      };
      const n = readResult([{ created: neo4jDate }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["created"]).toBe(neo4jDate);
      expect(result.rows[0]["created"] instanceof Date).toBe(false);
    });

    it("D4: Point-like (spatial) stays verbatim (not stringified)", () => {
      const point = { srid: 4326, x: -73.9857, y: 40.7484, _isPoint: true };
      const n = readResult([{ location: point }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["location"]).toBe(point);
    });

    it("D4: null cell stays null", () => {
      const n = readResult([{ optional: null }]);
      const result = mapNeo4jResult(n);
      expect(result.rows[0]["optional"]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Write arm — records empty, countersTotal > 0
  // ---------------------------------------------------------------------------

  describe("write arm — records empty, countersTotal > 0", () => {
    it("rows=[], rowCount=countersTotal for CREATE/MERGE/DELETE", () => {
      const n = writeResult(3);
      const result = mapNeo4jResult(n);
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(3);
    });

    it("raw === n (identity) on write arm", () => {
      const n = writeResult(2);
      const result = mapNeo4jResult(n);
      expect(result.raw).toBe(n);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty MATCH — records empty, countersTotal = 0
  // ---------------------------------------------------------------------------

  describe("empty MATCH — records=[], countersTotal=0 → rowCount=0", () => {
    it("rowCount=0 for MATCH that matched nothing", () => {
      const n = readResult([]);
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(0);
    });

    it("rows=[] for empty MATCH", () => {
      const n = readResult([]);
      const result = mapNeo4jResult(n);
      expect(result.rows).toHaveLength(0);
    });

    it("rowCount is a number, never null/undefined", () => {
      const n = readResult([]);
      const result = mapNeo4jResult(n);
      expect(typeof result.rowCount).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Single total formula: records.length>0 ? records.length : (countersTotal??0)
  // ---------------------------------------------------------------------------

  describe("single total formula", () => {
    it("records present + countersTotal=0: rowCount=records.length (read dominates)", () => {
      const n = readResult([{ id: 1 }, { id: 2 }], 0);
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(2);
    });

    it("no records + countersTotal=5: rowCount=5 (write arm)", () => {
      const n = writeResult(5);
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(5);
    });

    it("no records + countersTotal=0 (empty MATCH): rowCount=0", () => {
      const n = readResult([], 0);
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(0);
    });

    it("?? 0 fallback: countersTotal=undefined maps to 0 (contract-impossible edge)", () => {
      // The seam types countersTotal as number, but guard the ?? 0 path
      const n = { records: [], countersTotal: undefined } as unknown as Neo4jQueryResult;
      const result = mapNeo4jResult(n);
      expect(result.rowCount).toBe(0);
      expect(typeof result.rowCount).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive: non-array records → []
  // ---------------------------------------------------------------------------

  describe("defensive: non-array records input → rows:[] (backstop)", () => {
    it("non-array n.records is coalesced to [] to keep NormalizedResult well-formed", () => {
      const n = { records: null as unknown as Record<string, unknown>[], countersTotal: 0 };
      const result = mapNeo4jResult(n);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows).toHaveLength(0);
    });
  });
});
