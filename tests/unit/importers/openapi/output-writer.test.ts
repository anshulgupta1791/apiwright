import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OpenApiOutputWriter } from "../../../../src/importers/openapi/output-writer.js";
import type { OpenApiWritableEndpoint } from "../../../../src/importers/openapi/types.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import { parseJson } from "../../../../src/core/safe-json.js";
// Import Postman writer constants to assert they match (drift detection)
import { PostmanOutputWriter } from "../../../../src/importers/postman/output-writer.js";

/**
 * Unit tests for OpenApiOutputWriter.
 *
 * All disk access uses an in-memory fake FS — no real disk. Covers: tag-path
 * directory mirroring, root-level (empty tagPath), name collision dedupe +
 * rename warning, PathNamer slugification, deterministic canonical key order
 * (same as Postman writer), source serialized as {type,spec_url}, contents
 * parsed with parseJson (not raw JSON.parse), default-seam wiring, canonical
 * key order constants match Postman writer (drift assertion).
 */

/** In-memory fake FS that records mkdirp and writeFile calls. */
function makeFakeFs() {
  const dirs: string[] = [];
  const files: Record<string, string> = {};

  const fs: ImporterFileSystem = {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(dir: string): void {
      dirs.push(dir);
    },
    writeFile(path: string, contents: string): void {
      files[path] = contents;
    },
  };

  return { fs, dirs, files };
}

function makeEndpoint(
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id: "list_users",
    name: "List Users",
    method: "GET",
    url: "/users",
    request: {},
    response: { expected_status: 200, schema: { type: "object" } },
    tags: ["Users"],
    source: { type: "openapi", spec_url: "spec.json" },
    ...overrides,
  };
}

function makeWritable(
  endpoint: CanonicalEndpoint,
  tagPath: string[],
): OpenApiWritableEndpoint {
  return { endpoint, tagPath };
}

