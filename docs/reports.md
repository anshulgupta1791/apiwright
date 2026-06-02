# Reports

Every `apiwright run` produces three artifacts in `reports_dir`, all
sharing one timestamped basename:

| File | For | Format |
|---|---|---|
| `run-<ts>.json` | Tooling / downstream parsing | Structured `RunResult` — the source of truth |
| `run-<ts>.html` | Humans | Self-contained HTML page that opens locally in a browser |
| `run-<ts>.xml` | CI test-result publishers | Standard JUnit XML |

Plus a temporary sidecar for crash recovery:

| File | For | Format |
|---|---|---|
| `run-<ts>.partial.jsonl` | Forensics on a crashed run | One JSON object per endpoint as it completes; removed on graceful exit |

All four are written incrementally as the run proceeds. The full JSON
report replaces the partial sidecar at graceful close; on crash, you
inspect the sidecar.

---

## JSON report — the source of truth

`run-<ts>.json` is what downstream tooling (CI scripts, dashboards,
external meta-test harnesses) consumes. Stable schema, machine-
parseable, **and redacted** — every `${secret.*}` value is replaced
with `[REDACTED]` before the file is written to disk.

### Top-level shape

```json
{
  "started_at": 1780055508873,        // unix ms
  "ended_at":   1780055509019,        // unix ms
  "env":        "qa",                 // the env name used
  "filters":    { "markers": ["smoke", "regression"] },
  "shard":      { "shard": 1, "count": 1 },
  "workers":    4,
  "endpoints":  [ /* EndpointResult per endpoint, see below */ ],
  "summary":    {
    "endpoints_planned": 47,
    "passed":            45,
    "failed":            1,
    "flaky":             1,
    "duration_ms":       12503
  }
}
```

### Per-endpoint result

```json
{
  "endpoint_id": "users.create",
  "status":      "pass",              // "pass" | "fail" | "flaky"
  "flaky":       false,
  "attempts":    [ /* one per generated case, see below */ ],
  "cleanup":     { "ok": true }       // optional
}
```

`endpoints[]` is in declared order — deterministic regardless of
worker count.

### Per-attempt (per generated case) result

```json
{
  "attempt":        1,                // 1-based; > 1 means a retry
  "verdict":        "pass",           // "pass" | "fail"
  "started_at":     1780055508873,
  "ended_at":       1780055508921,
  "request": {
    "method":       "POST",
    "url":          "https://qa-api.example.com/users",
    "headers":      { "Authorization": "Bearer [REDACTED]", "Content-Type": "application/json" },
    "body":         { "email": "qa@example.com", "name": "QA Bot" }
  },
  "response": {
    "status":       201,
    "headers":      { "content-type": "application/json", "..." },
    "body":         { "id": "abc-123", "email": "qa@example.com" },
    "time_ms":      48
  },
  "assertions": [
    {
      "assertion":  "response.body.id is_uuid_v4",
      "target":     "response.body.id",
      "operator":   "is_uuid_v4",
      "pass":       true
    }
  ],
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id":   "user_persisted",
      "pass":       true,
      "normalized": { "rowCount": 1, "rows": [{ "email": "qa@example.com" }] }
    }
  ],
  "failure_reason": null              // populated when verdict == "fail"
}
```

Every generated case appears as one element in `attempts[]`. If a case
was retried, you see attempt 1 (fail), attempt 2 (fail or pass), etc.

### Common consumption patterns

**Pass/fail count for CI exit-code logic:**

```bash
jq '.summary | {passed, failed, flaky}' reports/run-*.json
```

**List failing endpoints with reasons:**

```bash
jq '.endpoints[] | select(.status == "fail")
    | { id: .endpoint_id, reasons: [.attempts[].failure_reason] | unique }' \
   reports/run-*.json
```

**Audit secret leakage (paranoid CI gate):**

```bash
if grep -q "$MY_REAL_SECRET" reports/run-*.json; then
  echo "::error::secret leaked into report!"
  exit 1
fi
```

---

## HTML report — for humans

`run-<ts>.html` is a single self-contained HTML file that opens in any
browser. No build step, no server, no external assets.

Layout:

