import { describe, it, expect } from "vitest";

import {
  MAX_WALK_DEPTH,
  RESERVED_FLOW_SUFFIX,
  createDefaultDirReaderSeam,
  discoverEndpointFiles,
  type DirEntry,
  type DirReaderSeam,
} from "../../../src/runner/discovery/walker.js";

/**
 * Builds an in-memory DirReaderSeam from a path → entries map for tests.
 * @param tree - Mapping of dir path to list of entries.
 * @returns A fake DirReaderSeam.
 */
function fakeReader(tree: Record<string, readonly DirEntry[]>): DirReaderSeam {
  return {
    async readdir(dir: string): Promise<readonly DirEntry[]> {
      return tree[dir] ?? [];
    },
  };
}

describe("discoverEndpointFiles", () => {
  it("returns sorted endpoint.json paths from a flat directory", async () => {
    const reader = fakeReader({
      "tests": [
        { name: "b.endpoint.json", isDirectory: false },
        { name: "a.endpoint.json", isDirectory: false },
      ],
    });
    const result = await discoverEndpointFiles("tests", reader);
    expect(result).toEqual(["tests/a.endpoint.json", "tests/b.endpoint.json"]);
  });

  it("recursively walks subdirectories in alphabetical order", async () => {
    const reader = fakeReader({
      "tests": [
        { name: "users", isDirectory: true },
        { name: "billing", isDirectory: true },
      ],
      "tests/users": [
        { name: "create.endpoint.json", isDirectory: false },
      ],
      "tests/billing": [
        { name: "charge.endpoint.json", isDirectory: false },
      ],
    });
    const result = await discoverEndpointFiles("tests", reader);
    expect(result).toEqual([
      "tests/billing/charge.endpoint.json",
      "tests/users/create.endpoint.json",
    ]);
  });

  it("ignores .flow.json (reserved for v1.5)", async () => {
    const reader = fakeReader({
      "tests": [
        { name: "checkout.flow.json", isDirectory: false },
        { name: "users.endpoint.json", isDirectory: false },
      ],
    });
    const result = await discoverEndpointFiles("tests", reader);
    expect(result).toEqual(["tests/users.endpoint.json"]);
  });

  it("ignores files that match neither endpoint.json nor flow.json", async () => {
    const reader = fakeReader({
      "tests": [
        { name: "README.md", isDirectory: false },
        { name: "fixture.json", isDirectory: false },
        { name: "schema.yaml", isDirectory: false },
        { name: "x.endpoint.json", isDirectory: false },
      ],
    });
    const result = await discoverEndpointFiles("tests", reader);
    expect(result).toEqual(["tests/x.endpoint.json"]);
  });

  it("returns empty array when no matching files anywhere", async () => {
    const reader = fakeReader({
      "tests": [{ name: "README.md", isDirectory: false }],
    });
    const result = await discoverEndpointFiles("tests", reader);
    expect(result).toEqual([]);
  });

  it("respects MAX_WALK_DEPTH cap", async () => {
    // Build a chain of directories deeper than the cap
    const tree: Record<string, readonly DirEntry[]> = {};
    let path = "root";
    for (let d = 0; d <= MAX_WALK_DEPTH + 5; d++) {
      tree[path] = [
        { name: "sub", isDirectory: true },
        { name: `level${d}.endpoint.json`, isDirectory: false },
      ];
      path = `${path}/sub`;
    }
    const reader = fakeReader(tree);
    const result = await discoverEndpointFiles("root", reader);
    // Should find some endpoints but cap depth before traversing too deep
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(MAX_WALK_DEPTH + 6);
  });

  it("RESERVED_FLOW_SUFFIX is exported", () => {
    expect(RESERVED_FLOW_SUFFIX).toBe(".flow.json");
  });

  it("createDefaultDirReaderSeam returns a seam with readdir method", () => {
    const seam = createDefaultDirReaderSeam();
    expect(typeof seam.readdir).toBe("function");
  });
});
