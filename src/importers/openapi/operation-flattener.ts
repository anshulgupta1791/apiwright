/**
 * OperationFlattener: walks a dereferenced LoadedSpec into a flat, ordered
 * list of FlattenedOperation objects.
 *
 * Pure: does not mutate the LoadedSpec. Never throws on a malformed path item.
 * Normalizes both OpenAPI 3.x and Swagger 2.0 into the same FlattenedOperation
 * shape so all downstream stages are flavor-agnostic.
 *
 * Collaborators (extracted for 300-line discipline):
 *   - OperationBodyNormalizer    — request body / formData normalization
 *   - OperationParamNormalizer   — parameter array normalization and merging
 *   - OperationResponseExtractor — response map normalization
 */

import { OperationBodyNormalizer } from "./operation-body-normalizer.js";
import type { InternalParam } from "./operation-body-normalizer.js";
import { OperationParamNormalizer } from "./operation-param-normalizer.js";
import { OperationResponseExtractor } from "./operation-response-extractor.js";
import { SpecAccess } from "./spec-access.js";
import type {
  FlattenedOperation,
  FlattenedParameter,
  FlattenedSecurityRequirement,
  FlattenResult,
  LoadedSpec,
} from "./types.js";

/** The seven canonical HTTP methods supported by the canonical model. */
const SUPPORTED_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options",
]);

/** Path-item non-operation keys that must NOT be emitted as operations. */
const NON_OPERATION_KEYS = new Set([
  "parameters", "$ref", "summary", "description",
]);

/** Fallback default tag bucket when path has no usable segment. */
const DEFAULT_TAG = "default";

/** Minimum length of an HTTP-method-like keyword. */
const METHOD_MIN_LEN = 3;

/** Maximum length of an HTTP-method-like keyword. */
const METHOD_MAX_LEN = 10;

/**
 * Walks a dereferenced LoadedSpec into a flat, ordered list of
 * FlattenedOperation objects. Pure; does not mutate the LoadedSpec.
 * Never throws on a malformed path item.
 */
export class OperationFlattener {
  readonly #access: SpecAccess;
  readonly #bodyNormalizer: OperationBodyNormalizer;
  readonly #paramNormalizer: OperationParamNormalizer;
  readonly #responseExtractor: OperationResponseExtractor;

  /**
   * Constructs the flattener.
   */
  constructor() {
    this.#access = new SpecAccess();
    this.#bodyNormalizer = new OperationBodyNormalizer();
    this.#paramNormalizer = new OperationParamNormalizer();
    this.#responseExtractor = new OperationResponseExtractor();
  }

