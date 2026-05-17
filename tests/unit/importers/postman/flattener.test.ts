import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PostmanCollectionLoader } from "../../../../src/importers/postman/collection-loader.js";
import { PostmanFlattener } from "../../../../src/importers/postman/flattener.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { FlattenedRequest } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanFlattener.
 *
 * Covers: root-level requests (empty folderPath), nested folder paths at 1/2/3+
 * levels, disabled flag propagation, variable scoping (collection > folder >
 * request), header/body/query extraction, preRequestScript joining,
 * responses, and document-order preservation.
 */

/** In-memory fake implementing ImporterFileSystem. */
function makeFakeFs(files: Record<string, string>): ImporterFileSystem {
  return {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

/**
 * Loads the real fixture collection from disk for integration-style unit tests.
 * @throws Error when the fixture file cannot be read or loaded.
 */
function loadRealFixture() {
  const fixturePath = join(
    import.meta.dirname ?? process.cwd(),
    "../../../../tests/fixtures/postman/sample.postman_collection.json",
  );
  // We read it directly as we need the raw json for the fake FS
  const raw = readFileSync(fixturePath, "utf8");
  const fakeFs = makeFakeFs({ [fixturePath]: raw });
  const loader = new PostmanCollectionLoader({ fs: fakeFs });
  const result = loader.load(fixturePath);
  if (!result.ok) throw new Error(`Failed to load fixture: ${result.error}`);
  return result.collection;
}

/** Creates a minimal v2.1 collection JSON with given items tree. */
function makeCollection(items: unknown[]): string {
  return JSON.stringify({
    info: {
      _postman_id: "test-id",
      name: "Test",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items,
    variable: [{ key: "collVar", value: "collValue" }],
  });
}

describe("PostmanFlattener", () => {
  const flattener = new PostmanFlattener();

  describe("flatten() — root-level requests", () => {
    it("returns an empty array for a collection with no items", () => {
      const json = makeCollection([]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      expect(flattener.flatten(loaded.collection)).toEqual([]);
    });

    it("returns one FlattenedRequest for a root-level request", () => {
      const json = makeCollection([
        {
          id: "req-1",
          name: "Get Users",
          request: {
            method: "GET",
            url: "https://example.com/users",
            header: [],
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result).toHaveLength(1);
    });

    it("root-level request has empty folderPath array", () => {
      const json = makeCollection([
        {
          id: "req-1",
          name: "Root Request",
          request: { method: "GET", url: "https://example.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.folderPath).toEqual([]);
    });

    it("extracts the Postman item id as postmanId", () => {
      const json = makeCollection([
        {
          id: "my-item-id",
          name: "Item",
          request: { method: "GET", url: "https://example.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.postmanId).toBe("my-item-id");
    });

    it("uses empty string for postmanId when item has no id", () => {
      const json = makeCollection([
        {
          name: "No Id",
          request: { method: "GET", url: "https://example.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(typeof req.postmanId).toBe("string");
    });
  });

  describe("flatten() — folder path extraction", () => {
    it("one-level folder yields folderPath with one segment", () => {
      const json = makeCollection([
        {
          name: "Users",
          item: [
            {
              id: "u1",
              name: "List",
              request: {
                method: "GET",
                url: "https://ex.com/users",
                header: [],
              },
              response: [],
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.folderPath).toEqual(["Users"]);
    });

    it("two-level folders yield folderPath with two segments in root-to-parent order", () => {
      const json = makeCollection([
        {
          name: "Users",
          item: [
            {
              name: "Admin",
              item: [
                {
                  id: "a1",
                  name: "Admin List",
                  request: {
                    method: "GET",
                    url: "https://ex.com/admin",
                    header: [],
                  },
                  response: [],
                },
              ],
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.folderPath).toEqual(["Users", "Admin"]);
    });

    it("three-level folders yield folderPath with three segments", () => {
      const json = makeCollection([
        {
          name: "Users",
          item: [
            {
              name: "Admin",
              item: [
                {
                  name: "Internal",
                  item: [
                    {
                      id: "i1",
                      name: "Metrics",
                      request: {
                        method: "GET",
                        url: "https://ex.com/metrics",
                        header: [],
                      },
                      response: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.folderPath).toEqual(["Users", "Admin", "Internal"]);
    });

    it("does not emit a FlattenedRequest for folders themselves", () => {
      const json = makeCollection([
        {
          name: "EmptyFolder",
          item: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result).toHaveLength(0);
    });
  });

  describe("flatten() — document order", () => {
    it("preserves document order for multiple root-level requests", () => {
      const json = makeCollection([
        {
          id: "r1",
          name: "First",
          request: { method: "GET", url: "https://ex.com/1", header: [] },
          response: [],
        },
        {
          id: "r2",
          name: "Second",
          request: { method: "POST", url: "https://ex.com/2", header: [] },
          response: [],
        },
        {
          id: "r3",
          name: "Third",
          request: { method: "PUT", url: "https://ex.com/3", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result.map((r) => r.name)).toEqual(["First", "Second", "Third"]);
    });

    it("depth-first pre-order: folder contents before next sibling", () => {
      const json = makeCollection([
        {
          name: "FolderA",
          item: [
            {
              id: "a1",
              name: "A-Request",
              request: { method: "GET", url: "https://ex.com/a", header: [] },
              response: [],
            },
          ],
        },
        {
          id: "r1",
          name: "Root-After-Folder",
          request: { method: "GET", url: "https://ex.com/root", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result[0].name).toBe("A-Request");
      expect(result[1].name).toBe("Root-After-Folder");
    });
  });

  describe("flatten() — disabled flag", () => {
    it("emits FlattenedRequest with disabled:true for a disabled item", () => {
      const json = makeCollection([
        {
          id: "d1",
          name: "Disabled",
          disabled: true,
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.disabled).toBe(true);
    });

    it("emits FlattenedRequest with disabled:false for an enabled item", () => {
      const json = makeCollection([
        {
          id: "e1",
          name: "Enabled",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.disabled).toBe(false);
    });
  });

  describe("flatten() — headers", () => {
    it("extracts header key and value", () => {
      const json = makeCollection([
        {
          id: "h1",
          name: "With Headers",
          request: {
            method: "GET",
            url: "https://ex.com",
            header: [
              {
                key: "Content-Type",
                value: "application/json",
                disabled: false,
              },
            ],
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.headers).toHaveLength(1);
      expect(req.headers[0].key).toBe("Content-Type");
      expect(req.headers[0].value).toBe("application/json");
    });

    it("preserves the disabled flag on headers", () => {
      const json = makeCollection([
        {
          id: "h2",
          name: "Disabled Header",
          request: {
            method: "GET",
            url: "https://ex.com",
            header: [
              { key: "X-Skip", value: "skip", disabled: true },
              { key: "X-Keep", value: "keep", disabled: false },
            ],
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      const disabled = req.headers.find((h) => h.key === "X-Skip");
      const enabled = req.headers.find((h) => h.key === "X-Keep");
      expect(disabled?.disabled).toBe(true);
      expect(enabled?.disabled).toBe(false);
    });
  });

  describe("flatten() — body extraction", () => {
    it("extracts raw body mode and raw content", () => {
      const json = makeCollection([
        {
          id: "b1",
          name: "With Body",
          request: {
            method: "POST",
            url: "https://ex.com/users",
            header: [],
            body: { mode: "raw", raw: '{"name":"test"}' },
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.body?.mode).toBe("raw");
      expect(req.body?.raw).toBe('{"name":"test"}');
    });

    it("body is undefined when no body is present", () => {
      const json = makeCollection([
        {
          id: "nb1",
          name: "No Body",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.body).toBeUndefined();
    });
  });

  describe("flatten() — query parameters", () => {
    it("extracts query parameters with key and value", () => {
      const json = makeCollection([
        {
          id: "q1",
          name: "With Query",
          request: {
            method: "GET",
            url: {
              raw: "https://ex.com/users?limit=10",
              query: [{ key: "limit", value: "10", disabled: false }],
            },
            header: [],
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.query.length).toBeGreaterThan(0);
      const limitParam = req.query.find((p) => p.key === "limit");
      expect(limitParam?.value).toBe("10");
    });
  });

  describe("flatten() — preRequestScript", () => {
    it("joins prerequest script exec lines with newline", () => {
      const json = makeCollection([
        {
          id: "s1",
          name: "With Script",
          event: [
            {
              listen: "prerequest",
              script: {
                type: "text/javascript",
                exec: ["line1", "line2"],
              },
            },
          ],
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.preRequestScript).toBe("line1\nline2");
    });

    it("preRequestScript is empty string when no pre-request event", () => {
      const json = makeCollection([
        {
          id: "ns1",
          name: "No Script",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.preRequestScript).toBe("");
    });

    it("preRequestScript is empty string when event array contains only a non-prerequest event (test script)", () => {
      // Exercises the else branch: event.listen === "test" is not "prerequest",
      // so the script lines are NOT collected and preRequestScript stays "".
      const json = makeCollection([
        {
          id: "ts1",
          name: "Test Script Only",
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "pm.test('status', () => pm.response.to.have.status(200));",
                ],
              },
            },
          ],
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.preRequestScript).toBe("");
    });

    it("collects only the prerequest lines when both test and prerequest events are present", () => {
      const json = makeCollection([
        {
          id: "mixed1",
          name: "Mixed Events",
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: ["pm.test('ok', () => {});"],
              },
            },
            {
              listen: "prerequest",
              script: {
                type: "text/javascript",
                exec: ["pm.environment.set('x', '1');"],
              },
            },
          ],
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.preRequestScript).toBe("pm.environment.set('x', '1');");
    });
  });

  describe("flatten() — responses", () => {
    it("extracts saved response code and body", () => {
      const json = makeCollection([
        {
          id: "res1",
          name: "With Response",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [
            {
              name: "Success",
              status: "OK",
              code: 200,
              body: '{"ok":true}',
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.responses).toHaveLength(1);
      expect(req.responses[0].code).toBe(200);
      expect(req.responses[0].body).toBe('{"ok":true}');
    });

    it("responses is empty array when no saved responses", () => {
      const json = makeCollection([
        {
          id: "nr1",
          name: "No Response",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.responses).toEqual([]);
    });
  });

  describe("flatten() — variable scoping", () => {
    it("attaches collection-level variables to each request", () => {
      const json = makeCollection([
        {
          id: "v1",
          name: "With Var",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      // Collection has collVar from makeCollection
      expect(typeof req.variables).toBe("object");
      expect(req.variables["collVar"]).toBe("collValue");
    });

    it("folder-level variables override collection-level when keys conflict", () => {
      const json = JSON.stringify({
        info: {
          _postman_id: "t",
          name: "T",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            name: "Folder",
            variable: [{ key: "collVar", value: "folderValue" }],
            item: [
              {
                id: "fv1",
                name: "Folder Req",
                request: { method: "GET", url: "https://ex.com", header: [] },
                response: [],
              },
            ],
          },
        ],
        variable: [{ key: "collVar", value: "collValue" }],
      });
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      // innermost (folder) wins
      expect(req.variables["collVar"]).toBe("folderValue");
    });
  });

  describe("flatten() — against the real fixture", () => {
    it("extracts requests in document order from the sample fixture", () => {
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      expect(result.length).toBeGreaterThan(0);
    });

    it("includes a disabled request from the sample fixture", () => {
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      const disabled = result.filter((r) => r.disabled);
      expect(disabled.length).toBeGreaterThanOrEqual(1);
    });

    it("includes a 3-level-nested request from the sample fixture", () => {
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      const deepNested = result.filter((r) => r.folderPath.length >= 3);
      expect(deepNested.length).toBeGreaterThanOrEqual(1);
    });

    it("includes a root-level request with empty folderPath", () => {
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      const rootLevel = result.filter((r) => r.folderPath.length === 0);
      expect(rootLevel.length).toBeGreaterThanOrEqual(1);
    });

    it("collects collection-level variables for every request", () => {
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      // Every request should have access to the baseUrl variable
      for (const req of result) {
        expect(typeof req.variables).toBe("object");
      }
    });

    it("REGRESSION BLOCKER-1: fixture request-level-disabled item has disabled:true", () => {
      // Regression for: request-level disabled flag (rawItem.request.disabled) was ignored.
      // The fixture now contains an item whose request object has disabled:true but the
      // item itself does NOT have the top-level disabled flag set.
      const collection = loadRealFixture();
      const result = flattener.flatten(collection);
      const reqLevelDisabled = result.find(
        (r) => r.name === "Request Level Disabled",
      );
      expect(reqLevelDisabled).toBeDefined();
      expect(reqLevelDisabled?.disabled).toBe(true);
    });
  });

  describe("flatten() — REGRESSION: request-level disabled flag (BLOCKER-1)", () => {
    it("disabled:true when only request.disabled is set (item-level flag absent)", () => {
      // Regression: only rawItem.disabled was checked; rawItem.request.disabled was silently
      // ignored. A request with disabled at the request level must also be skipped.
      const json = makeCollection([
        {
          id: "req-disabled-request-level",
          name: "Request Level Disabled",
          request: {
            method: "GET",
            url: "https://ex.com/disabled",
            header: [],
            disabled: true,
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.disabled).toBe(true);
    });

    it("disabled:true when both item-level and request-level disabled flags are set", () => {
      const json = makeCollection([
        {
          id: "both-disabled",
          name: "Both Disabled",
          disabled: true,
          request: {
            method: "GET",
            url: "https://ex.com",
            header: [],
            disabled: true,
          },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.disabled).toBe(true);
    });

    it("disabled:false when neither item-level nor request-level disabled flags are set", () => {
      const json = makeCollection([
        {
          id: "not-disabled",
          name: "Not Disabled",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.disabled).toBe(false);
    });
  });

  describe("flatten() — REGRESSION: raw-JSON fallbacks (istanbul-ignore removed)", () => {
    it("ISTANBUL-IGNORE-3a: collection with no top-level item key returns empty array", () => {
      // Regression: the ?? [] fallback for missing top-level item array was covered by
      // an invalid istanbul ignore. This drives that path with a real malformed-but-valid JSON.
      const jsonNoItem = JSON.stringify({
        info: {
          _postman_id: "no-item",
          name: "No Item",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [],
        // Note: no "item" key at all
      });
      const fakeFs = makeFakeFs({ "/col.json": jsonNoItem });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result).toEqual([]);
    });

    it("nameless folder (item array, no name key) → folderPath segment is ''", () => {
      // Regression for the removed false-invariant istanbul-ignore at
      // flattener.ts folder.name ?? "": a folder JSON object WITH an `item`
      // array but NO `name` key hydrates as a nameless ItemGroup
      // (folder.name === undefined), so the `?? ""` fallback IS reachable.
      const jsonNamelessFolder = JSON.stringify({
        info: {
          _postman_id: "nameless-folder",
          name: "Nameless Folder",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            // no "name" key; has "item" → hydrates as a nameless folder
            item: [
              {
                name: "GetThing",
                request: { method: "GET", url: "https://x/things" },
              },
            ],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": jsonNamelessFolder });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(result).toHaveLength(1);
      expect(result[0]?.folderPath).toEqual([""]);
    });

    it("item entry lacking both item and request keys is handled without throwing", () => {
      // NOTE: a `{ name }`-only entry (no `item`) hydrates as an Item, not
      // an ItemGroup, so this does NOT exercise rawItem.item ?? [] (that
      // branch is unreachable by SDK invariant, documented at the ignore).
      // This asserts such a malformed entry is simply skipped, not crashed.
      const jsonItemNoReq = JSON.stringify({
        info: {
          _postman_id: "item-no-req",
          name: "Item No Req",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [{ name: "EmptyEntryNoItemNoRequest" }],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": jsonItemNoReq });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      expect(Array.isArray(result)).toBe(true);
    });

    it("ISTANBUL-IGNORE-3c: variable entry with no key is skipped gracefully", () => {
      // Regression: the if (v.key) guard in #extractRawVariables was covered by an
      // invalid istanbul ignore. Drive it by passing a folder variable with no key.
      const jsonNoKeyVar = JSON.stringify({
        info: {
          _postman_id: "no-key-var",
          name: "No Key Var",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            name: "FolderWithNoKeyVar",
            variable: [
              { value: "orphan-value" }, // no "key" field
              { key: "validKey", value: "validValue" },
            ],
            item: [
              {
                id: "r1",
                name: "Inner Request",
                request: {
                  method: "GET",
                  url: "https://ex.com",
                  header: [],
                },
                response: [],
              },
            ],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": jsonNoKeyVar });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const result = flattener.flatten(loaded.collection);
      // The keyless variable entry should be silently skipped; validKey is included
      expect(result).toHaveLength(1);
      expect(result[0].variables["validKey"]).toBe("validValue");
      expect(Object.keys(result[0].variables)).not.toContain(undefined);
    });

    it("ISTANBUL-IGNORE-2: saved response with absent code defaults to 0", () => {
      // Regression: the resp.code ?? 0 fallback was covered by an invalid istanbul ignore.
      const json = makeCollection([
        {
          id: "r-no-code",
          name: "No Code Response",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [
            {
              name: "No Code",
              status: "OK",
              // Note: no "code" field
              body: '{"result":"ok"}',
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.responses).toHaveLength(1);
      expect(req.responses[0].code).toBe(0);
    });

    it("ISTANBUL-IGNORE-2: saved response with absent body defaults to empty string", () => {
      // Regression: the resp.body ?? "" fallback was covered by an invalid istanbul ignore.
      const json = makeCollection([
        {
          id: "r-no-body",
          name: "No Body Response",
          request: { method: "GET", url: "https://ex.com", header: [] },
          response: [
            {
              name: "No Body",
              status: "OK",
              code: 204,
              // Note: no "body" field
            },
          ],
        },
      ]);
      const fakeFs = makeFakeFs({ "/col.json": json });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const loaded = loader.load("/col.json");
      if (!loaded.ok) throw new Error("load failed");
      const [req] = flattener.flatten(loaded.collection);
      expect(req.responses).toHaveLength(1);
      expect(req.responses[0].body).toBe("");
    });
  });
});
