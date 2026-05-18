/**
 * Depth-guarded JSON Schema walker for the test-catalog module.
 *
 * Extracts a flat, deterministically ordered FieldDescriptor inventory
 * from a request body JSON Schema. Uses an explicit depth guard to prevent
 * native stack overflow on CI Node 22 (smaller call stack than local Node 26).
 */

import type { JsonSchema } from "../core/canonical-model.js";

import type { FieldConstraints, FieldDescriptor, SchemaInventory } from "./types.js";

/** Default max recursion depth — safe for Node 22, far above real bodies. */
export const WALKER_MAX_DEPTH = 64;

/** Options for configuring the SchemaWalker. */
export interface SchemaWalkerOptions {
  /** Override the depth guard (tests use a small value). */
  maxDepth?: number;
}

/**
 * Depth-guarded, pure, total schema walker.
 *
 * Walks a request body JSON Schema producing a flat, deterministically
 * ordered FieldDescriptor inventory. Recursion is bounded by an explicit
 * depth guard checked BEFORE descent. Exceeding the guard stops that branch,
 * records a warning, and returns the partial inventory — never throws.
 */
export class SchemaWalker {
  readonly #maxDepth: number;

  /**
   * Constructs the walker with an optional depth override.
   * @param options - Optional configuration (maxDepth override for tests).
   */
  constructor(options?: SchemaWalkerOptions) {
    this.#maxDepth = options?.maxDepth ?? WALKER_MAX_DEPTH;
  }

  /**
   * Walks a request body JSON Schema producing a flat, deterministically
   * ordered FieldDescriptor inventory. Pure and total: nested object and
   * array-item schemas are walked; ordering is stable for identical input.
   * Recursion is bounded by an EXPLICIT depth guard checked BEFORE descent.
   * Exceeding it STOPS that branch and records a warning string; it NEVER
   * throws RangeError and NEVER relies on native stack overflow.
   * @param schema - The request body_schema (may be any JSON value).
   * @returns The field inventory plus any depth-limit warnings.
   */
  walk(schema: JsonSchema): SchemaInventory {
    const fields: FieldDescriptor[] = [];
    const warnings: string[] = [];
    this.#visit(schema, "", 0, fields, warnings);
    return { fields, warnings };
  }

  #visit(
    node: unknown,
    path: string,
    depth: number,
    fields: FieldDescriptor[],
    warnings: string[],
  ): void {
    if (depth > this.#maxDepth) {
      warnings.push(
        `Schema depth exceeded ${this.#maxDepth} at '${path}'; deeper fields not enumerated`,
      );
      return;
    }
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    const nodeObj = node as Record<string, unknown>;
    const properties = nodeObj["properties"];
    if (this.#hasProperties(properties)) {
      this.#visitProperties(nodeObj, properties, path, depth, fields, warnings);
      return;
    }
    this.#visitArrayItems(nodeObj, path, depth, fields, warnings);
  }

  #hasProperties(properties: unknown): properties is Record<string, unknown> {
    return properties !== null
      && typeof properties === "object"
      && !Array.isArray(properties);
  }

  #visitProperties(
    nodeObj: Record<string, unknown>,
    propsObj: Record<string, unknown>,
    path: string,
    depth: number,
    fields: FieldDescriptor[],
    warnings: string[],
  ): void {
    const required = Array.isArray(nodeObj["required"])
      ? (nodeObj["required"] as string[])
      : [];
    for (const key of Object.keys(propsObj)) {
      const child = propsObj[key];
      const childPath = path ? `${path}.${key}` : key;
      const descriptor = this.#describeField(child, childPath, required.includes(key));
      fields.push(descriptor);
      this.#visit(child, childPath, depth + 1, fields, warnings);
    }
  }

  #describeField(child: unknown, childPath: string, isRequired: boolean): FieldDescriptor {
    let jsonType = "unknown";
    let constraints: FieldConstraints = {};
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      const childObj = child as Record<string, unknown>;
      if (typeof childObj["type"] === "string") {
        jsonType = childObj["type"];
      }
      constraints = this.#extractConstraints(childObj);
    }
    return { path: childPath, jsonType, required: isRequired, constraints };
  }

  #visitArrayItems(
    nodeObj: Record<string, unknown>,
    path: string,
    depth: number,
    fields: FieldDescriptor[],
    warnings: string[],
  ): void {
    const nodeType = nodeObj["type"];
    const items = nodeObj["items"];
    if ((nodeType === "array" || items !== undefined) && items !== undefined) {
      const itemsPath = path ? `${path}[]` : "[]";
      this.#visit(items, itemsPath, depth + 1, fields, warnings);
    }
  }

  #extractConstraints(node: Record<string, unknown>): FieldConstraints {
    const constraints: FieldConstraints = {};
    if (typeof node["minimum"] === "number") {
      constraints.minimum = node["minimum"];
    }
    if (typeof node["maximum"] === "number") {
      constraints.maximum = node["maximum"];
    }
    if (typeof node["minLength"] === "number") {
      constraints.minLength = node["minLength"];
    }
    if (typeof node["maxLength"] === "number") {
      constraints.maxLength = node["maxLength"];
    }
    if (Array.isArray(node["enum"])) {
      constraints.enum = node["enum"] as unknown[];
    }
    return constraints;
  }
}
