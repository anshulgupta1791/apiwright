import { describe, it, expect } from "vitest";

import { isDocsError, MarkdownDocsGenerator } from "../../../src/docs/index.js";
import type {
  DocsDirReaderSeam,
  DocsFileReaderSeam,
  DocsFileWriterSeam,
} from "../../../src/docs/generator.js";
import { MAX_DOCS_WALK_DEPTH } from "../../../src/docs/generator.js";

function fakeDirReader(tree: Record<string, readonly { name: string; isDirectory: boolean }[]>): DocsDirReaderSeam {
  return { async readdir(dir: string) { return tree[dir] ?? []; } };
}

function fakeFileReader(files: Record<string, string | Error>): DocsFileReaderSeam {
  return {
    async readFile(path: string) {
      const v = files[path];
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

interface CapturingWriter extends DocsFileWriterSeam {
  mkdirs: string[];
  files: { path: string; contents: string }[];
}

function capture(): CapturingWriter {
  const c: CapturingWriter = {
    mkdirs: [], files: [],
    async mkdir(d: string) { c.mkdirs.push(d); },
    async writeFile(p: string, contents: string) { c.files.push({ path: p, contents }); },
  };
  return c;
}

const VALID_ENDPOINT = JSON.stringify({
  id: "users.create",
  name: "Create user",
  method: "POST",
  url: "/v1/users",
  request: {},
  response: { expected_status: 201, schema: {} },
});

const VALID_ENDPOINT_2 = JSON.stringify({
  id: "users.list",
  name: "List users",
  method: "GET",
  url: "/v1/users",
  request: {},
  response: { expected_status: 200, schema: { type: "array" } },
});

describe("MarkdownDocsGenerator.generate", () => {
  it("writes one .md per endpoint, named by endpoint id", async () => {
    const dirReader = fakeDirReader({
      "tests": [{ name: "users.endpoint.json", isDirectory: false }],
    });
    const fileReader = fakeFileReader({ "tests/users.endpoint.json": VALID_ENDPOINT });
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    const outcome = await gen.generate({ sourceDir: "tests", outputDir: "docs/endpoints" });
    expect(outcome.written).toBe(1);
    expect(writer.files).toHaveLength(1);
    expect(writer.files[0]?.path).toBe("docs/endpoints/users.create.md");
    expect(writer.files[0]?.contents).toContain("# Create user");
  });

  it("walks subdirectories alphabetically and writes both endpoints", async () => {
    const dirReader = fakeDirReader({
      "tests": [
        { name: "z", isDirectory: true },
        { name: "a", isDirectory: true },
      ],
      "tests/a": [{ name: "x.endpoint.json", isDirectory: false }],
      "tests/z": [{ name: "y.endpoint.json", isDirectory: false }],
    });
    const fileReader = fakeFileReader({
      "tests/a/x.endpoint.json": VALID_ENDPOINT,
      "tests/z/y.endpoint.json": VALID_ENDPOINT_2,
    });
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    const outcome = await gen.generate({ sourceDir: "tests", outputDir: "out" });
    expect(outcome.written).toBe(2);
    expect(writer.files.map((f) => f.path).sort()).toEqual([
      "out/users.create.md",
      "out/users.list.md",
    ]);
  });

  it("throws DOCS_SOURCE_DIR_EMPTY when no endpoint files", async () => {
    const dirReader = fakeDirReader({ "tests": [{ name: "README.md", isDirectory: false }] });
    const fileReader = fakeFileReader({});
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    try {
      await gen.generate({ sourceDir: "tests", outputDir: "out" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isDocsError(e)).toBe(true);
      if (isDocsError(e)) expect(e.code).toBe("DOCS_SOURCE_DIR_EMPTY");
    }
  });

  it("aggregates parse/validate failures into DOCS_ENDPOINT_LOAD_FAILED", async () => {
    const dirReader = fakeDirReader({
      "tests": [
        { name: "good.endpoint.json", isDirectory: false },
        { name: "bad.endpoint.json", isDirectory: false },
      ],
    });
    const fileReader = fakeFileReader({
      "tests/good.endpoint.json": VALID_ENDPOINT,
      "tests/bad.endpoint.json": "{not json",
    });
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    try {
      await gen.generate({ sourceDir: "tests", outputDir: "out" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isDocsError(e)).toBe(true);
      if (isDocsError(e)) {
        expect(e.code).toBe("DOCS_ENDPOINT_LOAD_FAILED");
        expect(e.message).toContain("bad.endpoint.json");
      }
    }
  });

  it("throws DOCS_WRITE_FAILED when mkdir fails", async () => {
    const dirReader = fakeDirReader({
      "tests": [{ name: "x.endpoint.json", isDirectory: false }],
    });
    const fileReader = fakeFileReader({ "tests/x.endpoint.json": VALID_ENDPOINT });
    const writer: DocsFileWriterSeam = {
      async mkdir() { throw new Error("EACCES"); },
      async writeFile() {},
    };
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    try {
      await gen.generate({ sourceDir: "tests", outputDir: "out" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isDocsError(e)).toBe(true);
      if (isDocsError(e)) expect(e.code).toBe("DOCS_WRITE_FAILED");
    }
  });

  it("throws DOCS_WRITE_FAILED when writeFile fails", async () => {
    const dirReader = fakeDirReader({
      "tests": [{ name: "x.endpoint.json", isDirectory: false }],
    });
    const fileReader = fakeFileReader({ "tests/x.endpoint.json": VALID_ENDPOINT });
    const writer: DocsFileWriterSeam = {
      async mkdir() {},
      async writeFile() { throw new Error("ENOSPC"); },
    };
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    try {
      await gen.generate({ sourceDir: "tests", outputDir: "out" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isDocsError(e)).toBe(true);
      if (isDocsError(e)) expect(e.code).toBe("DOCS_WRITE_FAILED");
    }
  });

  it("ignores .flow.json (v1.5 reserved)", async () => {
    const dirReader = fakeDirReader({
      "tests": [
        { name: "checkout.flow.json", isDirectory: false },
        { name: "x.endpoint.json", isDirectory: false },
      ],
    });
    const fileReader = fakeFileReader({ "tests/x.endpoint.json": VALID_ENDPOINT });
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    const outcome = await gen.generate({ sourceDir: "tests", outputDir: "out" });
    expect(outcome.written).toBe(1);
  });

  it("writes byte-identical content across two runs (determinism)", async () => {
    const dirReader = fakeDirReader({
      "tests": [{ name: "x.endpoint.json", isDirectory: false }],
    });
    const fileReader = fakeFileReader({ "tests/x.endpoint.json": VALID_ENDPOINT });
    const w1 = capture();
    const w2 = capture();
    const gen1 = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: w1 });
    const gen2 = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: w2 });
    await gen1.generate({ sourceDir: "tests", outputDir: "out" });
    await gen2.generate({ sourceDir: "tests", outputDir: "out" });
    expect(w1.files[0]?.contents).toBe(w2.files[0]?.contents);
  });

  it("MAX_DOCS_WALK_DEPTH is exported as a positive number", () => {
    expect(typeof MAX_DOCS_WALK_DEPTH).toBe("number");
    expect(MAX_DOCS_WALK_DEPTH).toBeGreaterThan(0);
  });

  it("respects MAX_DOCS_WALK_DEPTH cap", async () => {
    const tree: Record<string, readonly { name: string; isDirectory: boolean }[]> = {};
    let path = "root";
    for (let d = 0; d <= MAX_DOCS_WALK_DEPTH + 5; d++) {
      tree[path] = [
        { name: "sub", isDirectory: true },
        { name: `lvl${d}.endpoint.json`, isDirectory: false },
      ];
      path = `${path}/sub`;
    }
    const fileReaderMap: Record<string, string> = {};
    let p = "root";
    for (let d = 0; d <= MAX_DOCS_WALK_DEPTH + 5; d++) {
      const ep = JSON.stringify({
        id: `id-${d}`,
        name: `n${d}`,
        method: "GET",
        url: "/x",
        request: {},
        response: { expected_status: 200, schema: {} },
      });
      fileReaderMap[`${p}/lvl${d}.endpoint.json`] = ep;
      p = `${p}/sub`;
    }
    const dirReader = fakeDirReader(tree);
    const fileReader = fakeFileReader(fileReaderMap);
    const writer = capture();
    const gen = new MarkdownDocsGenerator({ dirReader, fileReader, fileWriter: writer });
    const outcome = await gen.generate({ sourceDir: "root", outputDir: "out" });
    expect(outcome.written).toBeGreaterThan(0);
    expect(outcome.written).toBeLessThan(MAX_DOCS_WALK_DEPTH + 6);
  });
});
