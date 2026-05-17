import { join, basename } from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OpenApiImporter } from "../../../src/importers/openapi/openapi-importer.js";
import { CompositePostmanImporter } from "../../../src/importers/composite-importer.js";
import { PostmanImporter } from "../../../src/importers/postman/postman-importer.js";
import { SchemaValidator } from "../../../src/core/schema-validator.js";
import { parseJson } from "../../../src/core/safe-json.js";
import type { ImporterFileSystem } from "../../../src/importers/types.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

/**
 * Integration tests for the OpenAPI importer pipeline.
 *
 * Runs OpenApiImporter.openapi() against real fixture files using the real
 * DefaultSwaggerParserSeam (hermetic — fixtures on disk, no network). An
 * in-memory FS fake records mkdirp/writeFile calls so assertions need no
 * real disk writes. Every written .endpoint.json is parsed with parseJson
 * (not raw JSON.parse) and validated with SchemaValidator.
 *
 * Fixtures: tests/fixtures/openapi/sample.openapi.json (3.x)
 *           tests/fixtures/openapi/sample.swagger2.json (2.0)
 */

const OPENAPI_FIXTURE = join(
  process.cwd(),
  "tests/fixtures/openapi/sample.openapi.json",
);

const SWAGGER2_FIXTURE = join(
  process.cwd(),
  "tests/fixtures/openapi/sample.swagger2.json",
);

/** In-memory FS that reads real fixture files but records all writes. */
function makeMemoryFs(): ImporterFileSystem & {
  files: Record<string, string>;
  dirs: string[];
} {
  const files: Record<string, string> = {};
  const dirs: string[] = [];

  return {
    files,
    dirs,
    readFile(path: string): string {
      // Read real fixture files from disk; all others from memory
      try {
        return readFileSync(path, "utf8");
      } catch {
        if (path in files) return files[path];
        const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
    },
    mkdirp(dir: string): void {
      dirs.push(dir);
    },
    writeFile(path: string, contents: string): void {
      files[path] = contents;
    },
  };
}

/**
 * Counts expected (path, method) pairs in a fixture file that the pipeline
 * should successfully convert. Built programmatically from the fixture —
 * NOT a hardcoded number.
 *
 * For OpenAPI 3.x: counts operations in paths that use the seven canonical
 * HTTP methods. The fixture is authored so every operation converts
 * successfully (no intentional drops).
 * @throws {Error} When the fixture file contains invalid JSON.
 */
function computeExpectedWrittenCount(fixturePath: string): number {
  const raw = readFileSync(fixturePath, "utf8");
  const result = parseJson(raw);
  if (!result.ok) throw new Error(`Invalid fixture JSON: ${result.error}`);

  const doc = result.value as Record<string, unknown>;
  const paths = (doc["paths"] as Record<string, unknown>) ?? {};
  const SUPPORTED_METHODS = new Set([
    "get", "post", "put", "patch", "delete", "head", "options",
  ]);

  let count = 0;
  for (const pathItem of Object.values(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    for (const [key] of Object.entries(pathItem as Record<string, unknown>)) {
      if (SUPPORTED_METHODS.has(key.toLowerCase())) {
        count++;
      }
    }
  }
  return count;
}

/** Deep-scan a value for any occurrence of "$ref" key. */
function containsRef(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some(containsRef);
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "$ref") return true;
    if (containsRef(v)) return true;
  }
  return false;
}

