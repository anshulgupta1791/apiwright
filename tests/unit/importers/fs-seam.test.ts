import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeImporterFileSystem } from "../../../src/importers/fs-seam.js";
import type { ImporterFsError } from "../../../src/importers/types.js";

/**
 * Unit tests for NodeImporterFileSystem.
 *
 * Covers: readFile (success + ENOENT + EISDIR error codes), mkdirp (new dir,
 * nested creation, idempotent on existing), writeFile (success, overwrite,
 * UTF-8), and the default-seam wiring (no-arg constructor must work).
 *
 * Uses a real OS temp directory — NodeImporterFileSystem IS the real FS
 * adapter; there is no injectable seam inside it.
 */

let dir: string;
let fs: NodeImporterFileSystem;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apiwright-importer-fsseam-"));
  fs = new NodeImporterFileSystem();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("NodeImporterFileSystem — default-seam constructor", () => {
  it("constructs with no arguments and returns a usable instance", () => {
    const instance = new NodeImporterFileSystem();
    expect(typeof instance.readFile).toBe("function");
    expect(typeof instance.mkdirp).toBe("function");
    expect(typeof instance.writeFile).toBe("function");
  });

  it("default-seam readFile reads a real file without injected options", () => {
    const p = join(dir, "default-seam.txt");
    writeFileSync(p, "default-seam-content", "utf8");
    const noArgFs = new NodeImporterFileSystem();
    expect(noArgFs.readFile(p)).toBe("default-seam-content");
  });

  it("default-seam mkdirp creates a real directory without injected options", () => {
    const sub = join(dir, "default-seam-dir");
    const noArgFs = new NodeImporterFileSystem();
    noArgFs.mkdirp(sub);
    expect(existsSync(sub)).toBe(true);
  });

  it("default-seam writeFile writes a real file without injected options", () => {
    const p = join(dir, "default-seam-write.txt");
    const noArgFs = new NodeImporterFileSystem();
    noArgFs.writeFile(p, "written-by-default");
    expect(readFileSync(p, "utf8")).toBe("written-by-default");
  });
});

describe("NodeImporterFileSystem.readFile()", () => {
  it("reads and returns file contents as a string", () => {
    const p = join(dir, "hello.txt");
    writeFileSync(p, "hello world", "utf8");
    expect(fs.readFile(p)).toBe("hello world");
  });

  it("reads UTF-8 content including non-ASCII characters", () => {
    const p = join(dir, "utf8.txt");
    writeFileSync(p, "café 中文", "utf8");
    expect(fs.readFile(p)).toBe("café 中文");
  });

  it("reads JSON file contents verbatim", () => {
    const p = join(dir, "data.json");
    const json = '{"key":"value","n":42}';
    writeFileSync(p, json, "utf8");
    expect(fs.readFile(p)).toBe(json);
  });

  it("throws ImporterFsError with code ENOENT when file does not exist", () => {
    const p = join(dir, "nonexistent.json");
    let caught: unknown;
    try {
      fs.readFile(p);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = caught as ImporterFsError;
    expect(err.code).toBe("ENOENT");
  });

  it("thrown ImporterFsError includes 'readFile failed' in the message", () => {
    const p = join(dir, "missing.json");
    let caught: unknown;
    try {
      fs.readFile(p);
    } catch (e) {
      caught = e;
    }
    const err = caught as ImporterFsError;
    expect(err.message).toContain("readFile failed:");
  });

  it("thrown ImporterFsError includes the path in the message", () => {
    const p = join(dir, "missing.json");
    let caught: unknown;
    try {
      fs.readFile(p);
    } catch (e) {
      caught = e;
    }
    const err = caught as ImporterFsError;
    expect(err.message).toContain(p);
  });

  it("throws ImporterFsError with code EISDIR when path is a directory", () => {
    const sub = join(dir, "asubdir");
    mkdirSync(sub);
    let caught: unknown;
    try {
      fs.readFile(sub);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = caught as ImporterFsError;
    expect(err.code).toBe("EISDIR");
  });

  it("thrown error is an Error instance", () => {
    const p = join(dir, "nope.txt");
    let caught: unknown;
    try {
      fs.readFile(p);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});

describe("NodeImporterFileSystem.mkdirp()", () => {
  it("creates a new directory", () => {
    const sub = join(dir, "newdir");
    fs.mkdirp(sub);
    expect(existsSync(sub)).toBe(true);
  });

  it("creates nested directories recursively", () => {
    const sub = join(dir, "a", "b", "c");
    fs.mkdirp(sub);
    expect(existsSync(sub)).toBe(true);
  });

  it("does not throw when the directory already exists (idempotent)", () => {
    const sub = join(dir, "existing");
    mkdirSync(sub);
    expect(() => fs.mkdirp(sub)).not.toThrow();
  });

  it("calling mkdirp twice on same path is a no-op", () => {
    const sub = join(dir, "twice");
    fs.mkdirp(sub);
    expect(() => fs.mkdirp(sub)).not.toThrow();
    expect(existsSync(sub)).toBe(true);
  });
});

describe("NodeImporterFileSystem.writeFile()", () => {
  it("writes a file with the given contents", () => {
    const p = join(dir, "out.json");
    fs.writeFile(p, '{"key":"value"}');
    expect(readFileSync(p, "utf8")).toBe('{"key":"value"}');
  });

  it("overwrites an existing file", () => {
    const p = join(dir, "out.json");
    writeFileSync(p, "old content", "utf8");
    fs.writeFile(p, "new content");
    expect(readFileSync(p, "utf8")).toBe("new content");
  });

  it("writes UTF-8 content correctly", () => {
    const p = join(dir, "utf8-out.txt");
    fs.writeFile(p, "café");
    expect(readFileSync(p, "utf8")).toBe("café");
  });

  it("writes an empty string without error", () => {
    const p = join(dir, "empty.txt");
    fs.writeFile(p, "");
    expect(readFileSync(p, "utf8")).toBe("");
  });
});
