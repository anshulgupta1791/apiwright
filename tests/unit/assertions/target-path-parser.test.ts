import { describe, it, expect } from "vitest";

import {
  TargetPathParser,
  MAX_TARGET_LENGTH,
} from "../../../src/assertions/target-path-parser.js";

/**
 * Unit tests for TargetPathParser — Part 1.
 *
 * Covers: MAX_TARGET_LENGTH constant (boundary), EMPTY_TARGET, TARGET_TOO_LONG,
 * every request.* root, every response.* root, UNEXPECTED_SUBPATH, UNKNOWN_ROOT,
 * EMPTY_SEGMENT.
 *
 * DB paths, DB_PATH_INCOMPLETE, key-vs-index classification, aggregation,
 * determinism, and boundedness tests are in target-path-parser-2.test.ts.
 *
 * No implementation exists — all tests must fail with module-not-found.
 */

function parse(lexeme: string) {
  return new TargetPathParser().parse(lexeme);
}

// ---- 1. MAX_TARGET_LENGTH constant --------------------------------------
describe("MAX_TARGET_LENGTH constant", () => {
  it("equals 1024", () => {
    expect(MAX_TARGET_LENGTH).toBe(1024);
  });

  it("lexeme of exactly 1024 chars is not rejected for length", () => {
    const prefix = "response.body.";
    const segment = "a".repeat(1024 - prefix.length);
    const lexeme = prefix + segment;
    expect(lexeme).toHaveLength(1024);
    expect(() => parse(lexeme)).not.toThrow();
    const r = parse(lexeme);
    if (!r.ok) {
      expect(r.errors.every((e) => e.code !== "TARGET_TOO_LONG")).toBe(true);
    }
  });

  it("lexeme of 1025 chars IS rejected with TARGET_TOO_LONG", () => {
    const lexeme = "a".repeat(1025);
    expect(() => parse(lexeme)).not.toThrow();
    const r = parse(lexeme);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "TARGET_TOO_LONG")).toBe(true);
  });
});

// ---- 2. EMPTY_TARGET ---------------------------------------------------
describe("parse() — EMPTY_TARGET", () => {
  it('empty string "" → ok:false with EMPTY_TARGET, never throws', () => {
    expect(() => parse("")).not.toThrow();
    const r = parse("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_TARGET")).toBe(true);
  });

  it('whitespace-only "   " → ok:false with EMPTY_TARGET', () => {
    const r = parse("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_TARGET")).toBe(true);
  });

  it("EMPTY_TARGET has segmentIndex -1 and offset 0", () => {
    const r = parse("");
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "EMPTY_TARGET");
      expect(err?.segmentIndex).toBe(-1);
      expect(err?.offset).toBe(0);
    }
  });
});

// ---- 3. TARGET_TOO_LONG -----------------------------------------------
describe("parse() — TARGET_TOO_LONG", () => {
  it("returns exactly 1 error with code TARGET_TOO_LONG and segmentIndex -1", () => {
    const r = parse("a".repeat(1025));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].code).toBe("TARGET_TOO_LONG");
      expect(r.errors[0].segmentIndex).toBe(-1);
    }
  });
});

// ---- 4. request.* roots ------------------------------------------------
describe("parse() — request roots", () => {
  it("request.headers.authorization → root 'request.headers', path:[key('authorization')]", () => {
    const r = parse("request.headers.authorization");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.root).toBe("request.headers");
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "authorization" });
    }
  });

  it("request.headers / request.body / request.url alone → path:[]", () => {
    for (const lexeme of ["request.headers", "request.body", "request.url"]) {
      const r = parse(lexeme);
      expect(r.ok).toBe(true);
      if (r.ok && "path" in r.ref) expect(r.ref.path).toHaveLength(0);
    }
  });

  it("request.body.items.0.id → [key('items'), index(0), key('id')]", () => {
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

  it("request.url.query.tag.0 → path ends with index(0)", () => {
    const r = parse("request.url.query.tag.0");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) expect(r.ref.path[2]).toEqual({ kind: "index", index: 0 });
  });
});