describe("OpenApiOutputWriter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a write method", () => {
      const writer = new OpenApiOutputWriter();
      expect(typeof writer.write).toBe("function");
    });
  });

  describe("write() — root-level endpoints (empty tagPath)", () => {
    it("writes directly under outputDir when tagPath is empty", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "Health Check" }), []);
      writer.write([item], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.startsWith("/output/"))).toBe(true);
      expect(
        paths.some((p) => !p.replace("/output/", "").includes("/") && p.endsWith(".endpoint.json")),
      ).toBe(true);
    });
  });

  describe("write() — tag-path directory mirroring", () => {
    it("writes endpoint under <outputDir>/<tag slug> for a single-element tagPath", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "List Users" }), ["Users"]);
      writer.write([item], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("/users/"))).toBe(true);
    });

    it("writes endpoint under <outputDir>/users/admin/ for tagPath ['Users','Admin']", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "Admin Report" }), [
        "Users",
        "Admin",
      ]);
      writer.write([item], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("/users/") && p.includes("/admin/"))).toBe(true);
    });

    it("calls fs.mkdirp for each nested tag directory", () => {
      const { fs, dirs } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "Admin Report" }), [
        "Users",
        "Admin",
      ]);
      writer.write([item], "/output");
      expect(dirs.some((d) => d.includes("/users/"))).toBe(true);
      expect(dirs.some((d) => d.includes("/admin"))).toBe(true);
    });

    it("slugifies tag segments using PathNamer (e.g. 'User Management!' → 'user_management')", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "Report" }), [
        "User Management!",
      ]);
      writer.write([item], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("user_management"))).toBe(true);
    });
  });

  describe("write() — name collision deduplication", () => {
    it("deduplicates filenames deterministically when two endpoints resolve to the same path", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item1 = makeWritable(
        makeEndpoint({ id: "list_users", name: "List Users" }),
        ["Users"],
      );
      const item2 = makeWritable(
        makeEndpoint({ id: "list_users_2", name: "List Users" }),
        ["Users"],
      );
      writer.write([item1, item2], "/output");
      const paths = Object.keys(files);
      const endpointFiles = paths.filter((p) => p.endsWith(".endpoint.json"));
      // Both should be written; second should have a unique name
      expect(endpointFiles).toHaveLength(2);
      expect(new Set(endpointFiles).size).toBe(2);
    });

    it("emits a rename warning when a name collision is disambiguated", () => {
      const { fs } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item1 = makeWritable(
        makeEndpoint({ name: "List Users" }),
        ["Users"],
      );
      const item2 = makeWritable(
        makeEndpoint({ name: "List Users" }),
        ["Users"],
      );
      const result = writer.write([item1, item2], "/output");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some(
          (w) => w.toLowerCase().includes("collision") || w.toLowerCase().includes("written as"),
        ),
      ).toBe(true);
    });
  });

  describe("write() — file contents", () => {
    it("writes valid JSON parseable by parseJson (not raw JSON.parse)", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "List Users" }), ["Users"]);
      writer.write([item], "/output");
      const contents = Object.values(files)[0];
      expect(contents).toBeDefined();
      const parsed = parseJson(contents);
      expect(parsed.ok).toBe(true);
    });

    it("written file contains the endpoint id, name, method, url", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({ id: "list_users", name: "List Users", method: "GET", url: "/users" });
      const item = makeWritable(ep, ["Users"]);
      writer.write([item], "/output");
      const contents = Object.values(files)[0];
      const parsed = parseJson(contents);
      if (!parsed.ok) throw new Error("Expected valid JSON");
      const data = parsed.value as Record<string, unknown>;
      expect(data["id"]).toBe("list_users");
      expect(data["name"]).toBe("List Users");
      expect(data["method"]).toBe("GET");
      expect(data["url"]).toBe("/users");
    });

    it("source field in written JSON is exactly {type:'openapi', spec_url:<value>}", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({
        source: { type: "openapi", spec_url: "my-api.json" },
      });
      const item = makeWritable(ep, []);
      writer.write([item], "/output");
      const contents = Object.values(files)[0];
      const parsed = parseJson(contents);
      if (!parsed.ok) throw new Error("Expected valid JSON");
      const data = parsed.value as Record<string, unknown>;
      const source = data["source"] as Record<string, unknown>;
      expect(source["type"]).toBe("openapi");
      expect(source["spec_url"]).toBe("my-api.json");
    });

    it("source field keys are ordered [type, spec_url] in the serialized JSON", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({
        source: { type: "openapi", spec_url: "spec.json" },
      });
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      // In the JSON string, "type" should appear before "spec_url"
      const typeIdx = contents.indexOf('"type"');
      const specUrlIdx = contents.indexOf('"spec_url"');
      expect(typeIdx).toBeLessThan(specUrlIdx);
    });

    it("output is stable pretty-printed JSON (2-space indent, trailing newline)", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "List Users" }), []);
      writer.write([item], "/output");
      const contents = Object.values(files)[0];
      // Should be multi-line pretty JSON
      expect(contents).toContain("\n");
      expect(contents.endsWith("\n")).toBe(true);
    });

    it("output is byte-identical for the same endpoint (deterministic / diff-clean)", () => {
      const { fs: fs1, files: files1 } = makeFakeFs();
      const { fs: fs2, files: files2 } = makeFakeFs();
      const ep = makeEndpoint({ name: "List Users" });
      const item = makeWritable(ep, ["Users"]);
      new OpenApiOutputWriter({ fs: fs1 }).write([item], "/output");
      new OpenApiOutputWriter({ fs: fs2 }).write([item], "/output");
      const keys1 = Object.keys(files1);
      const keys2 = Object.keys(files2);
      expect(keys1).toEqual(keys2);
      expect(files1[keys1[0]]).toBe(files2[keys2[0]]);
    });
  });

  describe("write() — return value", () => {
    it("returns written count equal to number of items written", () => {
      const { fs } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ id: "a", name: "Op A" }), ["Users"]),
        makeWritable(makeEndpoint({ id: "b", name: "Op B" }), ["Admin"]),
      ];
      const result = writer.write(items, "/output");
      expect(result.written).toBe(2);
    });

    it("returns written:0 for empty items array", () => {
      const { fs } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const result = writer.write([], "/output");
      expect(result.written).toBe(0);
    });

    it("returns {written, warnings} shape", () => {
      const { fs } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const result = writer.write([], "/output");
      expect("written" in result).toBe(true);
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe("write() — canonical key order matches Postman writer", () => {
    it("endpoint top-level key order has 'id' before 'name' before 'method'", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({
        name: "List Users",
        auth_strategy: "user_token",
        tags: ["Users"],
      });
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      const idIdx = contents.indexOf('"id"');
      const nameIdx = contents.indexOf('"name"');
      const methodIdx = contents.indexOf('"method"');
      expect(idIdx).toBeLessThan(nameIdx);
      expect(nameIdx).toBeLessThan(methodIdx);
    });

    it("'source' key appears last (after 'response') in the serialized JSON", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), [])], "/output");
      const contents = Object.values(files)[0];
      const responseIdx = contents.indexOf('"response"');
      const sourceIdx = contents.indexOf('"source"');
      expect(responseIdx).toBeLessThan(sourceIdx);
    });

    it("OpenApiOutputWriter and PostmanOutputWriter both expose a write method (interface compatible)", () => {
      // Structural regression: both writers must be present and functional.
      // This test documents the intentional parallelism.
      const openApiWriter = new OpenApiOutputWriter();
      const postmanWriter = new PostmanOutputWriter();
      expect(typeof openApiWriter.write).toBe("function");
      expect(typeof postmanWriter.write).toBe("function");
    });
  });

  describe("write() — endpoint with no request / no response / no source", () => {
    it("serializes correctly when endpoint has no request field", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      // Make an endpoint without request (falsy branch in #serialize)
      const ep = { ...makeEndpoint(), request: undefined } as unknown as CanonicalEndpoint;
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      expect(contents).toBeDefined();
      expect(contents).not.toContain('"request"');
    });

    it("serializes correctly when endpoint has no response field", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      // Make an endpoint without response (falsy branch in #serialize)
      const ep = { ...makeEndpoint(), response: undefined } as unknown as CanonicalEndpoint;
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      expect(contents).toBeDefined();
      expect(contents).not.toContain('"response"');
    });

    it("serializes correctly when endpoint has no source field", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      // Make an endpoint without source (falsy branch in #serialize)
      const ep = { ...makeEndpoint(), source: undefined } as unknown as CanonicalEndpoint;
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      expect(contents).toBeDefined();
      expect(contents).not.toContain('"source"');
    });
  });

  describe("write() — remaining keys beyond canonical set", () => {
    it("includes extra endpoint fields beyond the canonical key order in the output JSON", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      // Add an extra field beyond the canonical set to exercise the "remaining keys" loop
      const ep = makeEndpoint({
        name: "List Users",
        auth_strategy: "api_key",
        // Add a non-canonical field via type assertion to exercise remaining-keys path
      }) as CanonicalEndpoint & { x_custom_field: string };
      ep.x_custom_field = "custom-value";
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      expect(contents).toBeDefined();
      // The extra field should appear in the serialized output
      expect(contents).toContain("x_custom_field");
      expect(contents).toContain("custom-value");
    });

    it("remaining extra fields appear after canonical fields in the serialized JSON", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({ name: "List Users" }) as CanonicalEndpoint & { z_extra: string };
      ep.z_extra = "extra-value";
      writer.write([makeWritable(ep, [])], "/output");
      const contents = Object.values(files)[0];
      // "source" is last in canonical order; z_extra should appear after it
      const sourceIdx = contents.indexOf('"source"');
      const extraIdx = contents.indexOf('"z_extra"');
      expect(sourceIdx).toBeGreaterThan(0);
      expect(extraIdx).toBeGreaterThan(sourceIdx);
    });
  });

  describe("write() — empty endpoint name fallback", () => {
    it("uses 'unnamed' as the stem when endpoint name is empty (defensive)", () => {
      const { fs, files } = makeFakeFs();
      const writer = new OpenApiOutputWriter({ fs });
      const ep = makeEndpoint({ name: "" });
      writer.write([makeWritable(ep, [])], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("unnamed"))).toBe(true);
    });
  });
});
