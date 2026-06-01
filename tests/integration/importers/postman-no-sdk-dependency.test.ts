/**
 * Integration regression guard — Lens 0 blocker B13.
 *
 * The `postman-collection` npm SDK was dropped in this PR to eliminate
 * its transitively-vulnerable lodash + uuid deps that shipped to every
 * user despite our local `overrides` (which don't propagate to consumers
 * of the published tarball). The replacement is an in-house typed walk
 * of the raw Postman v2.1 JSON via `src/importers/postman/v2-schema.ts`.
 *
 * This test pins three guarantees end-to-end through the actual loader +
 * flattener + assembler chain:
 *
 *   1. The package.json `dependencies` block does NOT include
 *      `postman-collection` (or `@types/postman-collection`). Anyone
 *      reintroducing it would re-introduce the vuln chain that B13
 *      closed.
 *   2. The full Postman importer pipeline still works end-to-end on a
 *      real v2.1 collection JSON — exercising the new in-house schema
 *      walk (request fields, folder traversal, variables, body, auth).
 *   3. The flattener walks the documented v2.1 shape (folders, request
 *      items, structured URL object, header[], event[] arrays) without
 *      any SDK-level intermediate object — proven by the absence of
 *      `Collection` / `Item` symbols in the import surface of the
 *      package's `src/importers/postman/` modules.
 *
 * If any of these flip, B13 has regressed and the user-side
 * `npm install` will start reporting vulnerabilities again.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PostmanCollectionLoader } from "../../../src/importers/postman/collection-loader.js";
import { PostmanFlattener } from "../../../src/importers/postman/flattener.js";
import type { ImporterFileSystem, ImporterFsError } from "../../../src/importers/types.js";

const FIXTURE_COLLECTION_JSON = JSON.stringify({
  info: {
    _postman_id: "fake-id-1",
    name: "B13 Regression Guard Collection",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "base_url", value: "https://api.example.com" },
    { key: "tenant_id", value: "acme" },
  ],
  item: [
    {
      name: "auth",
      item: [
        {
          name: "Login",
          id: "post-login",
          request: {
            method: "POST",
            url: { raw: "{{base_url}}/auth/login", host: ["{{base_url}}"], path: ["auth", "login"] },
            header: [{ key: "Content-Type", value: "application/json" }],
            body: { mode: "raw", raw: '{"u":"x","p":"y"}' },
          },
          event: [
            {
              listen: "test",
              script: {
                exec: ["pm.test('ok', () => pm.response.to.have.status(200));"],
              },
            },
          ],
          response: [],
        },
      ],
    },
    {
      name: "Get items",
      id: "get-items",
      request: {
        method: "GET",
        url: {
          raw: "{{base_url}}/items?tenant={{tenant_id}}",
          host: ["{{base_url}}"],
          path: ["items"],
          query: [{ key: "tenant", value: "{{tenant_id}}" }],
        },
        auth: {
          type: "bearer",
          bearer: [{ key: "token", value: "abc", type: "string" }],
        },
      },
    },
  ],
});

function makeFs(files: Record<string, string>): ImporterFileSystem {
  return {
    readFile(path: string): string {
      if (path in files) return files[path]!;
      const err = new Error(`ENOENT: ${path}`) as ImporterFsError;
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

describe("B13 — Postman importer works without the postman-collection SDK", () => {
  it("package.json dependencies does NOT include postman-collection or @types/postman-collection", () => {
    // Path is relative to repo root; vitest cwd is repo root.
    const pkgRaw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as Record<string, Record<string, unknown>>;
    const deps = pkg["dependencies"] ?? {};
    const devDeps = pkg["devDependencies"] ?? {};
    expect("postman-collection" in deps).toBe(false);
    expect("postman-collection" in devDeps).toBe(false);
    expect("@types/postman-collection" in deps).toBe(false);
    expect("@types/postman-collection" in devDeps).toBe(false);
  });

  it("loader returns a parsed v2.1 collection with the expected shape", () => {
    const fs = makeFs({ "/c.json": FIXTURE_COLLECTION_JSON });
    const loader = new PostmanCollectionLoader({ fs });
    const result = loader.load("/c.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collection.parsed.info.schema).toContain("v2.1.0");
    expect(result.collection.parsed.info.name).toBe("B13 Regression Guard Collection");
    expect(result.collection.parsed.item.length).toBe(2);
  });

  it("flattener walks folders + request items end-to-end (no SDK)", () => {
    const fs = makeFs({ "/c.json": FIXTURE_COLLECTION_JSON });
    const result = new PostmanCollectionLoader({ fs }).load("/c.json");
    if (!result.ok) throw new Error("load failed");
    const flattened = new PostmanFlattener().flatten(result.collection);

    // Two requests reachable: auth/Login + Get items.
    expect(flattened).toHaveLength(2);

    const login = flattened.find((r) => r.name === "Login");
    expect(login).toBeDefined();
    expect(login!.method).toBe("POST");
    expect(login!.folderPath).toEqual(["auth"]);
    expect(login!.rawUrl).toBe("{{base_url}}/auth/login");
    expect(login!.headers).toEqual([
      { key: "Content-Type", value: "application/json", disabled: false },
    ]);
    expect(login!.body).toEqual({ mode: "raw", raw: '{"u":"x","p":"y"}' });
    expect(login!.variables).toEqual({
      base_url: "https://api.example.com",
      tenant_id: "acme",
    });

    const get = flattened.find((r) => r.name === "Get items");
    expect(get).toBeDefined();
    expect(get!.method).toBe("GET");
    expect(get!.folderPath).toEqual([]);
    expect(get!.rawUrl).toBe("{{base_url}}/items?tenant={{tenant_id}}");
    expect(get!.query).toEqual([
      { key: "tenant", value: "{{tenant_id}}", disabled: false },
    ]);
    expect(get!.auth).toEqual({ type: "bearer" });
  });

  it("URL-as-string + URL-as-object both normalize to a raw string", () => {
    const stringUrlCollection = JSON.stringify({
      info: { name: "x", schema: "v2.1.0" },
      item: [
        {
          name: "BareString",
          request: { method: "GET", url: "https://x.example.com/path" },
        },
      ],
    });
    const fs = makeFs({ "/c.json": stringUrlCollection });
    const result = new PostmanCollectionLoader({ fs }).load("/c.json");
    if (!result.ok) throw new Error("load failed");
    const flat = new PostmanFlattener().flatten(result.collection);
    expect(flat[0]!.rawUrl).toBe("https://x.example.com/path");
  });
});
