/**
 * Unit tests for the in-house Postman v2.1 schema helpers (B13).
 *
 * Covers every branch of `urlToString` (the SDK `.url.toString()`
 * replacement), the supporting `joinHost` / `joinPath` / `joinQuery`
 * helpers exercised through it, and `isFolder`. Each test pins a specific
 * URL shape the importer must handle correctly. Together with the
 * integration test in `tests/integration/importers/`, these guard the
 * contract that closed B13.
 */

import { describe, it, expect } from "vitest";

import {
  isFolder,
  urlToString,
} from "../../../../src/importers/postman/v2-schema.js";
import type { PostmanV21Item } from "../../../../src/importers/postman/v2-schema.js";

describe("urlToString — bare-string variant", () => {
  it("returns the string unchanged", () => {
    expect(urlToString("https://api.example.com/path")).toBe(
      "https://api.example.com/path",
    );
  });

  it("preserves Postman {{var}} tokens", () => {
    expect(urlToString("{{base_url}}/users/{{id}}")).toBe(
      "{{base_url}}/users/{{id}}",
    );
  });

  it("returns empty string for an empty string", () => {
    expect(urlToString("")).toBe("");
  });
});

describe("urlToString — undefined", () => {
  it("returns empty string", () => {
    expect(urlToString(undefined)).toBe("");
  });
});

describe("urlToString — structured object with `raw`", () => {
  it("returns raw verbatim when present", () => {
    expect(
      urlToString({
        raw: "https://api.example.com/v1/items?limit=10",
        host: ["api", "example", "com"],
        path: ["v1", "items"],
        query: [{ key: "limit", value: "10" }],
      }),
    ).toBe("https://api.example.com/v1/items?limit=10");
  });

  it("returns raw even when it's just a path", () => {
    expect(urlToString({ raw: "/users/1" })).toBe("/users/1");
  });
});

describe("urlToString — structured object without `raw` (reassembly path)", () => {
  it("reassembles protocol + host (array) + path (array)", () => {
    expect(
      urlToString({
        protocol: "https",
        host: ["api", "example", "com"],
        path: ["v1", "users"],
      }),
    ).toBe("https://api.example.com/v1/users");
  });

  it("reassembles with host as a single string", () => {
    expect(
      urlToString({
        protocol: "http",
        host: "localhost:8080",
        path: ["api"],
      }),
    ).toBe("http://localhost:8080/api");
  });

  it("reassembles with path as a single string (leading slash respected)", () => {
    expect(
      urlToString({
        protocol: "https",
        host: ["x", "y"],
        path: "/items/all",
      }),
    ).toBe("https://x.y/items/all");
  });

  it("adds leading slash when path string lacks it", () => {
    expect(
      urlToString({
        protocol: "https",
        host: ["x", "y"],
        path: "items",
      }),
    ).toBe("https://x.y/items");
  });

  it("reassembles path with object segments via `value`", () => {
    expect(
      urlToString({
        protocol: "https",
        host: ["api", "x"],
        path: [{ value: "users" }, { value: "{{id}}" }],
      }),
    ).toBe("https://api.x/users/{{id}}");
  });

  it("treats path-object segment missing `value` as empty", () => {
    expect(
      urlToString({
        host: ["x"],
        // Mixed: a string + an object missing `value` + another string.
        path: ["a", {}, "b"],
      }),
    ).toBe("x/a//b");
  });

  it("appends `?key=value&key=value` from structured query", () => {
    expect(
      urlToString({
        host: ["x"],
        path: ["a"],
        query: [
          { key: "limit", value: "10" },
          { key: "offset", value: "5" },
        ],
      }),
    ).toBe("x/a?limit=10&offset=5");
  });

  it("filters out disabled query params", () => {
    expect(
      urlToString({
        host: ["x"],
        path: ["a"],
        query: [
          { key: "kept", value: "1" },
          { key: "dropped", value: "2", disabled: true },
        ],
      }),
    ).toBe("x/a?kept=1");
  });

  it("query missing key/value defaults each to empty string", () => {
    expect(
      urlToString({
        host: ["x"],
        path: ["a"],
        query: [{}],
      }),
    ).toBe("x/a?=");
  });

  it("returns empty string when no fields are present", () => {
    expect(urlToString({})).toBe("");
  });

  it("ignores non-string protocol gracefully", () => {
    expect(
      urlToString({
        protocol: 42 as unknown as string,
        host: ["x"],
        path: ["a"],
      }),
    ).toBe("x/a");
  });

  it("ignores non-array, non-string host gracefully", () => {
    expect(
      urlToString({
        protocol: "https",
        host: { weird: true } as unknown as string,
        path: ["a"],
      }),
    ).toBe("https:///a");
  });

  it("ignores non-array, non-string path gracefully", () => {
    expect(
      urlToString({
        protocol: "https",
        host: ["x"],
        path: { weird: true } as unknown as string,
      }),
    ).toBe("https://x");
  });

  it("ignores non-array query gracefully", () => {
    expect(
      urlToString({
        host: ["x"],
        path: ["a"],
        query: "notanarray" as unknown as never,
      }),
    ).toBe("x/a");
  });

  it("ignores empty host + empty path → no leading slash artifacts", () => {
    expect(urlToString({ protocol: "https" })).toBe("https://");
  });
});

describe("isFolder", () => {
  it("returns true for an item with an `item` array (folder)", () => {
    const folder: PostmanV21Item = {
      name: "Auth",
      item: [{ name: "Login", request: { method: "POST", url: "/login" } }],
    };
    expect(isFolder(folder)).toBe(true);
  });

  it("returns true for an empty folder (item: [])", () => {
    expect(isFolder({ name: "Empty", item: [] })).toBe(true);
  });

  it("returns false for an item without an `item` array (request)", () => {
    const request: PostmanV21Item = {
      name: "Login",
      request: { method: "POST", url: "/login" },
    };
    expect(isFolder(request)).toBe(false);
  });

  it("returns false for an item with both `item` (non-array, malformed) and `request`", () => {
    // Defensive: malformed JSON where `item` is not an array shouldn't
    // crash the type guard.
    const malformed = {
      name: "Mixed",
      item: "not-an-array" as unknown as PostmanV21Item[],
      request: { method: "GET", url: "/" },
    };
    expect(isFolder(malformed as PostmanV21Item)).toBe(false);
  });
});
