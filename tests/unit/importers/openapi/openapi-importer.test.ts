import { describe, expect, it } from "vitest";

import { OpenApiImporter } from "../../../../src/importers/openapi/openapi-importer.js";
import type { OpenApiSpecLoader } from "../../../../src/importers/openapi/spec-loader.js";
import type { OperationFlattener } from "../../../../src/importers/openapi/operation-flattener.js";
import type { OpenApiEndpointAssembler } from "../../../../src/importers/openapi/endpoint-assembler.js";
import type { OpenApiOutputWriter } from "../../../../src/importers/openapi/output-writer.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type {
  SpecLoadResult,
  FlattenResult,
  ConversionResult,
  OutputWriteResult,
  LoadedSpec,
  FlattenedOperation,
  OpenApiWritableEndpoint,
} from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for OpenApiImporter (the orchestrator).
 *
 * All collaborators are injected as fakes — no real disk, no real network.
 * Covers: successful import (3.x and 2.0), failed load → written:0 + single
 * warning + never throws, partial success (one op fails), all ops fail
 * (written:0), writer ImporterFsError → warning + written:0, circular-ref
 * warning surfaced, default-seam wiring (no-options construction), deterministic
 * warning order, ImportOutcome shape.
 */

/** A valid LoadedSpec for use in fakes. */
const LOADED_SPEC_3X: LoadedSpec = {
  document: { openapi: "3.0.3", paths: {} },
  flavor: "openapi-3",
  baseUrl: "/",
  sourceId: "spec.json",
  circular: false,
};

const LOADED_SPEC_2X: LoadedSpec = {
  document: { swagger: "2.0", paths: {} },
  flavor: "swagger-2",
  baseUrl: "https://api.example.com/v2",
  sourceId: "swagger.json",
  circular: false,
};

/** A valid assembled endpoint (minimal schema-valid). */
const VALID_ENDPOINT = {
  id: "list_users",
  name: "List Users",
  method: "GET" as const,
  url: "/users",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
  tags: ["Users"],
  source: { type: "openapi" as const, spec_url: "spec.json" },
};

/** A minimal FlattenedOperation. */
const FLAT_OP: FlattenedOperation = {
  path: "/users",
  method: "GET",
  summary: "List users",
  description: "",
  tags: ["Users"],
  parameters: [],
  responses: [],
};

/** Fake spec loader that returns a canned SpecLoadResult. */
function makeFakeLoader(result: SpecLoadResult): OpenApiSpecLoader {
  return {
    async load(_source: string): Promise<SpecLoadResult> {
      return result;
    },
  } as unknown as OpenApiSpecLoader;
}

/** Fake flattener that returns canned operations and warnings. */
function makeFakeFlattener(
  operations: FlattenedOperation[],
  warnings: string[] = [],
): OperationFlattener {
  return {
    flatten(_spec: LoadedSpec): FlattenResult {
      return { operations, warnings };
    },
  } as unknown as OperationFlattener;
}

/** Fake assembler that returns canned ConversionResult per call. */
function makeFakeAssembler(
  results: Array<ConversionResult>,
): OpenApiEndpointAssembler {
  let callIndex = 0;
  return {
    assemble(
      _op: FlattenedOperation,
      _spec: LoadedSpec,
      _usedIds: Set<string>,
    ): ConversionResult {
      return results[callIndex++] ?? { warnings: [] };
    },
  } as unknown as OpenApiEndpointAssembler;
}

/** Fake output writer that returns canned result. */
function makeFakeWriter(
  result: OutputWriteResult,
  throwError?: Error,
): OpenApiOutputWriter {
  return {
    write(
      _items: readonly OpenApiWritableEndpoint[],
      _outputDir: string,
    ): OutputWriteResult {
      if (throwError) throw throwError;
      return result;
    },
  } as unknown as OpenApiOutputWriter;
}

/** In-memory fake FS. */
function makeFakeFs(): ImporterFileSystem {
  const files: Record<string, string> = {};
  return {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(path: string, contents: string): void {
      files[path] = contents;
    },
  };
}

