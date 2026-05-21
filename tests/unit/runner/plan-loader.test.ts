import { describe, it, expect } from "vitest";

import { SchemaValidator } from "../../../src/core/index.js";
import { isRunnerError } from "../../../src/runner/index.js";
import {
  createDefaultFileReaderSeam,
  loadEndpointPlan,
  type FileReaderSeam,
} from "../../../src/runner/discovery/plan-loader.js";

/**
 * Builds a fake FileReaderSeam from a path → contents map.
 * @param tree - Map of path to contents (or Error for read failure).
 * @returns Fake FileReaderSeam.
 */
function fakeReader(tree: Record<string, string | Error>): FileReaderSeam {
  return {
    async readFile(path: string): Promise<string> {
      const v = tree[path];
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

const VALID_ENDPOINT = JSON.stringify({
  id: "users.get",
  name: "Get user",
  method: "GET",
  url: "/users/1",
  request: {},
  response: { expected_status: 200, schema: {} },
});

describe("loadEndpointPlan", () => {
  const validator = new SchemaValidator();

  it("loads and sorts a single valid endpoint", async () => {
    const r = await loadEndpointPlan(
      ["tests/x.endpoint.json"],
      validator,
      fakeReader({ "tests/x.endpoint.json": VALID_ENDPOINT }),
    );
    expect(r.size).toBe(1);
    expect(r.get("users.get")?.endpoint.id).toBe("users.get");
  });

  it("aggregates read failures across multiple files", async () => {
    try {
      await loadEndpointPlan(
        ["tests/a.endpoint.json", "tests/b.endpoint.json"],
        validator,
        fakeReader({}),
      );
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) {
        expect(e.code).toBe("RUNNER_ENDPOINT_PARSE_FAILED");
        expect(e.message).toContain("a.endpoint.json");
        expect(e.message).toContain("b.endpoint.json");
      }
    }
  });

  it("aggregates JSON parse failures", async () => {
    try {
      await loadEndpointPlan(
        ["tests/bad.endpoint.json"],
        validator,
        fakeReader({ "tests/bad.endpoint.json": "{not json" }),
      );
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) expect(e.message).toContain("parse failed");
    }
  });

  it("aggregates schema validation failures with details", async () => {
    try {
      await loadEndpointPlan(
        ["tests/invalid.endpoint.json"],
        validator,
        fakeReader({ "tests/invalid.endpoint.json": JSON.stringify({ id: "x" }) }),
      );
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) expect(e.message).toContain("schema validation failed");
    }
  });

  it("sorts loaded endpoints by id deterministically", async () => {
    const endpointB = VALID_ENDPOINT.replace('"users.get"', '"z.something"');
    const r = await loadEndpointPlan(
      ["tests/b.endpoint.json", "tests/a.endpoint.json"],
      validator,
      fakeReader({
        "tests/a.endpoint.json": endpointB,
        "tests/b.endpoint.json": VALID_ENDPOINT,
      }),
    );
    const keys = Array.from(r.keys());
    expect(keys).toEqual(["users.get", "z.something"]);
  });

  it("createDefaultFileReaderSeam returns a working seam", () => {
    const seam = createDefaultFileReaderSeam();
    expect(typeof seam.readFile).toBe("function");
  });
});
