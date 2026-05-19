import { describe, it, expect } from "vitest";

import {
  TargetPathParser,
} from "../../../src/assertions/target-path-parser.js";

/**
 * Unit tests for TargetPathParser — Part 2.
 *
 * Covers: db happy paths, DB_PATH_INCOMPLETE, key-vs-index classification
 * (all-digit→index incl. 007→7, digit-leading-not-all-digit→key), aggregation
 * (collect-not-stop), purity/determinism, bounded (no stack overflow on many
 * segments).
 *
 * Part 1 (constants, empty/too-long, request/response roots, error codes,
 * error structure) is in target-path-parser.test.ts.
 *
 * No implementation exists — all tests must fail with module-not-found.
 */

function parse(lexeme: string) {
  return new TargetPathParser().parse(lexeme);
}

// ---- 1. DB happy paths -------------------------------------------------
describe("parse() — db happy paths", () => {
  it("minimal db.c.q → connection 'c', queryId 'q', path:[]", () => {
    const r = parse("db.c.q");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.connection).toBe("c");
      expect(r.ref.queryId).toBe("q");
      expect(r.ref.path).toHaveLength(0);
    }
  });

  it("db.primary_postgres.user_check → correct connection/queryId, path:[]", () => {
    const r = parse("db.primary_postgres.user_check");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.connection).toBe("primary_postgres");
      expect(r.ref.queryId).toBe("user_check");
      expect(r.ref.path).toHaveLength(0);
    }
  });

  it("db.primary_postgres.user_check.rowCount → trailing key segment", () => {
    const r = parse("db.primary_postgres.user_check.rowCount");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.path).toHaveLength(1);
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "rowCount" });
    }
  });

  it("db.primary_postgres.user_check.rows.0.col → deep db path", () => {
    const r = parse("db.primary_postgres.user_check.rows.0.col");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.path).toEqual([
        { kind: "key", key: "rows" },
        { kind: "index", index: 0 },
        { kind: "key", key: "col" },
      ]);
    }
  });

  it("db.c.q.0 → trailing path with index(0)", () => {
    const r = parse("db.c.q.0");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.path[0]).toEqual({ kind: "index", index: 0 });
    }
  });

  it("db.0.1.x — all-digit connection/queryId are strings, NOT index-classified", () => {
    const r = parse("db.0.1.x");
    expect(r.ok).toBe(true);
    if (r.ok && r.ref.root === "db") {
      expect(r.ref.connection).toBe("0"); // string, never index
      expect(r.ref.queryId).toBe("1"); // string, never index
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "x" });
    }
  });
});

// ---- 2. DB_PATH_INCOMPLETE ---------------------------------------------
describe("parse() — DB_PATH_INCOMPLETE", () => {
  it("'db' alone → DB_PATH_INCOMPLETE, never throws", () => {
    expect(() => parse("db")).not.toThrow();
    const r = parse("db");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "DB_PATH_INCOMPLETE")).toBe(true);
  });

  it("'db.primary' — missing query_id → DB_PATH_INCOMPLETE", () => {
    const r = parse("db.primary");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "DB_PATH_INCOMPLETE")).toBe(true);
  });

  it("'db..user_check' — empty connection → EMPTY_SEGMENT AND DB_PATH_INCOMPLETE", () => {
    const r = parse("db..user_check");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      expect(r.errors.some((e) => e.code === "DB_PATH_INCOMPLETE")).toBe(true);
    }
  });

  it("'db.c.' — trailing dot → EMPTY_SEGMENT AND DB_PATH_INCOMPLETE", () => {
    const r = parse("db.c.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      expect(r.errors.some((e) => e.code === "DB_PATH_INCOMPLETE")).toBe(true);
    }
  });
});

// ---- 3. Key-vs-index classification (locked decision C) ----------------
describe("parse() — key-vs-index classification (locked decision C)", () => {
  it("segment '0' → index(0)", () => {
    const r = parse("response.body.0");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "index", index: 0 });
    }
  });

  it("segment '007' → index(7) — all-digits, no leading-zero carve-out (locked)", () => {
    const r = parse("response.body.007");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "index", index: 7 });
    }
  });

  it("segment '00' → index(0) — all-digits", () => {
    const r = parse("response.body.00");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "index", index: 0 });
    }
  });

  it("segment '0abc' → key('0abc') — digit-leading but not all-digit", () => {
    const r = parse("response.body.0abc");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "0abc" });
    }
  });

  it("segment 'abc0' → key('abc0')", () => {
    const r = parse("response.body.abc0");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "abc0" });
    }
  });

  it("segment '1_2' → key('1_2') — underscore present", () => {
    const r = parse("response.body.1_2");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "1_2" });
    }
  });

  it("segment order is preserved across mixed key/index segments", () => {
    const r = parse("request.body.items.0.id");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path).toEqual([
        { kind: "key", key: "items" },
        { kind: "index", index: 0 },
        { kind: "key", key: "id" },
      ]);
    }
  });
});

// ---- 4. Aggregation (collect-not-stop) ----------------------------------
describe("parse() — aggregation: multiple faults in one pass", () => {
  it("..foo.bar → EMPTY_SEGMENT(s) and UNKNOWN_ROOT in one ok:false result", () => {
    const r = parse("..foo.bar");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
    }
  });

  it(".db.. → multiple faults in one result, no early exit", () => {
    const r = parse(".db..");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---- 5. Purity / determinism -------------------------------------------
describe("parse() — purity and determinism", () => {
  it("same lexeme parsed twice yields deep-equal ok:true results", () => {
    const r1 = parse("response.body.items.0.id");
    const r2 = parse("response.body.items.0.id");
    expect(r1).toEqual(r2);
  });

  it("same invalid lexeme parsed twice yields deep-equal ok:false results", () => {
    expect(parse("foo.bar")).toEqual(parse("foo.bar"));
  });

  it("never throws for any input", () => {
    for (const inp of ["", "   ", ".", "..", "foo", "response.status.extra", "db"]) {
      expect(() => parse(inp)).not.toThrow();
    }
  });
});

// ---- 6. Bounded — many segments, no stack overflow ----------------------
describe("parse() — bounded, no recursion", () => {
  it("many-segment path ≤1024 chars completes — no stack overflow, no hang", () => {
    const prefix = "response.body.";
    const dots = Math.floor((1024 - prefix.length) / 2);
    const lexeme = prefix + ("a.").repeat(dots).slice(0, -1);
    expect(lexeme.length).toBeLessThanOrEqual(1024);
    expect(() => parse(lexeme)).not.toThrow();
    const r = parse(lexeme);
    expect(typeof r.ok).toBe("boolean");
  });
});
