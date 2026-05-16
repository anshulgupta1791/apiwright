import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { NodeFileSystem } from "../../../src/cli/fs-seam.js";

/**
 * Unit tests for NodeFileSystem.
 *
 * Uses a real temp directory (mkdtempSync pattern from tests/unit/env/loader.test.ts)
 * because NodeFileSystem IS the real filesystem adapter — it has no injectable
 * seam itself. The tests stay deterministic by controlling the temp dir.
 */

let dir: string;
let fs: NodeFileSystem;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apiwright-fsseam-"));
  fs = new NodeFileSystem();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("NodeFileSystem.fileExists()", () => {
  it("returns true when a regular file exists", () => {
    const p = join(dir, "exists.json");
    writeFileSync(p, "{}", "utf8");
    expect(fs.fileExists(p)).toBe(true);
  });

  it("returns false when the file does not exist", () => {
    expect(fs.fileExists(join(dir, "nope.json"))).toBe(false);
  });

  it("returns false for a directory path", () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    expect(fs.fileExists(sub)).toBe(false);
  });
});

describe("NodeFileSystem.dirExists()", () => {
  it("returns true when a directory exists", () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    expect(fs.dirExists(sub)).toBe(true);
  });

  it("returns false when the directory does not exist", () => {
    expect(fs.dirExists(join(dir, "missing-dir"))).toBe(false);
  });

  it("returns false for a regular file path", () => {
    const p = join(dir, "file.txt");
    writeFileSync(p, "x", "utf8");
    expect(fs.dirExists(p)).toBe(false);
  });
});

describe("NodeFileSystem.readFile()", () => {
  it("returns the UTF-8 content of a regular file", () => {
    const p = join(dir, "test.json");
    writeFileSync(p, '{"ok":true}', "utf8");
    expect(fs.readFile(p)).toBe('{"ok":true}');
  });

  it("returns an empty string for an empty file", () => {
    const p = join(dir, "empty.txt");
    writeFileSync(p, "", "utf8");
    expect(fs.readFile(p)).toBe("");
  });

  it("throws a tagged error with code ENOENT for a missing file", () => {
    const p = join(dir, "missing.json");
    let caught: unknown;
    try {
      fs.readFile(p);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("ENOENT");
  });

  it("throws a tagged error with code EISDIR when reading a directory", () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    let caught: unknown;
    try {
      fs.readFile(sub);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // EISDIR or EACCES depending on OS
    expect(["EISDIR", "EACCES", "UNKNOWN"]).toContain(
      (caught as { code?: string }).code,
    );
  });
});

describe("NodeFileSystem.walk()", () => {
  it("returns all regular files in a flat directory", () => {
    writeFileSync(join(dir, "a.json"), "", "utf8");
    writeFileSync(join(dir, "b.json"), "", "utf8");
    const result = fs.walk(dir);
    expect(result).toHaveLength(2);
    expect(result.some((p) => p.endsWith("a.json"))).toBe(true);
    expect(result.some((p) => p.endsWith("b.json"))).toBe(true);
  });

  it("returns files from nested subdirectories (recursive walk)", () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    writeFileSync(join(dir, "top.json"), "", "utf8");
    writeFileSync(join(sub, "nested.json"), "", "utf8");
    const result = fs.walk(dir);
    expect(result.some((p) => p.endsWith("top.json"))).toBe(true);
    expect(result.some((p) => p.endsWith("nested.json"))).toBe(true);
  });

  it("does not include directories in the result (only files)", () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    writeFileSync(join(sub, "file.json"), "", "utf8");
    const result = fs.walk(dir);
    for (const p of result) {
      // each path should point to a file, not a dir
      expect(p).not.toBe(sub);
    }
  });

  it("returns an empty array for a directory with no files", () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    expect(fs.walk(empty)).toEqual([]);
  });

  it("returns absolute paths", () => {
    writeFileSync(join(dir, "abs.json"), "", "utf8");
    const result = fs.walk(dir);
    expect(result[0]).toMatch(/^\//);
  });
});