  /**
   * Walks a dereferenced LoadedSpec into a flat, ordered operation list.
   * Pure: does not mutate the LoadedSpec. Never throws on a malformed path item.
   * @param spec - The fully loaded and dereferenced spec.
   * @returns A FlattenResult with operations in document order and warnings.
   */
  flatten(spec: LoadedSpec): FlattenResult {
    const warnings: string[] = [];
    const operations: FlattenedOperation[] = [];
    const paths = this.#access.getPaths(spec.document);
    const rootSecurity = spec.document["security"];

    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
      if (!this.#access.isObject(pathItem)) continue;

      const pathParams = this.#paramNormalizer.normalizeParameters(
        this.#access.asObjectArray(pathItem["parameters"]),
        spec.flavor,
      );

      this.#flattenPathItem(
        pathTemplate, pathItem, pathParams, spec, rootSecurity, operations, warnings,
      );
    }

    return { operations, warnings };
  }

  /**
   * Flattens all operations within a single path item.
   * @param pathTemplate - The path template string (e.g. "/users/{id}").
   * @param pathItem - The path item object from the spec.
   * @param pathParams - Normalized path-level parameters.
   * @param spec - The loaded spec.
   * @param rootSecurity - The root-level security declaration, if any.
   * @param operations - Accumulator for produced FlattenedOperation objects.
   * @param warnings - Accumulator for produced warning strings.
   */
  #flattenPathItem(
    pathTemplate: string,
    pathItem: Record<string, unknown>,
    pathParams: InternalParam[],
    spec: LoadedSpec,
    rootSecurity: unknown,
    operations: FlattenedOperation[],
    warnings: string[],
  ): void {
    for (const [key, operationVal] of Object.entries(pathItem)) {
      const lowerKey = key.toLowerCase();

      if (NON_OPERATION_KEYS.has(lowerKey) || key.startsWith("x-")) continue;

      if (!SUPPORTED_METHODS.has(lowerKey)) {
        if (this.#isMethodLike(lowerKey)) {
          warnings.push(
            `Skipped operation ${key.toUpperCase()} ${pathTemplate}: ` +
              `HTTP method not supported by the canonical model`,
          );
        }
        continue;
      }

      if (!this.#access.isObject(operationVal)) continue;
      const operation = operationVal;

      const op = this.#buildOperation(
        pathTemplate, lowerKey, operation, pathParams, spec, rootSecurity, warnings,
      );
      operations.push(op);
    }
  }

  /**
   * Builds a single FlattenedOperation from a path template, method, and operation object.
   * @param pathTemplate - The path template string.
   * @param lowerKey - The lowercased HTTP method.
   * @param operation - The operation object from the spec.
   * @param pathParams - Normalized path-level parameters.
   * @param spec - The loaded spec.
   * @param rootSecurity - The root-level security declaration, if any.
   * @param warnings - Accumulator for produced warning strings.
   * @returns The fully constructed FlattenedOperation.
   */
  #buildOperation(
    pathTemplate: string,
    lowerKey: string,
    operation: Record<string, unknown>,
    pathParams: InternalParam[],
    spec: LoadedSpec,
    rootSecurity: unknown,
    warnings: string[],
  ): FlattenedOperation {
    const opParams = this.#paramNormalizer.normalizeParameters(
      this.#access.asObjectArray(operation["parameters"]),
      spec.flavor,
    );
    const mergedParams = this.#paramNormalizer.mergeParameters(pathParams, opParams);

    const bodyParams = mergedParams.filter((p) => p._raw2xIn === "body");
    const formDataParams = mergedParams.filter((p) => p._raw2xIn === "formData");
    const normalParams = mergedParams.filter(
      (p) => p._raw2xIn !== "body" && p._raw2xIn !== "formData",
    );

    const tags = this.#resolveTags(pathTemplate, lowerKey, operation, warnings);
    const requestBody = this.#bodyNormalizer.normalizeRequestBody(
      operation, bodyParams, formDataParams, spec.flavor,
    );
    const security = this.#normalizeSecurity(operation, spec.document, rootSecurity);
    const responses = this.#responseExtractor.normalizeResponses(operation, spec.flavor);

    const cleanParams: FlattenedParameter[] = normalParams.map((p) => {
      const clean: FlattenedParameter = {
        name: p.name, location: p.location, required: p.required,
      };
      if (p.schema !== undefined) clean.schema = p.schema;
      if (p.example !== undefined) clean.example = p.example;
      return clean;
    });

    const op: FlattenedOperation = {
      path: pathTemplate,
      method: lowerKey,
      summary: typeof operation["summary"] === "string" ? operation["summary"] : "",
      description: typeof operation["description"] === "string" ? operation["description"] : "",
      tags,
      parameters: cleanParams,
      responses,
    };

    const operationId = operation["operationId"];
    if (typeof operationId === "string") op.operationId = operationId;
    if (requestBody !== undefined) op.requestBody = requestBody;
    if (security !== undefined) op.security = security;

    return op;
  }

  /**
   * Resolves the tags for an operation, defaulting and warning as needed.
   * @param pathTemplate - The path template string.
   * @param lowerKey - The lowercased HTTP method.
   * @param operation - The operation object from the spec.
   * @param warnings - Accumulator for produced warning strings.
   * @returns The resolved tag array (never empty).
   */
  #resolveTags(
    pathTemplate: string,
    lowerKey: string,
    operation: Record<string, unknown>,
    warnings: string[],
  ): string[] {
    const rawTags = this.#access.asObjectArray(operation["tags"])
      .filter((t): t is string => typeof t === "string");

    if (!("tags" in operation) || rawTags.length === 0) {
      return [this.#defaultTag(pathTemplate)];
    }

    if (rawTags.length > 1) {
      warnings.push(
        `Operation ${lowerKey.toUpperCase()} ${pathTemplate} has multiple tags; ` +
          `placed under first tag '${rawTags[0]}'`,
      );
    }
    return rawTags;
  }

  /**
   * Determines if a key looks like an HTTP method name (single word, no separators).
   * @param key - The lowercased key to check.
   * @returns True when the key looks like an HTTP method name.
   */
  #isMethodLike(key: string): boolean {
    return /^[a-z]+$/.test(key) && key.length >= METHOD_MIN_LEN && key.length <= METHOD_MAX_LEN;
  }

  /**
   * Derives the default tag from the first non-empty path segment.
   * @param pathTemplate - The path template string.
   * @returns The default tag string.
   */
  #defaultTag(pathTemplate: string): string {
    const segments = pathTemplate.split("/").filter((s) => s !== "" && !s.startsWith("{"));
    return segments.length > 0 ? (segments[0] ?? DEFAULT_TAG) : DEFAULT_TAG;
  }

  /**
   * Normalizes the effective security for an operation.
   * @param operation - The operation object.
   * @param doc - The spec root document.
   * @param rootSecurity - The root-level security declaration.
   * @returns The normalized security requirements, or undefined.
   */
  #normalizeSecurity(
    operation: Record<string, unknown>,
    doc: Record<string, unknown>,
    rootSecurity: unknown,
  ): FlattenedSecurityRequirement[] | undefined {
    if ("security" in operation) {
      const opSecurity = this.#access.asObjectArray(operation["security"]);
      return this.#securityRequirements(opSecurity);
    }
    if (rootSecurity !== undefined) {
      const rootSecArr = this.#access.asObjectArray(
        Array.isArray(doc["security"]) ? doc["security"] : rootSecurity,
      );
      return this.#securityRequirements(rootSecArr);
    }
    return undefined;
  }

  /**
   * Converts a raw security array to FlattenedSecurityRequirement[].
   * @param rawArr - The raw security array from the spec.
   * @returns The normalized security requirements array.
   */
  #securityRequirements(rawArr: unknown[]): FlattenedSecurityRequirement[] {
    return rawArr
      .filter((req): req is Record<string, unknown> => this.#access.isObject(req))
      .map((req) => ({
        schemeNames: Object.keys(req),
      }));
  }
}
