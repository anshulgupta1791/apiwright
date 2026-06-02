# Real-driver DB integration tests

These tests exercise the four DB connector seams (`postgres`, `mysql`,
`mongodb`, `neo4j`) against **real database containers** spun up via
[`testcontainers`](https://node.testcontainers.org/). They live in their
own directory because they have a different cost / requirement profile
from the rest of `tests/integration/`:

- They need a running Docker daemon.
- Each test file boots a container (~3-15s warm cache, longer cold).
- They prove the layer that the unit + seam-fake tests can't reach —
  whether our seam's declared contract actually matches the live driver's
  behaviour for `pg` / `mysql2` / `mongodb` / `neo4j-driver`.

## Running locally

```bash
# All four engines, sequentially (vitest auto-skips when Docker is absent):
npm run test:real-db

# Single engine:
npx vitest run tests/integration/db/real-driver/postgres.real.integration.test.ts
```

The tests honour two env-var opt-outs:

- `SKIP_TESTCONTAINERS=true` — force-skips regardless of Docker presence
  (useful in CI runners that have Docker but should not pay the cost).
- Docker daemon unreachable — the suite auto-skips after a 1-line probe
  (`getContainerRuntimeClient()`).

## What they pin

Each test file boots the canonical official image for its engine
(`postgres:16-alpine`, `mysql:8`, `mongo:7`, `neo4j:5`), opens the real
connector with the DEFAULT seam (which `createRequire`s the real
driver), and runs three contract-shaped scenarios:

| Test | Engine-specific name | What it proves |
|---|---|---|
| **Connect + parameterized SELECT** | `RETURN $p0 AS n` / `SELECT ?` / `RETURN ${SENT0} AS n` / `{ping:1}` | Lazy-require of the driver works; seam round-trips a primitive correctly. |
| **CREATE → INSERT → SELECT** round-trip | `CREATE TABLE` + `INSERT` + `SELECT` (SQL) or `CREATE` + `MATCH` (Cypher) or `insert` + `find` (Mongo) | The binder's sentinel-substitution pipeline produces correct queries against a real driver. |
| **Mutation rowCount** | `DELETE FROM ... WHERE val IN (...)` / `MATCH ... DELETE` / `count: ...` | The normalizer correctly projects driver-specific count fields onto `NormalizedResult.rowCount`. |

## Neutral query form (Neo4j + MySQL)

The connector's `execute(query, params)` API expects queries in
**neutral form**: every parameter site is marked with the sentinel
` APIWRIGHT_PARAM_<N> ` (space-bounded, where `<N>` is the zero-based
QueryParams index). The engine binder rewrites these sentinels to the
driver's native placeholder (`$N+1` for pg, `?` for mysql2, `$pN` for
neo4j) and emits values in the correct order.

For **pg** this distinction doesn't matter at the test level: the pg
binder uses `refs.map`, so the values array is correctly sized even when
the SQL contains user-written `$1` placeholders without sentinels.

For **mysql2** + **neo4j-driver** it does matter: their binders collect
values per *sentinel occurrence*. User-written `?` / `$identifier` are
treated as opaque and no values are spliced. The Neo4j and MySQL tests
in this directory therefore use the sentinel form directly, mirroring
what `db_verify`'s upstream ref-extractor emits in production.

## Why not just `tests/integration/db/`?

The existing files there (`db-connector-layer.test.ts`,
`mongo-seam-connector-pipeline.test.ts`, ...) use **hand-written fake
seams** — fast, hermetic, no Docker. They prove the connector talks
correctly *to its contract*. These real-driver tests prove the contract
*matches what the driver actually does*. Both layers are needed; bugs
caught in one were silent in the other (per the 2026-05-30 mock-blindness
audit).
