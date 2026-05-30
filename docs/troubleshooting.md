# Troubleshooting

Common errors, what they actually mean, and how to fix them. If your
issue isn't here, please file a [GitHub
Issue](https://github.com/anshulgupta1791/apiwright/issues) with the
log output and a minimal reproduction.

---

## Validation errors (at `apiwright validate` time)

### `Endpoint validation failed: response must be an object with expected_status and schema`

**Cause:** older releases required `response.schema` even for
bodyless responses (204, status-only). The current release makes it
optional, but the apiwright `dist` you have installed may pre-date the
fix.

**Fix:** add a minimal schema even for 204 endpoints —
`"schema": {"type": "object"}` — or upgrade APIWright to the latest
patch.

### `'request' requires one of headers/body/url as second segment`

**Cause:** an assertion uses an unknown target path. Valid roots are
`request`, `response`, `db`.

```json
"assertions": [
  "body.id is_uuid_v4"            // ❌ missing "response."
]
```

**Fix:** use the full target path:

```json
"assertions": [
  "response.body.id is_uuid_v4"   // ✅
]
```

### `Unknown root '<word>'; expected one of: request, response, db`

**Cause:** an assertion operand looks like a target-ref but starts
with an unknown root word. Most often a bareword string literal that
the parser tried to treat as a target path.

```json
"response.body.name equals THIS_IS_NOT_THE_NAME"   // ❌
```

**Fix:** quote string literals:

```json
"response.body.name equals \"THIS_IS_NOT_THE_NAME\""   // ✅
```

### `Arity error: operator 'X' takes no operand; unexpected '...'`

**Cause:** you wrote an operand for a nullary operator (`exists` /
`not_exists` / `is_null` / `is_not_null` / `is_uuid_v4` /
`is_iso_timestamp` / `is_recent_timestamp` / `is_email` / `is_url`).

```json
"response.body.id is_uuid_v4 true"   // ❌ — is_uuid_v4 takes no operand
```

**Fix:** drop the operand:

```json
"response.body.id is_uuid_v4"        // ✅
```

### `Bad regex flag 'X'`

**Cause:** `matches` regex flags are restricted to `i`, `m`, `s`, `u`.

**Fix:** drop the offending flag, or replace with an equivalent.

---

## Run errors

### `unknown command '<word>'`

**Cause:** typo in the subcommand or a stray positional argument.

**Fix:** check `apiwright --help` for valid subcommands (`validate`,
`run`, `import`, `docs`).

### `error: missing required argument 'dir'`

**Cause:** `apiwright validate` requires a directory argument.

**Fix:** pass the path: `apiwright validate ./tests`.

### `connection 'primary_postgres' not found`

**Cause:** an endpoint's `db_verify` references a connection name
that isn't in the environment YAML's `databases:` block.

**Fix:** add the connection to the YAML, or fix the reference on the
endpoint:

```yaml
databases:
  primary_postgres:
    type: postgres
    host: ${secret.QA_PG_HOST}
    ...
```

### `ECONNREFUSED` (HTTP request or db_verify)

**Cause:** the target service isn't reachable from where APIWright is
running.

**Fix:** check:
- Is the service actually up? (`curl <url>` from the same host.)
- Is the base URL correct? (Pay attention to `http` vs `https`,
  trailing slashes, port numbers.)
- Inside docker-compose, use the service name as host, not
  `localhost`. (See [docker.md](./docker.md).)

### `ETIMEDOUT`

**Cause:** the request reached the network but the response didn't
come back in time.

**Fix:**
- For genuinely slow endpoints, increase `sla_ms` on the declaration.
- For network/firewall issues, check connectivity from your runner.

### `Unknown auth strategy 'X'. Known: []`

**Cause:** an endpoint declares `auth_strategy: X` but the
environment YAML's `auth_strategies:` block doesn't define `X`.

**Fix:** add the strategy to the YAML:

```yaml
auth_strategies:
  bearer:                    # the name the endpoint references
    type: static_token
    token: ${secret.QA_API_TOKEN}
    header: Authorization
    header_value: Bearer ${token}
```

### `Could not resolve ${secret.X}`

**Cause:** the YAML references `${secret.X}` but the env var `X`
isn't set in `process.env`.

**Fix:** export the env var before invoking APIWright:

```bash
export QA_API_TOKEN=...
apiwright run --env qa --markers smoke
```

For Docker, pass with `-e QA_API_TOKEN` or `--env-file .env.qa`.

---

## Per-case failure reasons

These are the structured `failure_reason` strings you'll see in the
report (and the console output).

### `expected status X, got Y`

**Source case:** `status_code_conformance`.

**Cause:** the endpoint returned a different HTTP status than
declared. Either your declaration is wrong, or the endpoint has
regressed.

**Fix:** verify the actual response (re-run with `--log debug` to
see the full response body) and update either the declaration's
`expected_status` or the endpoint code, whichever is correct.

### `response body did not match schema`

**Source case:** `response_schema_validation`.

**Cause:** the response body violates `response.schema`. Most common:
missing required fields, wrong types, or pattern mismatch.

**Fix:** re-run with `--log debug` to see the actual response. Either
your schema is too strict, or the response has regressed.

### `SLA Nms exceeded (got Mms)`

**Source case:** `response_time_sla`.

**Cause:** the response took longer than `sla_ms` (or environment
`default_sla_ms`).

**Fix:** either the endpoint is slower than declared (real
regression — investigate), or the declared SLA is unrealistic for the
environment (relax `sla_ms`).

### `declarative assertion failed`

**Source case:** `assertion`.

**Cause:** one of the entries in `assertions[]` evaluated to false.
The per-assertion result in the report includes the operator,
expected, actual, and `failureCode` for the exact failure.

**Fix:** inspect the report's `attempts[].assertions[].failureCode`
and `actual` fields to see what went wrong.

### `db_verify did not satisfy expect mode`

**Source case:** `db_state_matches_expectation` (write methods only).

**Cause:** the `db_verify` query result did not match the declared
`expect` mode. The report's `attempts[].db_verify[].normalized.rows`
shows what the query actually returned.

**Fix:** investigate why the row isn't present / doesn't match
expected columns. Either the endpoint isn't writing what it should,
or your `db_verify` query is wrong.

### `HTTP request aborted (endpoint timeout exceeded)`

**Cause:** the per-endpoint timeout (default 30 s) fired before the
response was received. The request was actively aborted.

**Fix:** the endpoint is genuinely too slow OR there's a network /
firewall stall. Investigate with `curl` from the same host to confirm.

---

## "It worked locally but fails in CI"

The classic. A few common culprits:

### Different network reachability

CI runners are usually in a different network than your dev machine
(no VPN, no `/etc/hosts` overrides, different DNS). Check:

```bash
# In your CI script, before APIWright runs:
curl -v "$BASE_URL"           # smoke-test the connectivity
nslookup <db-host>             # confirm DNS resolves
```

### Different secrets

Locally you have `.env.local`; CI uses platform secrets. Verify all
`${secret.*}` references in your YAML have matching env vars in CI:

```bash
# In your CI script, before APIWright runs:
env | grep -E "QA_|API_TOKEN" | sort  # don't print values, just names
```

### Different DB state

Your local DB has historic data; the CI DB is fresh. Endpoints that
assume preexisting rows (or assume `not_exists` of rows you'd
previously cleaned up) will diverge.

**Fix:** isolation — either spin up a fresh DB per CI run via docker-
compose, or use unique IDs per run (timestamp suffix) so cases don't
collide.

### Different timing

CI runners are slower / less consistent. `sla_ms: 100` may pass on
your dev machine and fail in CI.

**Fix:** set realistic SLAs (account for CI runner performance) or
keep timing assertions out of CI-gated runs.

---

## Known limitations (not bugs in your usage)

These are real gaps in v1.0; documented in [limitations.md](./limitations.md):

- `db_verify` on a GET endpoint executes but does NOT gate the run.
- Config-level `retry.delay_ms` and `retry.backoff` are ignored;
  defaults (1000 ms / linear) apply regardless.
- Per-endpoint `retry.count` is overridden by the global config count.
- Multi-step flows aren't supported in v1.0 — deferred to v1.5.

---

## Debugging workflow

1. **Run with `--log debug`** to see every HTTP request/response and
   assertion trace. See [debugging.md](./debugging.md).
2. **Inspect the JSON report** at `reports/run-<ts>.json` —
   particularly `endpoints[].attempts[].request` and
   `attempts[].response`. The full request and response bodies are
   captured.
3. **Reproduce the failing request with curl** outside APIWright —
   confirms it's an endpoint issue, not an APIWright issue.
4. **Try `apiwright validate ./tests`** in isolation — catches
   declaration errors without making any network calls.
5. **File a bug** if you reproduced an APIWright issue:
   https://github.com/anshulgupta1791/apiwright/issues — include the
   declaration, the failing log line, and the version.

---

## See also

- [debugging.md](./debugging.md) — log levels and tracing strategy.
- [faq.md](./faq.md) — common questions.
- [limitations.md](./limitations.md) — what v1.0 doesn't do.