describe("OpenApiImporter — integration with OpenAPI 3.x fixture", () => {
  it("resolves ImportOutcome with written > 0 for the sample OpenAPI 3.x fixture", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    expect(result.written).toBeGreaterThan(0);
  });

  it("written count equals computed expected count of (path, method) operations", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    const expected = computeExpectedWrittenCount(OPENAPI_FIXTURE);
    expect(result.written).toBe(expected);
  });

  it("produces at least one .endpoint.json file", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.keys(memFs.files).filter((p) =>
      p.endsWith(".endpoint.json"),
    );
    expect(endpointFiles.length).toBeGreaterThan(0);
  });

  it("every written endpoint passes SchemaValidator.validateEndpoint with valid:true", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const validator = new SchemaValidator();
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const validation = validator.validateEndpoint(parsed.value);
      expect(validation.valid).toBe(true);
    }
  });

  it("every written endpoint has source.type === 'openapi'", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      expect(ep.source?.type).toBe("openapi");
    }
  });

  it("every written endpoint has source.spec_url equal to the fixture basename", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const expectedSourceId = basename(OPENAPI_FIXTURE);
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      expect(ep.source?.spec_url).toBe(expectedSourceId);
    }
  });

  it("no written endpoint schema contains a $ref string (proves full dereference)", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      // Check body_schema, response.schema, query_params schemas
      expect(containsRef(ep.request?.body_schema)).toBe(false);
      expect(containsRef(ep.response?.schema)).toBe(false);
      expect(containsRef(ep.request?.query_params)).toBe(false);
    }
  });

  it("the 201/400 operation's endpoint has response.expected_status === 201 (2xx preferred)", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    // Find the createUser endpoint (POST /users) which has 201 and 400 responses
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    const createUserEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.method === "POST" && ep.url === "/users";
    });
    if (createUserEp) {
      const parsed = parseJson(createUserEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect(ep.response.expected_status).toBe(201);
      }
    }
  });

  it("tag directory mirroring: creates files under nested tag subdirectories", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const paths = Object.keys(memFs.files);
    // Fixture has 'Users' and 'Admin' tags so we expect slugified directories
    expect(paths.some((p) => p.includes("/users/"))).toBe(true);
    expect(paths.some((p) => p.includes("/admin/"))).toBe(true);
  });

  it("unmapped security (oauth2 scheme on getReports) produces a manual-review warning", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    // The oauth2Scheme is unmapped → warning must appear
    expect(
      result.warnings.some(
        (w) =>
          w.toLowerCase().includes("oauth2") ||
          w.toLowerCase().includes("unmapped") ||
          w.toLowerCase().includes("auth_strategy manually"),
      ),
    ).toBe(true);
  });

  it("the unmapped-security (oauth2) endpoint has no auth_strategy field", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    // Find the getReports endpoint (GET /admin/reports)
    const reportsEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.url === "/admin/reports";
    });
    if (reportsEp) {
      const parsed = parseJson(reportsEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect("auth_strategy" in ep).toBe(false);
      }
    }
  });

  it("the bearer-secured endpoint (getUser) has auth_strategy === 'user_token'", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    // getUser endpoint is GET /users/{id} with root-level bearerAuth default
    const getUserEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.url === "/users/{id}" && ep.method === "GET";
    });
    if (getUserEp) {
      const parsed = parseJson(getUserEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect(ep.auth_strategy).toBe("user_token");
      }
    }
  });

  it("the healthCheck endpoint (explicit empty security) has no auth_strategy", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: OPENAPI_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    const healthEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.url === "/health";
    });
    if (healthEp) {
      const parsed = parseJson(healthEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect("auth_strategy" in ep).toBe(false);
      }
    }
  });

  it("multi-tag operation (createUser with ['Users','Admin']) produces a multi-tag warning", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("multiple tags")),
    ).toBe(true);
  });

  it("warnings array is an array of strings", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    expect(Array.isArray(result.warnings)).toBe(true);
    for (const w of result.warnings) {
      expect(typeof w).toBe("string");
    }
  });
});

