# Debugging

How to figure out what APIWright actually did when something didn't
work the way you expected. Companion to
[troubleshooting.md](./troubleshooting.md) (which has the catalogue
of common errors).

The most useful debugging tools are: **the `--log` flag**, **the JSON
report**, and **a careful re-read of the declaration**. In that
order.

---

## Log levels

`--log <level>` sets console verbosity. Configure once in
`apiwright.config.json` (`"log_level": "info"`) or pass `--log`
per-run to override.

| Level | Emits |
|---|---|
| `error` | Only failures (red FAIL lines + summary) |
| `warn` (default) | Above + flaky warnings + plan warnings (e.g. "schema validation skipped because no schema was declared") |
| `info` | Above + per-attempt progress (one line per case as it runs) |
| `debug` | Above + **full request/response bodies, full assertion traces, full db_verify results** |

Most diagnostic work starts with `--log debug`. The volume is high
(every header, every body byte, every assertion eval) — pipe to a
file, then grep.

```bash
apiwright run --env qa --markers smoke --log debug > debug.log 2>&1
less debug.log
```

---

## What `--log debug` shows

For each generated case:

```
DEBUG: users.create attempt 1 request: POST https://qa-api.example.com/users
       headers={"Content-Type":"application/json","Authorization":"Bearer [REDACTED]"}
DEBUG: users.create request body: {"email":"qa@example.com","name":"QA Bot"}
DEBUG: users.create attempt 1 response: 201 in 48ms
DEBUG: users.create response body: {"id":"abc-123","email":"qa@example.com"}
DEBUG: users.create assertion: response.body.id is_uuid_v4 -> PASS
DEBUG: users.create assertion: response.body.email equals request.body.email -> PASS
INFO: users.create attempt 1: pass
```

If the case failed, the same structure but with the assertion(s) or
status check failing visibly inline.

Secrets are still `[REDACTED]` at debug level — the redaction
contract holds at every log level.

---

## The JSON report is your friend

When debug output is too noisy, the structured `run-<ts>.json` report
is faster to pinpoint a specific case:

```bash
# What failed, and why:
jq '.endpoints[] | select(.status == "fail")
    | {id: .endpoint_id, attempts: [.attempts[] | select(.verdict == "fail")
                                                | {reason: .failure_reason, status: .response.status, time_ms: .response.time_ms}]}' \
   reports/run-*.json
```

```bash
# The full request + response for a specific endpoint's first attempt:
jq '.endpoints[] | select(.endpoint_id == "users.create")
    | .attempts[0]' \
   reports/run-*.json
```

```bash
# All assertion results for one endpoint:
jq '.endpoints[] | select(.endpoint_id == "users.create")
    | .attempts[].assertions[]' \
   reports/run-*.json
```

The JSON report captures EVERYTHING the case touched — request
method/URL/headers/body, response status/headers/body/time, every
assertion's pass/fail with target/operator/expected/actual, every
db_verify outcome. No re-running needed.

See [reports.md](./reports.md) for the full report schema.

---

## Reproducing a failing request outside APIWright

If a case fails and you suspect the endpoint (not APIWright), copy
the request from the report and replay with `curl`:

```bash
# From the report's attempts[0].request:
curl -X POST 'https://qa-api.example.com/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_REAL_TOKEN_HERE' \
  -d '{"email":"qa@example.com","name":"QA Bot"}'
```

(The Authorization header in the report is redacted — put your real
token in the curl manually.)

If curl reproduces the failure, it's the endpoint. If curl succeeds
where APIWright fails, it's APIWright or the env config — please file
a bug.

---

## Narrowing the run

When iterating on one failing endpoint, run just that endpoint:

```bash
apiwright run --env qa --markers all --endpoint users.create --log debug
```

The `--endpoint` filter skips every other declaration in the
`tests_dir`, so the run is fast and the log is focused.

For one specific case type on one endpoint (e.g. just the schema
check), drop the marker filter to `--markers smoke` (catalog smoke is
~5 cases per endpoint).

---

## Inspecting the catalog without running

`apiwright validate` does the parse + meta-schema validation without
any network calls — useful for confirming declarations are well-formed
in pre-commit:

```bash
apiwright validate ./tests
# ✓ 47 endpoints validated.
```

There's no "dry-run" flag that emits the test plan without executing
it (one of the [known limitations](./limitations.md)). To preview which
cases would run, run with `--markers smoke --log debug` and read the
INFO lines.

---

## Race conditions / flaky-failure diagnosis

If a test passes sometimes and fails sometimes:

1. **Reproduce with `--workers 1`.** If the failure disappears,
   parallelism is involved (e.g. tests writing to the same DB row
   colliding) — fix by using unique identifiers per case or by
   serialising the colliding tests with marker discipline.

2. **Reproduce with `retry.count: 0`.** If the failure becomes
   100 %-reproducible, retries were masking it; the underlying case
   really is failing.

3. **Inspect the partial-JSONL sidecar.** During a crashed/killed run,
   `reports/run-<ts>.partial.jsonl` survives and contains the
   endpoint-by-endpoint results that DID complete before the crash.
   ```bash
   tail -f reports/run-<ts>.partial.jsonl  # watch in real time
   ```

4. **Check for state coupling.** APIWright doesn't share state
   between cases by design — but external state (database rows, rate
   limits, server-side caches) can. Fresh DB per run is the cleanest
   isolation pattern.

---

## When the docs are wrong

If a doc says one thing and APIWright does another, the source of
truth is the code. Specifically:

- Catalog generators: `src/test-catalog/generators/*.ts`.
- Assertion operators: `src/assertions/operator-registry.ts`.
- Config schema: `src/cli/config/types.ts` + `schema.ts`.
- Env schema: `src/env/schema.ts`.
- DB connector contracts: `src/db/connectors/*.ts`.

Please [file a docs issue](https://github.com/anshulgupta1791/apiwright/issues?labels=docs)
when you find a divergence — that's how the docs improve.

---

## Performance bottleneck diagnosis

If a run feels slower than expected:

1. **Check `summary.duration_ms`** in the JSON report — gross total.
2. **Check per-attempt `response.time_ms`** distribution — find the
   slow endpoints.
3. **Try higher workers** (`--workers 8`, `--workers 16`). If
   duration shrinks linearly, you're CPU/network-bound on the runner.
   If it doesn't, the bottleneck is server-side (the API or DB can't
   keep up).
4. **Try sharding** for very large suites — see
   [performance-and-scale.md](./performance-and-scale.md).

---

## Common debugging recipes

### "Why is this one assertion failing?"

```bash
apiwright run --env qa --endpoint <id> --log debug 2>&1 | grep "<assertion text>"
```

### "What does my schema reject that I think it should accept?"

```bash
apiwright run --env qa --endpoint <id> --log debug 2>&1 \
  | grep -A 20 "response_schema_validation"
```

### "What's actually in the response body?"

```bash
jq '.endpoints[] | select(.endpoint_id == "<id>")
    | .attempts[].response.body' reports/run-*.json
```

### "Which case is the slow one?"

```bash
jq '[.endpoints[].attempts[]
    | {id: .endpoint_id, time_ms: .response.time_ms}]
   | sort_by(-.time_ms) | .[0:10]' reports/run-*.json
```

---

## See also

- [troubleshooting.md](./troubleshooting.md) — the catalogue of common
  errors + fixes.
- [reports.md](./reports.md) — the full JSON report schema.
- [cli.md](./cli.md) — every command and flag (including `--log`).
