import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint, CanonicalDbVerification } from "../../../src/core/canonical-model.js";
import type { NormalizedResult } from "../../../src/core/normalized-result.js";
import type { DbConnector } from "../../../src/db/index.js";
import { ConnectionPoolRegistry } from "../../../src/db/pool/connection-registry.js";
import { runCleanup, runDbVerifications } from "../../../src/runner/execute/db-verify-runner.js";

/**
 * Builds a fake registry whose acquire returns a fake connector.
 * @param result - NormalizedResult to return from connector.execute.
 * @param shouldThrow - True to make connector.execute throw.
 * @returns A registry-shaped fake with .acquire method.
 */
function fakeRegistry(
  result: NormalizedResult,
  shouldThrow = false,
): ConnectionPoolRegistry {
  const fakeConn: DbConnector = {
    async connect() {},
    async execute(): Promise<NormalizedResult> {
      if (shouldThrow) throw new Error("connector boom");
      return result;
    },
    async disconnect() {},
  };
  // Cheat: we don't need a real registry, just .acquire().
  return {
    acquire: async () => fakeConn,
    disposeAll: async () => ({ ok: true, results: [] }),
  } as unknown as ConnectionPoolRegistry;
}

/** Builds a minimal endpoint with given verifications. */
function endpointWith(verify: CanonicalDbVerification[], cleanup?: { connection: string; query: string }): CanonicalEndpoint {
  return {
    id: "e",
    name: "e",
    method: "GET",
    url: "/x",
    request: {},
    response: { expected_status: 200, schema: {} },
    db_verify: verify,
    ...(cleanup ? { cleanup } : {}),
  };
}

const ROW: NormalizedResult = { rows: [{ id: 1 }], rowCount: 1, raw: {} };
const EMPTY: NormalizedResult = { rows: [], rowCount: 0, raw: {} };

describe("runDbVerifications", () => {
  it("returns empty when endpoint has no db_verify", async () => {
    const r = await runDbVerifications(endpointWith([]), fakeRegistry(ROW), {}, undefined, undefined);
    expect(r.steps).toHaveLength(0);
    expect(r.dbContext).toEqual({});
  });

  it("runs a single verification and surfaces under db.<conn>.<query_id>", async () => {
    const r = await runDbVerifications(
      endpointWith([{ connection: "main", query: "SELECT * FROM x", expect: "exists", query_id: "qq" }]),
      fakeRegistry(ROW),
      {},
      undefined,
      undefined,
    );
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]?.pass).toBe(true);
    expect(r.dbContext["main"]?.["qq"]).toEqual(ROW);
  });

  it("synthesizes a query_id when verification omits one", async () => {
    const r = await runDbVerifications(
      endpointWith([{ connection: "main", query: "SELECT 1", expect: "exists" }]),
      fakeRegistry(ROW),
      {},
      undefined,
      undefined,
    );
    expect(Object.keys(r.dbContext["main"] ?? {})[0]).toBe("q0");
  });

  it("captures connector errors as failing step results", async () => {
    const r = await runDbVerifications(
      endpointWith([{ connection: "main", query: "SELECT 1", expect: "exists" }]),
      fakeRegistry(ROW, true),
      {},
      undefined,
      undefined,
    );
    expect(r.steps[0]?.pass).toBe(false);
    expect(r.steps[0]?.record.reason).toContain("connector execute failed");
  });

  it("captures evaluate failures (e.g., exists with empty rows)", async () => {
    const r = await runDbVerifications(
      endpointWith([{ connection: "main", query: "SELECT 1", expect: "exists" }]),
      fakeRegistry(EMPTY),
      {},
      undefined,
      undefined,
    );
    expect(r.steps[0]?.pass).toBe(false);
  });
});

describe("runCleanup", () => {
  it("returns undefined when endpoint has no cleanup", async () => {
    const r = await runCleanup(endpointWith([]), fakeRegistry(ROW), {}, undefined, undefined);
    expect(r).toBeUndefined();
  });

  it("returns ok:true when cleanup succeeds", async () => {
    const r = await runCleanup(
      endpointWith([], { connection: "main", query: "DELETE FROM x" }),
      fakeRegistry(ROW),
      {},
      undefined,
      undefined,
    );
    expect(r?.ok).toBe(true);
  });

  it("returns ok:false when connector throws", async () => {
    const r = await runCleanup(
      endpointWith([], { connection: "main", query: "DELETE FROM x" }),
      fakeRegistry(ROW, true),
      {},
      undefined,
      undefined,
    );
    expect(r?.ok).toBe(false);
    expect(r?.reason).toContain("connector boom");
  });
});
