# Performance & scale

APIWright is designed to scale to suites with **hundreds to low
thousands** of endpoint declarations without changes to architecture.
This page covers the knobs you can turn — workers, sharding, retry
policy, marker discipline — and what to expect at each scale.

---

## What "scale" means here

| Suite size | Cases generated (typical) | Duration on one runner (4 workers, smoke + regression) |
|---|---|---|
| 10 endpoints | ~150 cases | < 30 s |
| 50 endpoints | ~750 cases | 1–3 min |
| 100 endpoints | ~1,500 cases | 2–6 min |
| 500 endpoints | ~7,500 cases | 10–30 min |
| 1,000+ endpoints | 15,000+ cases | 30+ min (recommend sharding) |

Times depend on API + DB latency more than on APIWright itself —
APIWright's per-case overhead is < 5 ms.

---

## Workers

`workers: N` in `apiwright.config.json` (or `--workers N` on the CLI;
default 4) controls how many cases execute concurrently.

| N | When it helps | When it hurts |
|---|---|---|
| 1 | Debugging (deterministic single-threaded execution) | — |
| 4 (default) | Most local + CI runs | — |
| 8–16 | Suites > 100 endpoints; runners with plenty of CPU/network | When the API or DB is the bottleneck |
| 32+ | Very large suites against a known-scalable target | When you can't load-test the target |

Doubling workers roughly halves wall-clock until you hit a bottleneck
(API rate limit, DB connection pool, CI runner CPU). Past that, more
workers just queue.

```json
{
  "workers": 8
}
```

