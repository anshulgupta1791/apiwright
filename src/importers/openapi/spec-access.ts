/**
 * SpecAccess: narrowing helper for dereferenced OpenAPI/Swagger documents.
 *
 * Every `unknown`→typed access of the dereferenced document goes through this
 * class. Consumers of the pipeline see well-typed intermediate shapes
 * (LoadedSpec, FlattenedOperation), never `unknown`/`any`. The few unavoidable
 * `unknown`-narrowing branches all have a defined false-arm (returns a
 * documented default) so they are coverage-reachable, not ignored.
 */

import type { SpecFlavor } from "./types.js";

/**
 * Type-narrowing helper for dereferenced OpenAPI 3.x and Swagger 2.0 spec
 * documents. All `unknown`-to-typed access is centralised here: single source
 * of guard logic (DRY enforced structurally). Used by loader, flattener,
 * base-url resolver, and security mapper.
 */
export class SpecAccess {
  /**
   * Returns true when `value` is a non-null, non-array plain object.
   * @param value - The value to test.
   * @returns True if `value` is a plain object.
   */
  isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * Returns `value` when it is a string, else undefined.
   * @param value - The value to test.
   * @returns The string value, or undefined.
   */
  asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  /**
   * Returns `value` when it is an array, else an empty array.
   * @param value - The value to test.
   * @returns The array value, or an empty array.
   */
  asObjectArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Returns `value` when it is a non-null, non-array plain object, else
   * an empty record.
   * @param value - The value to test.
   * @returns The record value, or an empty record.
   */
  asRecord(value: unknown): Record<string, unknown> {
    if (this.isObject(value)) return value;
    return {};
  }

  /**
   * Returns the `paths` object from a spec document.
   * Returns an empty record when absent or not an object.
   * @param doc - The dereferenced spec document.
   * @returns The paths object.
   */
  getPaths(doc: Record<string, unknown>): Record<string, unknown> {
    return this.asRecord(doc["paths"]);
  }

  /**
   * Returns the `servers` array from an OpenAPI 3.x document.
   * Returns an empty array when absent or not an array.
   * @param doc - The dereferenced spec document.
   * @returns The servers array.
   */
  getServers(doc: Record<string, unknown>): unknown[] {
    return this.asObjectArray(doc["servers"]);
  }

  /**
   * Returns `components.schemas` from an OpenAPI 3.x document.
   * Returns an empty record when absent or not an object.
   * @param doc - The dereferenced spec document.
   * @returns The schemas record.
   */
  getComponentsSchemas(doc: Record<string, unknown>): Record<string, unknown> {
    const components = this.asRecord(doc["components"]);
    return this.asRecord(components["schemas"]);
  }

  /**
   * Returns `definitions` from a Swagger 2.0 document.
   * Returns an empty record when absent or not an object.
   * @param doc - The dereferenced spec document.
   * @returns The definitions record.
   */
  getDefinitions(doc: Record<string, unknown>): Record<string, unknown> {
    return this.asRecord(doc["definitions"]);
  }

  /**
   * Returns `components.securitySchemes` from an OpenAPI 3.x document.
   * Returns an empty record when absent or not an object.
   * @param doc - The dereferenced spec document.
   * @returns The security schemes record.
   */
  getSecuritySchemes(doc: Record<string, unknown>): Record<string, unknown> {
    const components = this.asRecord(doc["components"]);
    return this.asRecord(components["securitySchemes"]);
  }

  /**
   * Returns `securityDefinitions` from a Swagger 2.0 document.
   * Returns an empty record when absent or not an object.
   * @param doc - The dereferenced spec document.
   * @returns The security definitions record.
   */
  getSecurityDefinitions(doc: Record<string, unknown>): Record<string, unknown> {
    return this.asRecord(doc["securityDefinitions"]);
  }

  /**
   * Detects the spec flavor from a dereferenced document.
   * Returns "openapi-3" for OpenAPI 3.x, "swagger-2" for Swagger 2.0,
   * or undefined when neither field is recognized.
   * @param doc - The dereferenced spec document.
   * @returns The detected flavor, or undefined.
   */
  detectFlavor(doc: Record<string, unknown>): SpecFlavor | undefined {
    const openapi = doc["openapi"];
    if (typeof openapi === "string" && /^3\./.test(openapi)) {
      return "openapi-3";
    }
    const swagger = doc["swagger"];
    if (typeof swagger === "string" && /^2\./.test(swagger)) {
      return "swagger-2";
    }
    return undefined;
  }
}
