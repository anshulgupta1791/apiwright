/**
 * JSON-Schema → Markdown table renderer.
 *
 * Converts a `CanonicalRequest.body_schema` / `CanonicalResponse.schema`
 * object (already deref'd by the importers) into a readable Markdown
 * table with four columns: `Field`, `Type`, `Required`, `Constraints`.
 *
 * Determinism: keys are emitted in `Object.keys` order which JavaScript
 * preserves as insertion order for string keys (ES2015+). The canonical
 * model's importers emit keys deterministically (Postman + OpenAPI
 * importers both use a fixed `CANONICAL_KEY_ORDER`), so the same input
 * spec always yields the same table.
 *
 * Bounded depth: nested object schemas are rendered with dot-notation
 * field paths up to {@link MAX_SCHEMA_DEPTH}. Beyond that, the field
 * row shows `…` to avoid runaway output for adversarial schemas.
 */

import type { JsonSchema } from "../core/canonical-model.js";

/** Maximum recursion depth when flattening nested object schemas. */
export const MAX_SCHEMA_DEPTH = 8;

/** Placeholder used when no schema is supplied. */
const EMPTY_PLACEHOLDER = "_(no schema declared)_";

/** Row of the rendered table. */
interface Row {
  readonly field: string;
  readonly type: string;
  readonly required: boolean;
  readonly constraints: string;
}

/**
 * Renders a JSON Schema object as a four-column Markdown table.
 * @param schema - The JSON Schema (already deref'd of any `$ref`s).
 * @returns A Markdown table string, or a placeholder when schema is empty.
 */
export function renderSchemaTable(schema: JsonSchema | undefined): string {
  if (!schema || Object.keys(schema).length === 0) return EMPTY_PLACEHOLDER;
  const rows = flatten(schema, "", true, 0);
  if (rows.length === 0) return EMPTY_PLACEHOLDER;
  const lines = [
    "| Field | Type | Required | Constraints |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(`| \`${r.field}\` | ${r.type} | ${r.required ? "yes" : "no"} | ${r.constraints} |`);
  }
  return lines.join("\n");
}

/**
 * Recursively flattens an object schema into rows. Non-object schemas
 * (string/number/etc. at root) emit a single self-row with field "_root_".
 * @param schema - The current schema node.
 * @param path - Dot-notation path of the current node (empty at root).
 * @param parentRequired - True iff the parent declared this node required.
 * @param depth - Current recursion depth.
 * @returns Ordered rows for the table.
 */
function flatten(
  schema: JsonSchema,
  path: string,
  parentRequired: boolean,
  depth: number,
): readonly Row[] {
  if (depth > MAX_SCHEMA_DEPTH) {
    const fieldName = path === "" ? "…" : path;
    return [{ field: fieldName, type: "…", required: false, constraints: "(depth cap)" }];
  }
  const type = readString(schema, "type");
  if (type === "object") return flattenObject(schema, path, depth);
  if (path === "") {
    return [{
      field: "_root_",
      type: typeWithItems(schema),
      required: parentRequired,
      constraints: constraints(schema),
    }];
  }
  return [{
    field: path,
    type: typeWithItems(schema),
    required: parentRequired,
    constraints: constraints(schema),
  }];
}

/**
 * Flattens an `object` schema. Each property gets a row; nested objects
 * recurse with `parent.child` path; the `required: [...]` declaration is
 * consulted to mark the per-row `required` boolean.
 * @param schema - The object schema.
 * @param path - Path prefix (empty at root).
 * @param depth - Current recursion depth.
 * @returns Ordered rows for every property (recursively).
 */
function flattenObject(schema: JsonSchema, path: string, depth: number): readonly Row[] {
  const properties = readObject(schema, "properties") ?? {};
  const required = new Set(readStringArray(schema, "required"));
  const rows: Row[] = [];
  for (const key of Object.keys(properties)) {
    const child = properties[key];
    if (!isObject(child)) continue;
    const childPath = path === "" ? key : `${path}.${key}`;
    const isReq = required.has(key);
    if (readString(child, "type") === "object") {
      // Emit a header row for the object itself, then recurse into properties.
      rows.push({
        field: childPath,
        type: "object",
        required: isReq,
        constraints: constraints(child),
      });
      const nested = flattenObject(child, childPath, depth + 1);
      for (const n of nested) rows.push(n);
    } else {
      const inner = flatten(child, childPath, isReq, depth + 1);
      for (const r of inner) rows.push(r);
    }
  }
  return rows;
}

/**
 * Renders the type label, expanding `array` to `array<itemType>` when
 * the `items` schema is present and has a type.
 * @param schema - The schema node.
 * @returns A human-readable type label.
 */
function typeWithItems(schema: JsonSchema): string {
  const type = readString(schema, "type") ?? "any";
  if (type !== "array") return type;
  const items = readObject(schema, "items");
  const itemType = items ? readString(items, "type") : undefined;
  return itemType ? `array<${itemType}>` : "array";
}

/**
 * Renders a compact constraint string from common JSON Schema keywords:
 * `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`,
 * `format`. Empty when none apply.
 * @param schema - The schema node.
 * @returns Pipe-separated constraint list, or empty string.
 */
function constraints(schema: JsonSchema): string {
  const parts: string[] = [];
  const enumVals = (schema as Record<string, unknown>)["enum"];
  if (Array.isArray(enumVals)) {
    parts.push(`enum: ${enumVals.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  const min = (schema as Record<string, unknown>)["minimum"];
  if (typeof min === "number") parts.push(`min: ${min}`);
  const max = (schema as Record<string, unknown>)["maximum"];
  if (typeof max === "number") parts.push(`max: ${max}`);
  const minLen = (schema as Record<string, unknown>)["minLength"];
  if (typeof minLen === "number") parts.push(`minLen: ${minLen}`);
  const maxLen = (schema as Record<string, unknown>)["maxLength"];
  if (typeof maxLen === "number") parts.push(`maxLen: ${maxLen}`);
  const pattern = readString(schema, "pattern");
  if (pattern !== undefined) parts.push(`pattern: \`${pattern}\``);
  const format = readString(schema, "format");
  if (format !== undefined) parts.push(`format: ${format}`);
  return parts.length === 0 ? "" : parts.join(" · ");
}

/**
 * Type-safe read of a string-valued field.
 * @param o - Source object.
 * @param key - Field name.
 * @returns The string value, or undefined if absent / wrong type.
 */
function readString(o: JsonSchema, key: string): string | undefined {
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Type-safe read of an object-valued field.
 * @param o - Source object.
 * @param key - Field name.
 * @returns The object value, or undefined.
 */
function readObject(o: JsonSchema, key: string): Record<string, unknown> | undefined {
  const v = (o as Record<string, unknown>)[key];
  return isObject(v) ? (v) : undefined;
}

/**
 * Type-safe read of a string-array field (defaults to empty).
 * @param o - Source object.
 * @param key - Field name.
 * @returns The string-array value, or empty.
 */
function readStringArray(o: JsonSchema, key: string): readonly string[] {
  const v = (o as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Narrows `unknown` to a plain object (not array, not null).
 * @param v - Value to test.
 * @returns True iff `v` is a non-null, non-array object.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