The **endpoint ordering in the report stays deterministic** regardless
of worker count — that property is asserted by the meta-suite (you can
diff a workers=1 vs workers=8 report's `endpoints[].endpoint_id`
sequence and they're byte-identical).

---

## Sharding (parallel CI jobs)

For very large suites, split the plan across N independent CI jobs:

```bash
apiwright run --env qa --markers smoke --shard 1/4   # job 1
apiwright run --env qa --markers smoke --shard 2/4   # job 2
apiwright run --env qa --markers smoke --shard 3/4   # job 3
apiwright run --env qa --markers smoke --shard 4/4   # job 4
```

Each job runs a deterministic 25 % of the plan. Sharding is consistent
hashing on the plan key, so:

- The same plan + the same N always produces the same shards.
- Adding/removing endpoints shifts a small fraction; most cases stay
  in the same shard.

GitHub Actions matrix example:

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: |
      apiwright run --env qa --markers smoke --shard ${{ matrix.shard }}/4
```

After each shard runs, collect the per-shard reports into one
aggregated view (a separate job that downloads all four artifacts and
posts a summary works well).

---

## Retry policy

`retry: {count, delay_ms, backoff, strict}` in
`apiwright.config.json`. See [configuration.md](./configuration.md)
for full reference.

| Knob | When to tune it |
|---|---|
| `count` | 0 in PR jobs (fail fast); 2 in nightly (tolerate transient flakes); 5 only for known-unreliable upstreams |
| `delay_ms` | **Currently ignored from config — defaults to 1000ms.** See [limitations.md](./limitations.md) |
| `backoff` | **Currently ignored from config — defaults to linear.** See [limitations.md](./limitations.md) |
| `strict` | `true` for production-gating runs (any first-attempt failure is a real failure); `false` for nightly trend tracking (flaky-passes show up as `flaky`, not `fail`) |

Because `delay_ms` is pinned to 1000 ms (linear), each retry adds
~1–2 s per failing case. For a suite that runs ~5 % flaky cases
with retry.count=2, expect ~10–20 % wall-clock overhead.

---

## Marker discipline

The single biggest lever on run time is **how much of the catalog you
run per stage**.

| Stage | Markers | Approximate share of catalog | Why |
|---|---|---|---|
| PR check | `smoke` | ~30 % | Fast — happy-path commodity (status, content-type, schema, sla, auth_happy, declared assertions) |
| Pre-deploy | `smoke,regression` | ~95 % | Thorough — adds negatives (boundary, type-violation, required-omission, malformed, auth boundaries, idempotency, db_state) |
| Nightly | `all` | 100 % | Everything including e2e (v1.5+) |

A 100-endpoint suite with smoke takes ~2 min; with smoke+regression
~6 min; with all ~6 min today (e2e is v1.5). The smoke-only PR gate
is what keeps CI velocity high.

See [markers-and-lifecycle.md](./markers-and-lifecycle.md) for the
recommended pipeline.

---

## CLI filters

Beyond markers, four filters narrow what runs:

| Filter | Use for |
|---|---|
| `--tag write` | "Only run write endpoints" — useful when DB is the bottleneck |
| `--exclude-tag flaky` | "Skip known-flaky endpoints" |
| `--endpoint <id>` | "Debug one specific endpoint" |
| `--path tests/users/` | "Only run tests under this directory" — useful for service-level subsets |

All AND-combine. A `users-team` CI job might run:

```bash
apiwright run --env qa --markers smoke --path tests/users/ --exclude-tag external
```

---

## Network / DB pool tuning

APIWright doesn't expose HTTP connection-pool size directly — it uses
Node's default (8 sockets per host). For most APIs, that's fine.

DB connection pools are managed per connector:

- **PostgreSQL** (`pg`): pool size defaults to 10. Override per
  connection in the env YAML:

```yaml
databases:
  primary_postgres:
    type: postgres
    host: ...
    pool: { max: 20 }
```

- **MySQL** (`mysql2`): same pattern.
- **MongoDB** (`mongodb`): the URI controls pool size
  (`?maxPoolSize=N`).
- **Neo4j** (`neo4j-driver`): driver-managed pool, conservative
  defaults.

For runs > 16 workers, bump pool sizes to match: `pool: {max:
workers * 2}` is a safe rule of thumb.

---

## Memory footprint

APIWright holds the parsed catalog + the running test plan in
memory. Per-endpoint footprint is small (< 50 KB); a 1,000-endpoint
suite uses ~50 MB resident.

Reports stream to disk incrementally (the partial-JSONL sidecar) —
APIWright never holds all report content in memory.

If you're seeing OOM on very large suites:

1. Bump runner memory (CI runners typically have 7 GB; > 2,000-endpoint
   suites might need more headroom).
2. Shard the run — each shard's memory footprint is `1/N` of the
   whole.

---

## What APIWright is not built for

For these patterns, use a different tool:

- **High-throughput load testing.** APIWright's workers default to 4
  — it's designed for functional correctness, not load. Use k6 /
  Gatling for soak tests, RPS ceilings, p99 latency under load.
- **Long-running tests.** APIWright has a per-endpoint default
  timeout of 30 s. For 60-minute polling tests, you want a different
  tool.
- **Streaming responses.** WebSocket / SSE / chunked-with-state
  responses aren't modelled in v1.0.

See [limitations.md](./limitations.md).

---

## Performance debugging recipe

If a run is slower than expected:

1. **Inspect per-endpoint `response.time_ms`** in the JSON report.
   Find the slow endpoints:

   ```bash
   jq '[.endpoints[].attempts[]
        | {id: .endpoint_id, time_ms: .response.time_ms}]
       | sort_by(-.time_ms) | .[0:10]' reports/run-*.json
   ```

2. **Compare workers=1 to workers=N duration.** If the ratio is N,
   you're CPU/network-bound on the runner — bump workers (until
   bottlenecked) or shard. If the ratio is closer to 1, the API or DB
   is the bottleneck — adjust on the server side.

3. **Check retry attempts.** If many cases are taking 2-3 attempts,
   each pays a 1000ms-default retry delay. Look for transient failures
   and fix root causes.

4. **Profile the catalog.** A handful of endpoints with rich body
   schemas (many required + typed + boundary-constrained fields)
   generate a disproportionate share of cases. Confirm those endpoints
   actually need that much coverage; if not, drop some constraints
   from the declaration.

---

## Reference benchmarks

Approximate observed numbers from our internal dogfooding harness on
a MacBook Pro M2:

| Run | Endpoints | Cases | Duration | Throughput |
|---|---|---|---|---|
| Local Apicurio smoke | 5 | ~20 | < 1 s | ~25 cases/s |
| Local Apicurio smoke + regression | 5 | ~30 | ~3 s | ~10 cases/s |
| Stripe live (smoke only) | 2 | ~6 | ~2 s | ~3 cases/s (network-bound) |
| MLflow smoke + regression | 2 | ~15 | ~2 s | ~7 cases/s |

For network-bound runs (real external APIs), throughput is limited
by API latency × workers. For local runs, throughput is limited by
runner CPU.

---

## See also

- [configuration.md](./configuration.md) — `workers` and `retry`
  config block.
- [cli.md](./cli.md) — `--workers` / `--shard` / `--retries` flags.
- [markers-and-lifecycle.md](./markers-and-lifecycle.md) — when to
  run which marker subset.
- [limitations.md](./limitations.md) — known retry-config gaps.
