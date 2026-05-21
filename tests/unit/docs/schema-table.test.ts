import { describe, it, expect } from "vitest";

import { MAX_SCHEMA_DEPTH, renderSchemaTable } from "../../../src/docs/schema-table.js";

describe("renderSchemaTable", () => {
  it("returns placeholder for undefined/empty schema", () => {
    expect(renderSchemaTable(undefined)).toBe("_(no schema declared)_");
    expect(renderSchemaTable({})).toBe("_(no schema declared)_");
  });

  it("renders a simple object with required + optional fields", () => {
    const out = renderSchemaTable({
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        age: { type: "integer", minimum: 0, maximum: 120 },
      },
    });
    expect(out).toContain("| `id` | string | yes |  |");
    expect(out).toContain("`age`");
    expect(out).toContain("integer");
    expect(out).toContain("min: 0");
    expect(out).toContain("max: 120");
  });

  it("renders root-level non-object schema as _root_", () => {
    const out = renderSchemaTable({ type: "string" });
    expect(out).toContain("`_root_`");
    expect(out).toContain("string");
  });

  it("renders array type with item type when present", () => {
    const out = renderSchemaTable({
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
    });
    expect(out).toContain("array<string>");
  });

  it("renders array type without item type as bare 'array'", () => {
    const out = renderSchemaTable({
      type: "object",
      properties: { tags: { type: "array" } },
    });
    expect(out).toContain("| `tags` | array | no |");
  });

  it("flattens nested objects with dot-notation", () => {
    const out = renderSchemaTable({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      },
    });
    expect(out).toContain("`user`");
    expect(out).toContain("`user.name`");
  });

  it("renders enum constraints", () => {
    const out = renderSchemaTable({
      type: "object",
      properties: { color: { type: "string", enum: ["red", "blue"] } },
    });
    expect(out).toContain('enum: "red", "blue"');
  });

  it("renders minLength/maxLength/pattern/format constraints", () => {
    const out = renderSchemaTable({
      type: "object",
      properties: {
        s: { type: "string", minLength: 1, maxLength: 99, pattern: "^x", format: "email" },
      },
    });
    expect(out).toContain("minLen: 1");
    expect(out).toContain("maxLen: 99");
    expect(out).toContain("pattern: `^x`");
    expect(out).toContain("format: email");
  });

  it("renders empty when object has no properties", () => {
    expect(renderSchemaTable({ type: "object" })).toBe("_(no schema declared)_");
  });

  it("caps recursion at MAX_SCHEMA_DEPTH", () => {
    // Build a chain deeper than the cap.
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 5; i++) {
      schema = { type: "object", properties: { nested: schema } };
    }
    const out = renderSchemaTable(schema);
    expect(out).toContain("(depth cap)");
  });

  it("MAX_SCHEMA_DEPTH is exported as a positive number", () => {
    expect(typeof MAX_SCHEMA_DEPTH).toBe("number");
    expect(MAX_SCHEMA_DEPTH).toBeGreaterThan(0);
  });

  it("produces deterministic byte-identical output across two runs", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: {
        a: { type: "string" },
        b: { type: "integer" },
        c: { type: "boolean" },
      },
    };
    expect(renderSchemaTable(schema)).toBe(renderSchemaTable(schema));
  });
});
