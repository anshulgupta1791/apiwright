import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PostmanOutputWriter } from "../../../../src/importers/postman/output-writer.js";
import type { WritableEndpoint } from "../../../../src/importers/postman/output-writer.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import { parseJson } from "../../../../src/core/safe-json.js";

/**
 * Unit tests for PostmanOutputWriter.
 *
 * All disk access uses an in-memory fake FS — no real disk. Covers: folder
 * hierarchy mirroring, root-level endpoints (empty folderPath), name collision
 * dedupe, empty name fallback, stable key order (deterministic JSON), file
 * contents parsed with parseJson (not raw JSON.parse), and default-seam wiring.
 */

/** In-memory fake FS that records all mkdirp and writeFile calls. */
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
    response: { expected_status: 200, schema: {} },
    source: { type: "postman", collection: "sample.json" },
    ...overrides,
  };
}

function makeWritable(
  endpoint: CanonicalEndpoint,
  folderPath: string[],
): WritableEndpoint {
  return { endpoint, folderPath };
}

describe("PostmanOutputWriter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a write method", () => {
      const writer = new PostmanOutputWriter();
      expect(typeof writer.write).toBe("function");
    });
  });

  describe("write() — root-level endpoints (empty folderPath)", () => {
    it("writes directly under outputDir when folderPath is empty", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const item = makeWritable(makeEndpoint({ name: "Health Check" }), []);
      writer.write([item], "/output");
      const paths = Object.keys(files);
      expect(
        paths.some((p) => p.startsWith("/output/") && !p.includes("/output/")),
      ).toBe(false);
      // The file should be directly under /output
      expect(
        paths.some((p) => p === "/output/health_check.endpoint.json"),
      ).toBe(true);
    });

    it("calls mkdirp with the outputDir itself when folderPath is empty", () => {
      const { fs, dirs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), [])], "/output");
      expect(dirs.some((d) => d === "/output")).toBe(true);
    });

    it("returns written:1 for a single root-level endpoint", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const result = writer.write([makeWritable(makeEndpoint(), [])], "/out");
      expect(result.written).toBe(1);
    });
  });

  describe("write() — folder hierarchy mirroring", () => {
    it("writes to subdirectory for single-folder path", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), ["Users"])], "/output");
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("/users/"))).toBe(true);
    });

    it("mirrors two-level folder path [Users, Admin] → /output/users/admin/", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [
          makeWritable(makeEndpoint({ name: "Admin Users" }), [
            "Users",
            "Admin",
          ]),
        ],
        "/output",
      );
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("/users/admin/"))).toBe(true);
    });

    it("creates the mirrored directory via mkdirp", () => {
      const { fs, dirs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [makeWritable(makeEndpoint(), ["Users", "Admin"])],
        "/output",
      );
      expect(
        dirs.some(
          (d) => d.endsWith("/users/admin") || d.includes("/users/admin"),
        ),
      ).toBe(true);
    });

    it("produces correct path for three-level nesting", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [
          makeWritable(makeEndpoint({ name: "Get Metrics" }), [
            "Users",
            "Admin",
            "Internal",
          ]),
        ],
        "/output",
      );
      const paths = Object.keys(files);
      expect(paths.some((p) => p.includes("/users/admin/internal/"))).toBe(
        true,
      );
    });
  });

  describe("write() — filename generation", () => {
    it("writes file with name slug + .endpoint.json extension", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [makeWritable(makeEndpoint({ name: "Create User" }), [])],
        "/out",
      );
      expect(Object.keys(files)).toContain("/out/create_user.endpoint.json");
    });

    it("uses 'unnamed.endpoint.json' when endpoint name is empty", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint({ name: "" }), [])], "/out");
      expect(Object.keys(files).some((p) => p.includes("unnamed"))).toBe(true);
    });

    it("sanitizes special characters in folder names", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [makeWritable(makeEndpoint({ name: "Endpoint!" }), ["My Folder!"])],
        "/out",
      );
      const paths = Object.keys(files);
      expect(paths.some((p) => /my_folder/.test(p))).toBe(true);
    });
  });

  describe("write() — name collision dedupe", () => {
    it("gives second endpoint with same path+name a _2 suffix", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ name: "Create User", id: "cu1" }), []),
        makeWritable(makeEndpoint({ name: "Create User", id: "cu2" }), []),
      ];
      writer.write(items, "/out");
      const paths = Object.keys(files);
      expect(paths).toContain("/out/create_user.endpoint.json");
      expect(paths.some((p) => p.includes("create_user_2"))).toBe(true);
    });

    it("emits a rename warning on collision", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ name: "Create User", id: "cu1" }), []),
        makeWritable(makeEndpoint({ name: "Create User", id: "cu2" }), []),
      ];
      const result = writer.write(items, "/out");
      expect(
        result.warnings.some((w) => w.toLowerCase().includes("collision")),
      ).toBe(true);
    });

    it("never throws on name collision", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ name: "Same Name", id: "s1" }), []),
        makeWritable(makeEndpoint({ name: "Same Name", id: "s2" }), []),
        makeWritable(makeEndpoint({ name: "Same Name", id: "s3" }), []),
      ];
      expect(() => writer.write(items, "/out")).not.toThrow();
    });

    it("returns correct written count even with collisions", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ name: "Same Name", id: "s1" }), []),
        makeWritable(makeEndpoint({ name: "Same Name", id: "s2" }), []),
      ];
      const result = writer.write(items, "/out");
      expect(result.written).toBe(2);
    });
  });

  describe("write() — file contents (stable JSON)", () => {
    it("writes valid JSON parseable via parseJson", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), [])], "/out");
      const path = Object.keys(files)[0]!;
      const parsed = parseJson(files[path] ?? "");
      expect(parsed.ok).toBe(true);
    });

    it("written JSON includes the endpoint id", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write(
        [makeWritable(makeEndpoint({ id: "users_list" }), [])],
        "/out",
      );
      const path = Object.keys(files)[0]!;
      const parsed = parseJson(files[path] ?? "");
      if (!parsed.ok) throw new Error("parse failed");
      expect((parsed.value as Record<string, unknown>)["id"]).toBe(
        "users_list",
      );
    });

    it("written JSON has deterministic key order: id comes before name", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), [])], "/out");
      const path = Object.keys(files)[0]!;
      const json = files[path] ?? "";
      const idPos = json.indexOf('"id"');
      const namePos = json.indexOf('"name"');
      expect(idPos).toBeLessThan(namePos);
    });

    it("re-running write produces byte-identical output (diff-clean)", () => {
      const { fs: fs1, files: files1 } = makeFakeFs();
      const { fs: fs2, files: files2 } = makeFakeFs();
      const endpoint = makeEndpoint();
      const writer1 = new PostmanOutputWriter({ fs: fs1 });
      const writer2 = new PostmanOutputWriter({ fs: fs2 });
      writer1.write([makeWritable(endpoint, [])], "/out");
      writer2.write([makeWritable(endpoint, [])], "/out");
      const path = Object.keys(files1)[0];
      expect(files1[path]).toBe(files2[path]);
    });

    it("written JSON has two-space indentation", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      writer.write([makeWritable(makeEndpoint(), [])], "/out");
      const path = Object.keys(files)[0]!;
      const json = files[path] ?? "";
      expect(json).toContain("  ");
    });
  });

  describe("write() — empty items array", () => {
    it("returns written:0 and no warnings for empty items array", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const result = writer.write([], "/out");
      expect(result.written).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("write() — multiple endpoints", () => {
    it("writes N endpoints and returns written count N", () => {
      const { fs } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const items = [
        makeWritable(makeEndpoint({ id: "ep1", name: "Endpoint 1" }), []),
        makeWritable(makeEndpoint({ id: "ep2", name: "Endpoint 2" }), [
          "Folder",
        ]),
        makeWritable(makeEndpoint({ id: "ep3", name: "Endpoint 3" }), [
          "Folder",
          "Sub",
        ]),
      ];
      const result = writer.write(items, "/out");
      expect(result.written).toBe(3);
    });
  });

  describe("write() — non-canonical keys in serialized output (remainingKeys branch)", () => {
    it("appends a non-canonical key after all canonical keys in the JSON output", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      // Cast to CanonicalEndpoint to inject an extra key that is not in CANONICAL_KEY_ORDER
      const endpointWithExtra = {
        ...makeEndpoint({ id: "extra_key_test", name: "Extra Key Endpoint" }),
        _extra: "x",
      } as unknown as CanonicalEndpoint;
      writer.write([makeWritable(endpointWithExtra, [])], "/out");
      const path = Object.keys(files)[0]!;
      const json = files[path] ?? "";
      // The canonical key "id" must appear before the non-canonical "_extra"
      const idPos = json.indexOf('"id"');
      const extraPos = json.indexOf('"_extra"');
      expect(idPos).toBeGreaterThanOrEqual(0);
      expect(extraPos).toBeGreaterThanOrEqual(0);
      expect(idPos).toBeLessThan(extraPos);
    });

    it("non-canonical key value is preserved correctly in the JSON output", () => {
      const { fs, files } = makeFakeFs();
      const writer = new PostmanOutputWriter({ fs });
      const endpointWithExtra = {
        ...makeEndpoint({ id: "extra_val_test", name: "Extra Val Endpoint" }),
        _extra: "extra-value",
      } as unknown as CanonicalEndpoint;
      writer.write([makeWritable(endpointWithExtra, [])], "/out");
      const path = Object.keys(files)[0]!;
      const parsed = parseJson(files[path] ?? "");
      if (!parsed.ok) throw new Error("parse failed");
      expect((parsed.value as Record<string, unknown>)["_extra"]).toBe(
        "extra-value",
      );
    });
  });
});