// ---- 5. response.* roots -----------------------------------------------
describe("parse() — response roots", () => {
  it("response.status → leaf TargetRef with root 'response.status', no path field", () => {
    const r = parse("response.status");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.root).toBe("response.status");
      expect("path" in r.ref).toBe(false);
    }
  });

  it("response.time_ms → leaf TargetRef with no path field", () => {
    const r = parse("response.time_ms");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.root).toBe("response.time_ms");
      expect("path" in r.ref).toBe(false);
    }
  });

  it("response.headers.content_type → key segment", () => {
    const r = parse("response.headers.content_type");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) {
      expect(r.ref.path[0]).toEqual({ kind: "key", key: "content_type" });
    }
  });

  it("response.body alone → path:[]", () => {
    const r = parse("response.body");
    expect(r.ok).toBe(true);
    if (r.ok && "path" in r.ref) expect(r.ref.path).toHaveLength(0);
  });

  it("response.body.items.0.id — locked-decision-C canonical example", () => {
    const r = parse("response.body.items.0.id");
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

// ---- 6. UNEXPECTED_SUBPATH --------------------------------------------
describe("parse() — UNEXPECTED_SUBPATH", () => {
  it("response.status.code → ok:false UNEXPECTED_SUBPATH, never throws", () => {
    expect(() => parse("response.status.code")).not.toThrow();
    const r = parse("response.status.code");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNEXPECTED_SUBPATH")).toBe(true);
  });

  it("response.time_ms.0 → ok:false UNEXPECTED_SUBPATH", () => {
    const r = parse("response.time_ms.0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNEXPECTED_SUBPATH")).toBe(true);
  });

  it("UNEXPECTED_SUBPATH points at segmentIndex 2", () => {
    const r = parse("response.status.code");
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "UNEXPECTED_SUBPATH");
      expect(err?.segmentIndex).toBe(2);
    }
  });
});

// ---- 7. UNKNOWN_ROOT ---------------------------------------------------
describe("parse() — UNKNOWN_ROOT", () => {
  it("'foo.bar' → UNKNOWN_ROOT at segmentIndex 0", () => {
    const r = parse("foo.bar");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "UNKNOWN_ROOT");
      expect(err?.segmentIndex).toBe(0);
    }
  });

  it("'Request.body' — case-sensitive miss → UNKNOWN_ROOT", () => {
    const r = parse("Request.body");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
  });

  it("'request.cookies' — bad sub-namespace → UNKNOWN_ROOT at segmentIndex 1", () => {
    const r = parse("request.cookies");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "UNKNOWN_ROOT");
      expect(err?.segmentIndex).toBe(1);
    }
  });

  it("'response.foo' — bad sub-namespace → UNKNOWN_ROOT", () => {
    const r = parse("response.foo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
  });

  it("'request' alone — missing sub-namespace → UNKNOWN_ROOT", () => {
    const r = parse("request");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
  });

  it("'response' alone — missing sub-namespace → UNKNOWN_ROOT", () => {
    const r = parse("response");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
  });
});

// ---- 8. EMPTY_SEGMENT -------------------------------------------------
describe("parse() — EMPTY_SEGMENT", () => {
  it("trailing dot 'response.body.' → EMPTY_SEGMENT for the last segment", () => {
    const r = parse("response.body.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
  });

  it("doubled dot 'response..body' → EMPTY_SEGMENT plus UNKNOWN_ROOT", () => {
    const r = parse("response..body");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
    }
  });

  it("leading dot '.response.body' → EMPTY_SEGMENT@0 and UNKNOWN_ROOT@0", () => {
    const r = parse(".response.body");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
    }
  });

  it('"." → at least 2 EMPTY_SEGMENT errors', () => {
    const r = parse(".");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const empties = r.errors.filter((e) => e.code === "EMPTY_SEGMENT");
      expect(empties.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---- 9. TargetParseError structure -------------------------------------
describe("parse() — TargetParseError structure", () => {
  it("every error has code, segmentIndex, offset, message fields", () => {
    const r = parse("foo.bar");
    if (!r.ok) {
      for (const err of r.errors) {
        expect(typeof err.code).toBe("string");
        expect(typeof err.segmentIndex).toBe("number");
        expect(typeof err.offset).toBe("number");
        expect(typeof err.message).toBe("string");
        expect(err.message.length).toBeGreaterThan(0);
      }
    }
  });
});
