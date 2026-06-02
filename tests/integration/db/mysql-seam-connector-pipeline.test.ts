/**
 * Integration test for issue #43 — MySQL seam-to-connector-to-normalizer
 * pipeline against the REAL `Mysql2RawResult` tuple shape returned by
 * mysql2's `pool.execute`.
 *
 * WHY THIS IS AN INTEGRATION TEST, NOT A UNIT TEST:
 *
 *   The unit tests at every layer were green because each layer was tested
 *   in isolation against a fake matching the same (wrong) abstract
 *   interface:
 *     - mysql-seam.test.ts used a fake pool returning `{kind: "rows"}`
 *     - mysql-connector.test.ts used a fake SEAM returning `MysqlQueryResult`
 *     - mysql-result-normalizer.test.ts used a fake `MysqlQueryResult`
 *   Each layer's contract was "agreed upon" — but the agreement was the bug:
 *   no layer was tested against the REAL mysql2 driver shape.
 *
 *   This test wires the REAL seam (`createDefaultMysqlSeam(requireFn)`)
 *   with a fake `requireFn` that returns a fake mysql2 module whose
 *   `pool.execute` mimics the REAL driver's `[result, fields]` tuple shape.
 *   The seam → connector → normalizer chain runs end-to-end; if any link
 *   misinterprets the tuple, the rows come out empty and the test fails.
 *
 *   THIS test would have caught the original bug. The unit tests at 95%
 *   coverage never could — they tested the fiction, not reality.
 *
 * SEE ALSO:
 *   - tests/unit/db/drivers/mysql-seam.test.ts (seam unit)
 *   - tests/unit/db/connectors/mysql-connector.test.ts (connector unit)
 *   - tests/unit/db/connectors/mysql-result-normalizer.test.ts (normalizer unit)
 *   - tests/integration/db/real-driver/mysql.real.integration.test.ts
 *     (the live-driver counterpart that exercises this pipeline against
 *      a real `mysql:8` container)
 */

import { describe, expect, it } from "vitest";

import { MysqlConnector } from "../../../src/db/connectors/mysql-connector.js";
import { createDefaultMysqlSeam } from "../../../src/db/drivers/mysql-seam.js";
import type { ConnectionConfig } from "../../../src/db/types.js";

const TEST_CONFIG: ConnectionConfig = {
  type: "mysql",
  host: "ignored",
  port: 0,
  database: "test",
  user: "test",
  password: "test",
};

/**
 * Builds a fake mysql2 module that returns the REAL `[result, fields]` tuple
 * shape from `pool.execute`. The test mirrors mysql2's exact driver contract
 * — no abstract interface fiction allowed. `executor(sql, values)` decides
 * what the test wants the driver to return for each call.
 */
function makeRealisticMysql2Module(
  executor: (sql: string, values: readonly unknown[]) => unknown,
): unknown {
  return {
    createPool: (_config: unknown) => ({
      async execute(sql: string, values: unknown[]): Promise<unknown> {
        const result = executor(sql, values);
        // Real mysql2 returns [result, fields] — the tuple that broke the seam.
        return [result, [/* fields metadata */]];
      },
      async end(): Promise<void> {},
    }),
  };
}

describe("MySQL seam → connector → normalizer pipeline (issue #43)", () => {
  it("SELECT returns the actual rows end-to-end (the bug-fixing path)", async () => {
    // The REAL driver returns RowDataPacket[] for SELECT — exactly the shape
    // that broke the seam before the fix. End-to-end the connector must
    // return a NormalizedResult.rows containing the same rows.
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => [
        { id: 1, name: "alice" },
        { id: 2, name: "bob" },
      ]),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute("SELECT id, name FROM users");

    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);

    await connector.disconnect();
  });

  it("SELECT returning zero rows reports rowCount=0 correctly", async () => {
    // The negative control: an empty SELECT must come out as rowCount=0
    // / rows=[]. The bug also produced rowCount=0 — but for the wrong reason
    // (the tuple was discarded). This pins the CORRECT zero-rows path.
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => []),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute("SELECT * FROM users WHERE id = 999");

    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);

    await connector.disconnect();
  });

  it("INSERT (OkPacket) reports affectedRows correctly", async () => {
    // Real mysql2 returns an OkPacket-like object for DML. The seam must
    // discriminate (Array.isArray → rows-arm; object → ok-arm) and the
    // normalizer must propagate affectedRows.
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => ({
        affectedRows: 3,
        insertId: 100,
        warningStatus: 0,
      })),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      "INSERT INTO users (name) VALUES ('a'), ('b'), ('c')",
    );

    expect(result.rowCount).toBe(3);
    expect(result.rows).toEqual([]);

    await connector.disconnect();
  });

  it("DDL with no affectedRows defaults to 0 (real mysql2 omits this for some DDL)", async () => {
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => ({
        /* OkPacket without affectedRows — real for some DDL like CREATE INDEX */
      })),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute("CREATE INDEX i ON users(name)");

    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);

    await connector.disconnect();
  });

  it("regression guard: end-to-end SELECT must NOT return rowCount=0 for non-empty results", async () => {
    // The original bug shape: SELECT against a populated table returned
    // rowCount=0. This is the smoke-floor that would have tripped on the
    // bug — if anyone reintroduces tuple-discarding, this fails LOUDLY.
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => [{ n: 1 }]),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute("SELECT 1 AS n");

    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toEqual({ n: 1 });

    await connector.disconnect();
  });

  it("multi-row tuple is fully preserved (no row-loss between layers)", async () => {
    // 50-row test: the kind of scale where row-mishandling becomes obvious.
    const fiftyRows = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      label: `row-${i}`,
    }));
    const seam = createDefaultMysqlSeam(() =>
      makeRealisticMysql2Module(() => fiftyRows),
    );
    const connector = new MysqlConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute("SELECT * FROM t");

    expect(result.rowCount).toBe(50);
    expect(result.rows).toEqual(fiftyRows);

    await connector.disconnect();
  });
});