describe("OpenApiImporter — integration with Swagger 2.0 fixture", () => {
  it("resolves ImportOutcome with written > 0 for the Swagger 2.0 fixture", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: SWAGGER2_FIXTURE,
      outputDir: "/out",
    });
    expect(result.written).toBeGreaterThan(0);
  });

  it("written count equals computed expected count for the Swagger 2.0 fixture", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    const result = await importer.openapi({
      source: SWAGGER2_FIXTURE,
      outputDir: "/out",
    });
    const expected = computeExpectedWrittenCount(SWAGGER2_FIXTURE);
    expect(result.written).toBe(expected);
  });

  it("every written endpoint passes SchemaValidator.validateEndpoint for Swagger 2.0", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    const validator = new SchemaValidator();
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const validation = validator.validateEndpoint(parsed.value);
      expect(validation.valid).toBe(true);
    }
  });

  it("every written Swagger 2.0 endpoint has source.type === 'openapi'", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      expect(ep.source?.type).toBe("openapi");
    }
  });

  it("every written Swagger 2.0 endpoint has source.spec_url equal to the fixture basename", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    const expectedSourceId = basename(SWAGGER2_FIXTURE);
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      expect(ep.source?.spec_url).toBe(expectedSourceId);
    }
  });

  it("no written Swagger 2.0 endpoint schema contains a $ref string", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    for (const [path, contents] of Object.entries(memFs.files)) {
      if (!path.endsWith(".endpoint.json")) continue;
      const parsed = parseJson(contents);
      if (!parsed.ok) continue;
      const ep = parsed.value as CanonicalEndpoint;
      expect(containsRef(ep.request?.body_schema)).toBe(false);
      expect(containsRef(ep.response?.schema)).toBe(false);
    }
  });

  it("the Swagger 2.0 apiKey-secured endpoint has auth_strategy === 'api_key'", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    // listPets uses apiKeyAuth → should map to api_key
    const listPetsEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.url === "/pets" && ep.method === "GET";
    });
    if (listPetsEp) {
      const parsed = parseJson(listPetsEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect(ep.auth_strategy).toBe("api_key");
      }
    }
  });

  it("the 201/400 Swagger 2.0 operation (createPet) has response.expected_status === 201", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
      p.endsWith(".endpoint.json"),
    );
    const createPetEp = endpointFiles.find(([, contents]) => {
      const parsed = parseJson(contents);
      if (!parsed.ok) return false;
      const ep = parsed.value as CanonicalEndpoint;
      return ep.method === "POST" && ep.url === "/pets";
    });
    if (createPetEp) {
      const parsed = parseJson(createPetEp[1]);
      if (parsed.ok) {
        const ep = parsed.value as CanonicalEndpoint;
        expect(ep.response.expected_status).toBe(201);
      }
    }
  });

  it("directory tree contains tag-based subdirectories for Swagger 2.0", async () => {
    const memFs = makeMemoryFs();
    const importer = new OpenApiImporter({ fs: memFs });
    await importer.openapi({ source: SWAGGER2_FIXTURE, outputDir: "/out" });
    const paths = Object.keys(memFs.files);
    // Fixture tags: Pets, Store
    expect(paths.some((p) => p.includes("/pets/") || p.includes("/store/"))).toBe(true);
  });
});

describe("CompositePostmanImporter — openapi() after Task #5 wiring (integration)", () => {
  it("openapi() resolves (no longer rejects with NotImplementedError) using real fixture", async () => {
    const memFs = makeMemoryFs();
    const openApiImporter = new OpenApiImporter({ fs: memFs });
    const composite = new CompositePostmanImporter({
      openApiImporter,
    });
    const result = await composite.openapi({
      source: OPENAPI_FIXTURE,
      outputDir: "/out",
    });
    expect(result.written).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("postman() via composite still works after Task #5 (no regression)", async () => {
    // Use a fake OpenApiImporter so no real openapi call is made
    const fakeOpenApi = {
      async openapi(_: unknown) {
        return { written: 0, warnings: [] };
      },
    };
    // postman fixture
    const POSTMAN_FIXTURE = join(
      process.cwd(),
      "tests/fixtures/postman/sample.postman_collection.json",
    );
    // Inject a PostmanImporter with a memory FS so real disk writes are not needed
    const memFs = makeMemoryFs();
    const postmanImporter = new PostmanImporter({ fs: memFs });
    const composite = new CompositePostmanImporter({
      postmanImporter,
      openApiImporter: fakeOpenApi as unknown as OpenApiImporter,
    });
    const result = await composite.postman({
      file: POSTMAN_FIXTURE,
      outputDir: "/out",
    });
    // Postman pipeline should still work (written > 0 for the real fixture)
    expect(result.written).toBeGreaterThan(0);
  });
});