describe("OpenApiImporter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes an openapi method", () => {
      const importer = new OpenApiImporter();
      expect(typeof importer.openapi).toBe("function");
    });

    it("constructs with partial options (only fs provided)", () => {
      const importer = new OpenApiImporter({ fs: makeFakeFs() });
      expect(typeof importer.openapi).toBe("function");
    });
  });

  describe("openapi() — successful import from 3.x spec", () => {
    it("resolves with written > 0 when the load succeeds and operations convert", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: true,
          spec: LOADED_SPEC_3X,
          warnings: [],
        }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: VALID_ENDPOINT, warnings: [] },
        ]),
        writer: makeFakeWriter({ written: 1, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(1);
    });

    it("resolves with an ImportOutcome shape {written, warnings}", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect("written" in result).toBe(true);
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("surfaces loader warnings (e.g. circular-ref warning) in ImportOutcome", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: true,
          spec: { ...LOADED_SPEC_3X, circular: true },
          warnings: ["Spec contains a circular $ref"],
        }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/circular.json",
        outputDir: "/output",
      });
      expect(
        result.warnings.some((w) => w.includes("circular")),
      ).toBe(true);
    });
  });

  describe("openapi() — successful import from 2.0 spec", () => {
    it("resolves with written > 0 for a Swagger 2.0 input", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: true,
          spec: LOADED_SPEC_2X,
          warnings: [],
        }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: { ...VALID_ENDPOINT, source: { type: "openapi", spec_url: "swagger.json" } }, warnings: [] },
        ]),
        writer: makeFakeWriter({ written: 1, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/swagger.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(1);
    });
  });

  describe("openapi() — failed load", () => {
    it("resolves with written:0 when the spec fails to load", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: false,
          error: "OpenAPI spec file not found: '/missing.json'",
        }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/missing.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(0);
    });

    it("resolves with exactly one descriptive warning when load fails", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: false,
          error: "Failed to load OpenAPI/Swagger spec '/bad.yaml': Invalid YAML",
        }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/bad.yaml",
        outputDir: "/output",
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Failed to load");
    });

    it("never throws when the spec fails to load — always resolves", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: false, error: "Not found" }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      await expect(
        importer.openapi({ source: "/x.json", outputDir: "/out" }),
      ).resolves.toBeDefined();
    });
  });

  describe("openapi() — partial success (one op fails conversion)", () => {
    it("writes the convertible operations and skips the failed ones", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP, FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: VALID_ENDPOINT, warnings: [] },
          { endpoint: undefined, warnings: ["Validation failed"] },
        ]),
        writer: makeFakeWriter({ written: 1, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(1);
    });

    it("surfaces conversion failure warnings when an op is dropped", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: undefined, warnings: ["Schema validation failed"] },
        ]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect(
        result.warnings.some((w) => w.includes("Schema validation failed")),
      ).toBe(true);
    });

    it("still resolves (never throws) when all ops fail conversion", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP, FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: undefined, warnings: ["bad"] },
          { endpoint: undefined, warnings: ["also bad"] },
        ]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      await expect(
        importer.openapi({ source: "/spec.json", outputDir: "/output" }),
      ).resolves.toBeDefined();
    });

    it("resolves written:0 when all ops fail conversion", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([{ endpoint: undefined, warnings: [] }]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(0);
    });
  });

  describe("openapi() — writer ImporterFsError", () => {
    it("resolves written:0 and a warning when the writer throws ImporterFsError", async () => {
      const fsErr = new Error("EACCES") as Error & { code: string };
      fsErr.code = "EACCES";
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([
          { endpoint: VALID_ENDPOINT, warnings: [] },
        ]),
        writer: makeFakeWriter({ written: 0, warnings: [] }, fsErr),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("does not rethrow a writer ImporterFsError — always resolves", async () => {
      const fsErr = new Error("ENOENT") as Error & { code: string };
      fsErr.code = "ENOENT";
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([FLAT_OP]),
        assembler: makeFakeAssembler([{ endpoint: VALID_ENDPOINT, warnings: [] }]),
        writer: makeFakeWriter({ written: 0, warnings: [] }, fsErr),
      });
      await expect(
        importer.openapi({ source: "/spec.json", outputDir: "/output" }),
      ).resolves.toBeDefined();
    });
  });

  describe("openapi() — empty spec (no paths)", () => {
    it("resolves written:0 with no error warnings for an empty but valid spec", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({ ok: true, spec: LOADED_SPEC_3X, warnings: [] }),
        flattener: makeFakeFlattener([]),
        assembler: makeFakeAssembler([]),
        writer: makeFakeWriter({ written: 0, warnings: [] }),
      });
      const result = await importer.openapi({
        source: "/empty.json",
        outputDir: "/output",
      });
      expect(result.written).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("openapi() — warning order is deterministic", () => {
    it("warnings are ordered: load → flatten → per-op → write", async () => {
      const importer = new OpenApiImporter({
        loader: makeFakeLoader({
          ok: true,
          spec: LOADED_SPEC_3X,
          warnings: ["load-warning"],
        }),
        flattener: makeFakeFlattener([FLAT_OP], ["flatten-warning"]),
        assembler: makeFakeAssembler([
          { endpoint: VALID_ENDPOINT, warnings: ["op-warning"] },
        ]),
        writer: makeFakeWriter({ written: 1, warnings: ["write-warning"] }),
      });
      const result = await importer.openapi({
        source: "/spec.json",
        outputDir: "/output",
      });
      const warnTexts = result.warnings;
      const loadIdx = warnTexts.findIndex((w) => w === "load-warning");
      const flatIdx = warnTexts.findIndex((w) => w === "flatten-warning");
      const opIdx = warnTexts.findIndex((w) => w === "op-warning");
      const writeIdx = warnTexts.findIndex((w) => w === "write-warning");
      expect(loadIdx).toBeLessThan(flatIdx);
      expect(flatIdx).toBeLessThan(opIdx);
      expect(opIdx).toBeLessThan(writeIdx);
    });
  });
});
