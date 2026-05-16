import { describe, it, expect } from "vitest";

import { SecretRegistry, resolveSecrets } from "../../../src/env/index.js";

describe("SecretRegistry", () => {
  it("records and exposes resolved values", () => {
    const reg = new SecretRegistry();
    reg.add("s3cr3t");
    reg.add("other");
    expect(reg.size).toBe(2);
    expect(reg.values().has("s3cr3t")).toBe(true);
    expect(reg.values().has("other")).toBe(true);
  });

  it("de-duplicates identical values", () => {
    const reg = new SecretRegistry();
    reg.add("dup");
    reg.add("dup");
    expect(reg.size).toBe(1);
  });

  it("starts empty", () => {
    expect(new SecretRegistry().size).toBe(0);
  });
});

describe("resolveSecrets", () => {
  it("resolves ${secret.API_KEY} from env.API_KEY with no prefix", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets({ key: "${secret.API_KEY}" }, reg, {
      API_KEY: "abc123",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.key).toBe("abc123");
  });

  it("records resolved values in the registry", () => {
    const reg = new SecretRegistry();
    resolveSecrets({ k: "${secret.TOK}" }, reg, { TOK: "v1" });
    expect(reg.values().has("v1")).toBe(true);
  });

  it("reports an unset secret with the env var name", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets({ k: "${secret.MISSING}" }, reg, {});
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("MISSING");
    expect(result.error).toContain("MISSING");
  });

  it("treats an empty-string secret as missing", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets({ k: "${secret.EMPTY}" }, reg, {
      EMPTY: "",
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("EMPTY");
  });

  it("aggregates multiple missing secrets into one error", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { a: "${secret.AAA}", b: "${secret.BBB}" },
      reg,
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.missing?.sort()).toEqual(["AAA", "BBB"]);
    expect(result.error).toContain("AAA");
    expect(result.error).toContain("BBB");
  });

  it("de-duplicates a secret referenced multiple times", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { a: "${secret.SAME}", b: "${secret.SAME}" },
      reg,
      { SAME: "x" },
    );
    expect(result.ok).toBe(true);
    expect(reg.size).toBe(1);
  });

  it("de-duplicates a missing secret referenced multiple times", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { a: "${secret.GONE}", b: "${secret.GONE}" },
      reg,
      {},
    );
    expect(result.missing).toEqual(["GONE"]);
  });

  it("substitutes multiple tokens within one string", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { h: "Bearer ${secret.A}-${secret.B}" },
      reg,
      { A: "aa", B: "bb" },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.h).toBe("Bearer aa-bb");
  });

  it("resolves secrets nested deep in objects", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { databases: { pg: { password: "${secret.PW}" } } },
      reg,
      { PW: "hunter2" },
    );
    expect(result.ok).toBe(true);
    const dbs = result.data?.databases as Record<
      string,
      Record<string, unknown>
    >;
    expect(dbs.pg.password).toBe("hunter2");
  });

  it("resolves secrets inside arrays", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { list: ["${secret.A}", "plain", "${secret.B}"] },
      reg,
      { A: "1", B: "2" },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.list).toEqual(["1", "plain", "2"]);
  });

  it("leaves ${env.*} and ${token} and other namespaces intact", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      {
        a: "${env.base_url}",
        b: "${token}",
        c: "${response.body.id}",
        d: "${request.body.x}",
        e: "${db.pg.q.col}",
      },
      reg,
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      a: "${env.base_url}",
      b: "${token}",
      c: "${response.body.id}",
      d: "${request.body.x}",
      e: "${db.pg.q.col}",
    });
  });

  it("does not recursively re-expand a secret value that looks like a token", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets({ k: "${secret.A}" }, reg, {
      A: "${secret.B}",
      B: "should-not-appear",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.k).toBe("${secret.B}");
  });

  it("passes non-string leaves through unchanged", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { n: 42, b: true, z: null, nested: { arr: [1, 2] } },
      reg,
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      n: 42,
      b: true,
      z: null,
      nested: { arr: [1, 2] },
    });
  });

  it("returns ok with empty missing for a config with no secret tokens", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets({ name: "qa", prod: false }, reg, {});
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("does not mutate the input config object", () => {
    const reg = new SecretRegistry();
    const input = { k: "${secret.A}" };
    resolveSecrets(input, reg, { A: "v" });
    expect(input.k).toBe("${secret.A}");
  });

  it("never includes the secret value in the missing-path error", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { a: "${secret.SET}", b: "${secret.UNSET}" },
      reg,
      { SET: "TOPSECRETVALUE" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("TOPSECRETVALUE");
  });

  it("does not partially substitute when any secret is missing", () => {
    const reg = new SecretRegistry();
    const result = resolveSecrets(
      { a: "${secret.OK}", b: "${secret.NOPE}" },
      reg,
      { OK: "fine" },
    );
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("defaults to process.env when no env source is given", () => {
    const reg = new SecretRegistry();
    process.env.APIWRIGHT_TEST_SECRET = "fromProcessEnv";
    try {
      const result = resolveSecrets(
        { k: "${secret.APIWRIGHT_TEST_SECRET}" },
        reg,
      );
      expect(result.ok).toBe(true);
      expect(result.data?.k).toBe("fromProcessEnv");
    } finally {
      delete process.env.APIWRIGHT_TEST_SECRET;
    }
  });
});
