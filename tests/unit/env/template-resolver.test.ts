import { describe, it, expect } from "vitest";

import { resolveTemplates } from "../../../src/env/index.js";

describe("resolveTemplates", () => {
  it("resolves ${env.base_url} to the top-level value", () => {
    const env = { base_url: "https://api-qa.example.com" };
    const result = resolveTemplates({ url: "${env.base_url}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.url).toBe("https://api-qa.example.com");
  });

  it("resolves ${env.db.host} through a nested object path", () => {
    const env = { db: { host: "db-qa.example.com" } };
    const result = resolveTemplates({ h: "${env.db.host}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.h).toBe("db-qa.example.com");
  });

  it("resolves a deeply nested path env.a.b.c", () => {
    const env = { a: { b: { c: "deep" } } };
    const result = resolveTemplates({ x: "${env.a.b.c}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.x).toBe("deep");
  });

  it("reports a missing path naming the full dotted path", () => {
    const env = { db: {} };
    const result = resolveTemplates({ h: "${env.db.host}" }, env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("env.db.host");
    expect(result.error).toContain("env.db.host");
  });

  it("reports a path that traverses through a non-object as missing", () => {
    const env = { base_url: "https://x" };
    const result = resolveTemplates({ y: "${env.base_url.foo}" }, env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("env.base_url.foo");
  });

  it("aggregates multiple missing env references into one error", () => {
    const env = {};
    const result = resolveTemplates({ a: "${env.one}", b: "${env.two}" }, env);
    expect(result.ok).toBe(false);
    expect(result.missing?.sort()).toEqual(["env.one", "env.two"]);
    expect(result.error).toContain("env.one");
    expect(result.error).toContain("env.two");
  });

  it("de-duplicates a path referenced multiple times (missing)", () => {
    const result = resolveTemplates({ a: "${env.gone}", b: "${env.gone}" }, {});
    expect(result.missing).toEqual(["env.gone"]);
  });

  it("preserves a typed number when the whole string is one token", () => {
    const env = { sla: 1000 };
    const result = resolveTemplates({ default_sla_ms: "${env.sla}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.default_sla_ms).toBe(1000);
    expect(typeof result.data?.default_sla_ms).toBe("number");
  });

  it("preserves a typed boolean when the whole string is one token", () => {
    const env = { flag: true };
    const result = resolveTemplates({ f: "${env.flag}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.f).toBe(true);
  });

  it("preserves null when the whole string is one token", () => {
    const env = { maybe: null };
    const result = resolveTemplates({ m: "${env.maybe}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.m).toBeNull();
  });

  it("stringifies a numeric value when embedded in a larger string", () => {
    const env = { port: 5432 };
    const result = resolveTemplates({ s: "port=${env.port}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.s).toBe("port=5432");
  });

  it("JSON-stringifies an array value embedded in a larger string", () => {
    const env = { ports: [1, 2, 3] };
    const result = resolveTemplates({ s: "ports=${env.ports}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.s).toBe("ports=[1,2,3]");
  });

  it("substitutes multiple ${env.*} tokens in one string", () => {
    const env = { prefix: "Bearer", id: "42" };
    const result = resolveTemplates({ h: "${env.prefix} ${env.id}-x" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.h).toBe("Bearer 42-x");
  });

  it("leaves ${secret.*} and other namespaces intact", () => {
    const env = { base_url: "https://x" };
    const result = resolveTemplates(
      {
        a: "${secret.API_KEY}",
        b: "${token}",
        c: "${response.body.id}",
        d: "${request.body.x}",
        e: "${db.pg.q.col}",
        f: "${env.base_url}",
      },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      a: "${secret.API_KEY}",
      b: "${token}",
      c: "${response.body.id}",
      d: "${request.body.x}",
      e: "${db.pg.q.col}",
      f: "https://x",
    });
  });

  it("cannot resolve a secret even if the env object lacks the key", () => {
    // Namespace isolation: ${env.X} consults ONLY envObject, never secrets.
    const env = {};
    const result = resolveTemplates({ a: "${env.API_KEY}" }, env);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("env.API_KEY");
  });

  it("does not re-expand a resolved value that looks like ${env.*}", () => {
    const env = { a: "${env.b}", b: "should-not-appear" };
    const result = resolveTemplates({ k: "${env.a}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.k).toBe("${env.b}");
  });

  it("resolves env references nested deep in the config tree", () => {
    const env = { host: "h1" };
    const result = resolveTemplates(
      { databases: { pg: { host: "${env.host}" } } },
      env,
    );
    expect(result.ok).toBe(true);
    const dbs = result.data?.databases as Record<
      string,
      Record<string, unknown>
    >;
    expect(dbs.pg.host).toBe("h1");
  });

  it("resolves env references inside arrays", () => {
    const env = { a: "1", b: "2" };
    const result = resolveTemplates(
      { list: ["${env.a}", "plain", "${env.b}"] },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.list).toEqual(["1", "plain", "2"]);
  });

  it("passes non-string leaves through unchanged", () => {
    const result = resolveTemplates(
      { n: 42, b: true, z: null, arr: [1, 2] },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ n: 42, b: true, z: null, arr: [1, 2] });
  });

  it("returns ok with empty missing when there are no env tokens", () => {
    const result = resolveTemplates({ name: "qa", prod: false }, {});
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("does not mutate the input config object", () => {
    const env = { v: "x" };
    const input = { k: "${env.v}" };
    resolveTemplates(input, env);
    expect(input.k).toBe("${env.v}");
  });

  it("does not partially substitute when any path is missing", () => {
    const env = { ok: "fine" };
    const result = resolveTemplates({ a: "${env.ok}", b: "${env.nope}" }, env);
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("treats a resolved null as found (not missing) for nested traversal", () => {
    const env = { db: { host: null } };
    const result = resolveTemplates({ h: "host=${env.db.host}" }, env);
    expect(result.ok).toBe(true);
    expect(result.data?.h).toBe("host=null");
  });
});
