import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PostmanCollectionLoader } from "../../../../src/importers/postman/collection-loader.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { ImporterFsError } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanCollectionLoader.
 *
 * All filesystem access is handled through an in-memory fake implementing
 * ImporterFileSystem — no real disk. Covers: success path, ENOENT, malformed
 * JSON, valid-JSON-but-not-v2.1, SDK hydration failure, empty collection,
 * default-seam constructor wiring.
 */

/** In-memory fake implementing ImporterFileSystem. */
function makeFakeFs(
  files: Record<string, string>,
  missingCode?: ImporterFsError["code"],
): ImporterFileSystem {
  return {
    readFile(path: string): string {
      if (path in files) {
        return files[path];
      }
      const code = missingCode ?? "ENOENT";
      const err = new Error(`readFile failed: ${path}`) as ImporterFsError;
      (err as unknown as Record<string, unknown>)["code"] = code;
      throw err;
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

const VALID_V21_JSON = JSON.stringify({
  info: {
    _postman_id: "abc123",
    name: "Test Collection",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [],
  variable: [],
});

const VALID_V21_WITH_ITEMS = JSON.stringify({
  info: {
    _postman_id: "abc123",
    name: "Test Collection",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    {
      id: "item-1",
      name: "Get Users",
      request: {
        method: "GET",
        url: "https://example.com/users",
        header: [],
      },
      response: [],
    },
  ],
  variable: [{ key: "baseUrl", value: "https://example.com" }],
});

describe("PostmanCollectionLoader", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a load method", () => {
      const loader = new PostmanCollectionLoader();
      expect(typeof loader.load).toBe("function");
    });
  });

  describe("load() — success", () => {
    it("returns ok:true for a valid Postman v2.1 collection", () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/col.json");
      expect(result.ok).toBe(true);
    });

    it("returns a LoadedCollection with a sdk property", () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/col.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.collection.sdk).toBeDefined();
    });

    it("returns fileBasename as the basename of the input path", () => {
      const fakeFs = makeFakeFs({
        "/path/to/my-collection.json": VALID_V21_JSON,
      });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/path/to/my-collection.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.collection.fileBasename).toBe("my-collection.json");
    });

    it("accepts a collection with items and returns ok:true", () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_WITH_ITEMS });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/col.json");
      expect(result.ok).toBe(true);
    });

    it("hydrates the SDK collection so sdk.name returns the collection name", () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_WITH_ITEMS });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/col.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.collection.sdk.name).toBeDefined();
    });
  });

  describe("load() — file not found", () => {
    it("returns ok:false when the file does not exist (ENOENT)", () => {
      const fakeFs = makeFakeFs({}, "ENOENT");
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/missing.json");
      expect(result.ok).toBe(false);
    });

    it("error message mentions the file path when file not found", () => {
      const fakeFs = makeFakeFs({}, "ENOENT");
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/missing.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("/missing.json");
    });

    it("error message mentions ENOENT code when file not found", () => {
      const fakeFs = makeFakeFs({}, "ENOENT");
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/missing.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("ENOENT");
    });

    it("returns ok:false with EACCES code in error message for access-denied", () => {
      const fakeFs = makeFakeFs({}, "EACCES");
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/protected.json");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("EACCES");
    });

    it("never throws — returns discriminated result for missing file", () => {
      const fakeFs = makeFakeFs({}, "ENOENT");
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      expect(() => loader.load("/missing.json")).not.toThrow();
    });
  });

  describe("load() — malformed JSON", () => {
    it("returns ok:false for malformed JSON input", () => {
      const fakeFs = makeFakeFs({ "/bad.json": "not valid json {{{{" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/bad.json");
      expect(result.ok).toBe(false);
    });

    it("error message mentions the file path for malformed JSON", () => {
      const fakeFs = makeFakeFs({ "/bad.json": "not valid json" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/bad.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("/bad.json");
    });

    it("error message indicates invalid JSON", () => {
      const fakeFs = makeFakeFs({ "/bad.json": "{broken" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/bad.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error.toLowerCase()).toContain("invalid json");
    });

    it("never throws for malformed JSON", () => {
      const fakeFs = makeFakeFs({ "/bad.json": "!!notjson!!" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      expect(() => loader.load("/bad.json")).not.toThrow();
    });
  });

  describe("load() — valid JSON but not a Postman v2.1 collection", () => {
    it("returns ok:false for a plain object JSON", () => {
      const fakeFs = makeFakeFs({ "/plain.json": '{"foo":"bar"}' });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/plain.json");
      expect(result.ok).toBe(false);
    });

    it("returns ok:false for a collection with wrong schema version (v2.0)", () => {
      const v20 = JSON.stringify({
        info: {
          schema:
            "https://schema.getpostman.com/json/collection/v2.0.0/collection.json",
        },
        item: [],
      });
      const fakeFs = makeFakeFs({ "/v20.json": v20 });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/v20.json");
      expect(result.ok).toBe(false);
    });

    it("error message mentions the file and 'not a recognizable Postman v2.1 collection'", () => {
      const fakeFs = makeFakeFs({ "/not-col.json": '{"x":1}' });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/not-col.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error.toLowerCase()).toContain("postman v2.1");
    });

    it("returns ok:false for JSON array input", () => {
      const fakeFs = makeFakeFs({ "/arr.json": "[1,2,3]" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/arr.json");
      expect(result.ok).toBe(false);
    });

    it("returns ok:false for null JSON value", () => {
      const fakeFs = makeFakeFs({ "/null.json": "null" });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/null.json");
      expect(result.ok).toBe(false);
    });

    it("returns ok:false when info.schema is missing", () => {
      const noSchema = JSON.stringify({
        info: { name: "No Schema" },
        item: [],
      });
      const fakeFs = makeFakeFs({ "/no-schema.json": noSchema });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/no-schema.json");
      expect(result.ok).toBe(false);
    });

    it("never throws for non-Postman JSON", () => {
      const fakeFs = makeFakeFs({ "/other.json": '{"not":"postman"}' });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      expect(() => loader.load("/other.json")).not.toThrow();
    });
  });

  describe("load() — empty collection", () => {
    it("returns ok:true for a valid collection with no items", () => {
      const fakeFs = makeFakeFs({ "/empty.json": VALID_V21_JSON });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("/empty.json");
      expect(result.ok).toBe(true);
    });
  });

  describe("load() — basename extraction", () => {
    it("extracts a simple filename as basename", () => {
      const fakeFs = makeFakeFs({ "simple.json": VALID_V21_JSON });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load("simple.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.collection.fileBasename).toBe("simple.json");
    });

    it("extracts basename from a deep path", () => {
      const path = join("/a", "b", "c", "collection.postman_collection.json");
      const fakeFs = makeFakeFs({ [path]: VALID_V21_JSON });
      const loader = new PostmanCollectionLoader({ fs: fakeFs });
      const result = loader.load(path);
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.collection.fileBasename).toBe(
        "collection.postman_collection.json",
      );
    });
  });
});