1. **Summary banner** — pass/fail/flaky counts, environment, duration.
2. **Per-endpoint accordions** — each endpoint expands to show:
   - Status badge (green / red / yellow).
   - Every generated case with its verdict + failure reason.
   - The actual request sent (method, URL, headers, body).
   - The actual response received (status, headers, body, time_ms).
   - Assertion results (each with target / operator / expected / actual).
   - `db_verify` results (each with query / row count / fields matched).
3. **Run metadata** — env, filters, workers, retry policy.

Useful for: local-run inspection, archiving as a CI artifact for QA to
look at later, sharing failures in chat (single HTML file attaches
cleanly).

---

## JUnit XML — for CI test-result publishers

`run-<ts>.xml` is standard JUnit XML — the format every major CI
platform's "test results" UI can ingest.

Shape:

```xml
<testsuites tests="120" failures="3" time="12.503">
  <testsuite name="users.create" tests="29" failures="0">
    <testcase name="status_code_conformance" classname="users.create" time="0.048"/>
    <testcase name="response_schema_validation" classname="users.create" time="0.048"/>
    <testcase name="auth_happy_path" classname="users.create" time="0.052"/>
    ...
  </testsuite>
  <testsuite name="users.list" tests="8" failures="1">
    <testcase name="response_time_sla" classname="users.list" time="2.301">
      <failure message="SLA 2000ms exceeded (got 2301ms)" type="response_time_sla"/>
    </testcase>
    ...
  </testsuite>
</testsuites>
```

One `<testsuite>` per endpoint; one `<testcase>` per attempt. Retried
attempts are preserved as separate testcases (so the platform's "this
test is flaky" detection works).

### Wiring into your CI test view

| Platform | Where to point it |
|---|---|
| GitHub Actions | `dorny/test-reporter@v1` with `path: reports/*.xml`, `reporter: java-junit` |
| GitLab CI | `artifacts.reports.junit: reports/*.xml` in the job definition |
| Jenkins | `junit 'reports/*.xml'` post-stage |
| Azure Pipelines | `PublishTestResults@2` task with `testResultsFiles: '**/run-*.xml'`, `testResultsFormat: 'JUnit'` |

The four ready-to-paste workflows in [`examples/ci/`](../examples/ci/)
already do this — see [ci-cd.md](./ci-cd.md).

---

## Partial JSONL sidecar — crash recovery

While a run is in progress, APIWright writes a `run-<ts>.partial.jsonl`
file in `reports_dir`. One redacted endpoint result per line, appended
as the endpoint completes.

On graceful exit (run finishes), the sidecar is deleted and the full
JSON report takes its place.

On crash (process killed, OS panic, OOM), the sidecar survives and you
get partial results for forensics:

```bash
cat reports/run-<ts>.partial.jsonl | jq '.endpoint_id, .status'
```

An external meta-test harness asserts that the sidecar is correctly
removed on graceful exit.

---

## Redaction contract

Every `${secret.X}` value resolved by the environment loader is
registered as a secret. Before any output is written (console, JSON,
HTML, JUnit, partial JSONL), the writer pipeline replaces every
occurrence of every registered secret value with the literal string
`[REDACTED]`.

This applies to:

- Request headers (`Authorization: Bearer [REDACTED]`).
- Request body fields that happen to contain a secret value.
- Response body fields that happen to contain a secret value.
- Database connection strings printed in connector errors.
- Console log output at any log level.

**You don't have to do anything to opt in** — every secret-resolved value
is registered automatically. The contract is verified by an external
meta-test that injects a canary token and asserts it never appears raw
in the report.

---

## Where the artifacts go

By default `./reports/` (relative to the working directory).
Configurable via:

- `reports_dir` in `apiwright.config.json` — affects all formats.
- `report.output_dir` in `apiwright.config.json` — affects just the
  report files (lets you separate JSON from the rest if you want).
- `--reports-dir <path>` on the CLI — overrides the config.

Each run produces a new timestamped basename (`run-<unix-ms>.json`),
so historic runs accumulate. Garbage-collect old reports in CI by
archiving + clearing the directory between jobs.

---

## See also

- [configuration.md](./configuration.md) — the `report.{html,json,junit_xml,output_dir}`
  config block.
- [ci-cd.md](./ci-cd.md) — wiring reports into your CI's native test
  view.
- [environment-config.md](./environment-config.md) — the redaction
  contract source-of-truth.
