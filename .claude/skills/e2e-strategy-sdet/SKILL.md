---
name: e2e-strategy-sdet
description: >-
  Devise an end-to-end testing strategy for a Registry / Repository /
  Catalog product (container, package, schema, model, artifact, or asset
  registry) using APIWright. Use when an SDET (or platform-team engineer)
  asks "how do I set up E2E tests for our registry?", "how do I structure
  smoke vs regression?", "show me an example test file for push-pull",
  "how do I verify webhook delivery / multi-tenant isolation / RBAC /
  pagination / async indexing?". The skill walks through APIWright primitives
  in registry-domain language and produces ready-to-commit `.endpoint.json`
  examples + environment YAML + a recommended directory layout.
---

# E2E Testing Strategy for a Registry-Domain SDET (using APIWright)

This skill speaks to an SDET working on a **registry-class** product —
something that ingests, indexes, and serves artifacts at scale:
container registries (Harbor, ECR, GAR, ACR), package registries (npm,
Maven, PyPI, NuGet, Cargo), schema registries (Confluent, Apicurio),
model registries (MLflow, Vertex, SageMaker), asset/object catalogs
(LakeFS, Unity Catalog, Hive Metastore). The testing concerns are:

- High request volume (1,000s of endpoints, frequent regressions).
- Multi-tenant isolation (one tenant's artifacts MUST NOT leak to another).
- Async indexing (push returns 201, list lags ~1s; webhooks fire later).
- Authentication variety (anonymous reads, token writes, scoped tokens).
- Eventual consistency in DB / search index after writes.
- Idempotency for retries (PUT/DELETE must be safe to repeat).
- Pagination over large collections.
- RBAC / multi-environment promotion (dev → staging → prod).
- CI/CD integration with deterministic ordering for sharded runs.

APIWright is built for exactly this profile. This skill maps the
registry-domain concerns to APIWright primitives and produces a
ready-to-commit test scaffold.

## When to invoke

- An SDET joins the team and asks "how do I write E2E tests with this?".
- Platform team is about to onboard a new registry surface to the test
  suite ("we just shipped a webhook delivery API; how do I verify it?").
- The user wants a worked example: "show me a push-pull test, including
  DB verification and auth".
- The user is designing the smoke vs regression vs e2e split for their
  registry.
- The user wants to know how the runner / reporting / sharding map onto
  a CI pipeline they already have.

## Mental model: registry concerns → APIWright primitives

| Registry concern | APIWright primitive |
|---|---|
| Anonymous reads (public artifacts) | Endpoint with NO `auth_strategy` field. |
| Authenticated writes | Endpoint with `auth_strategy: "user_token"` referencing `auth_strategies.user_token` (token_endpoint) in env YAML. |
| Service-to-service writes | `auth_strategy: "service_token"` referencing a `static_token` strategy whose token is `${secret.SERVICE_TOKEN}`. |
| 401 on missing auth | §3 catalog auto-generates `no_auth_returns_401` — no test author work. |
| 401 on bad token | §3 auto-generates `garbage_token_returns_401` — auto. |
| 405 on wrong method | §3 auto-generates `method_not_allowed`. |
| Body validation errors (400) | §3 auto-generates `malformed_json_returns_400`, `required_field_omission_returns_400`, `type_violation_returns_400`, `boundary_battery` — pure declarative; runner generates the offending bodies. |
| Schema conformance of success response | §3 `response_schema_validation` runs against `endpoint.response.schema`. |
| SLA / latency budgets | §3 `response_time_sla` against per-endpoint `response.sla_ms` (or env `default_sla_ms`). |
| GET / DELETE idempotency | §3 `get_idempotency` / `delete_idempotency` (runs twice, compares). |
| Post-write DB indexing | `db_verify[]` block with `expect: "exists"` (or `match` on fields). |
| Cross-tenant isolation | Separate endpoints per tenant + per-endpoint `db_verify` checking the OTHER tenant's table/collection has NO rows. |
| Multi-environment promotion | One `environments/<name>.yaml` per env; runner picks via `--env`. |
| Custom business invariants ("artifact size ≤ 5GB", "tag count ≤ 100") | `assertions: ["response.body.size_bytes less_than 5368709120", ...]`. |
| Webhook delivery | `db_verify` against the webhook delivery audit table, with `expect: "exists"` on the row that has `event_id = ${response.body.event_id}`. |
| Pagination | `assertions: ["response.body.next_page_token exists", "response.body.items count_greater_than 0"]`. |
| Prod-safety gating | Mark prod-safe endpoints with `prod_safe: true` and configure env `prod: true` — APIWright blocks non-smoke runs against prod. |

## Recommended directory layout

```
tests/
  artifacts/                       # core registry CRUD
    push.endpoint.json             # PUT /artifacts/{id}  (auth-required, db_verify on artifacts table)
    pull.endpoint.json             # GET /artifacts/{id}  (smoke marker)
    list.endpoint.json             # GET /artifacts (smoke + regression; pagination assertions)
    delete.endpoint.json           # DELETE /artifacts/{id} (idempotency + cascade db_verify)
  tags/
    create-tag.endpoint.json
    list-tags.endpoint.json
    resolve-tag.endpoint.json
  search/
    by-name.endpoint.json
    by-label.endpoint.json
  webhooks/
    create-subscription.endpoint.json
    delivery-on-push.endpoint.json # db_verify on webhook_deliveries table
  rbac/
    forbidden-cross-tenant.endpoint.json   # 403 case, tagged "rbac"
    scoped-token-narrow.endpoint.json
  admin/
    purge-tenant.endpoint.json     # ONLY run in non-prod; tag "destructive"
environments/
  qa.yaml         # full QA env: 1 DB conn, 2 auth strategies, base_url
  staging.yaml    # near-prod; prod: false
  prod.yaml       # prod: true → smoke-only without confirmation
apiwright.config.json
README.md         # team-specific onboarding (not a framework file)
```

Tag every endpoint with a `tags: [...]` block to enable orthogonal
filtering (`--tag=billing`, `--exclude-tag=destructive`).

## Marker strategy for a registry suite

The §3 catalog produces tests in three markers: `smoke`, `regression`,
`e2e`. (e2e is v1.5-reserved — do NOT use yet.)

- **smoke** = thin slice across every critical surface. Goal: 60-second
  CI gate on every PR. Examples:
  - `artifacts/pull.endpoint.json` (cache-served GET)
  - `tags/list-tags.endpoint.json` (read-only listing)
  - one auth-protected GET with happy-path token
  - one health endpoint (if you have one)
  - `prod_safe: true` on every smoke endpoint.

- **regression** = the comprehensive surface. Goal: nightly + pre-deploy
  gate. Examples:
  - Push, delete, list, search, RBAC matrix, pagination edge cases,
    boundary-battery on every numeric field, idempotency on PUT/DELETE.
  - The auto-generated negative-auth + body-negative tests cover most
    of this without per-test author work.

Mark each endpoint via the `markers: ["smoke", "regression"]` array in
the endpoint JSON. The `markers` array is INTERSECTED with the catalog
test's marker (e.g., `status_code_conformance` is `smoke`-marked by
the catalog; if your endpoint declares `markers: ["regression"]` only,
that test will NOT run in `--markers=smoke`).

## Example: push artifact + db_verify

```json
{
  "id": "artifacts.push",
  "name": "Push artifact",
  "method": "PUT",
  "url": "/v1/artifacts/${request.body.id}",
  "tags": ["artifact", "write", "critical-path"],
  "markers": ["regression"],
  "prod_safe": false,
  "auth_strategy": "user_token",
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_schema": {
      "type": "object",
      "required": ["id", "size_bytes", "sha256"],
      "properties": {
        "id":          { "type": "string", "pattern": "^[a-z0-9._/-]+$" },
        "size_bytes":  { "type": "integer", "minimum": 1, "maximum": 5368709120 },
        "sha256":      { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "labels":      { "type": "object" }
      }
    },
    "body_example": {
      "id": "team-x/img:v1.2.3",
      "size_bytes": 4096,
      "sha256": "abcd0123ef4567abcd0123ef4567abcd0123ef4567abcd0123ef4567abcd0123",
      "labels": { "env": "qa" }
    }
  },
  "response": {
    "expected_status": 201,
    "schema": {
      "type": "object",
      "required": ["id", "uploaded_at", "url"],
      "properties": {
        "id":          { "type": "string" },
        "uploaded_at": { "type": "string", "format": "date-time" },
        "url":         { "type": "string", "format": "uri" }
      }
    }
  },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id": "row_present",
      "query": "SELECT id, sha256, size_bytes FROM artifacts WHERE id = ${request.body.id}",
      "expect": "match",
      "fields": {
        "id":         "${request.body.id}",
        "sha256":     "${request.body.sha256}",
        "size_bytes": "${request.body.size_bytes}"
      }
    },
    {
      "connection": "primary_postgres",
      "query_id": "search_index_lag_check",
      "query": "SELECT count(*) AS hits FROM search_index WHERE artifact_id = ${request.body.id}",
      "expect": "exists"
    }
  ],
  "assertions": [
    "response.body.uploaded_at is_recent_timestamp",
    "response.body.id equals request.body.id",
    "db.primary_postgres.row_present.rows count_equals 1"
  ],
  "cleanup": {
    "connection": "primary_postgres",
    "query": "DELETE FROM artifacts WHERE id = ${request.body.id}"
  },
  "retry": { "count": 2, "delay_ms": 500, "backoff": "linear" }
}
```

Notes:
- §3 catalog will auto-generate ~12 more tests for this endpoint
  (status code, content type, SLA, schema validation, auth happy path,
  no_auth → 401, garbage_token → 401, method not allowed, malformed
  json, required field omissions for `id`/`size_bytes`/`sha256`, type
  violations for each, boundary battery on `size_bytes` and `id`
  length). Author wrote ONE endpoint; gets ~16 tests.
- `db_verify` discharges the "did the row land?" + "did indexing
  catch up?" concerns. The `query_id` (`row_present`, `search_index_lag_check`)
  lets the assertion reference them via `db.primary_postgres.<qid>`.
- `cleanup` runs LAST per endpoint regardless of pass/fail — keeps the
  DB clean for the next run. NEVER put cleanup in `db_verify`.
- **Write refs BARE, never quoted.** Use `WHERE id = ${request.body.id}`,
  NOT `WHERE id = '${request.body.id}'`. The framework parameterizes each
  `${...}` as a native bind variable (`$1` / `?`), so wrapping it in SQL
  quotes turns it into the literal string `'$1'` and the query fails. The
  same applies to `${...}` used inside `db_verify.fields` expected values:
  write `"id": "${request.body.id}"` (a whole-value ref — resolved
  type-preserving), not an embedded/quoted fragment.

## Example: anonymous pull (smoke)

```json
{
  "id": "artifacts.pull",
  "name": "Pull artifact metadata",
  "method": "GET",
  "url": "/v1/artifacts/team-x%2Fimg:v1.2.3",
  "tags": ["artifact", "read", "public"],
  "markers": ["smoke", "regression"],
  "prod_safe": true,
  "request": {},
  "response": {
    "expected_status": 200,
    "sla_ms": 250,
    "schema": {
      "type": "object",
      "required": ["id", "sha256", "size_bytes"],
      "properties": {
        "id":         { "type": "string" },
        "sha256":     { "type": "string" },
        "size_bytes": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "assertions": [
    "response.headers.cache_control matches /max-age=\\d+/",
    "response.body.size_bytes greater_than 0"
  ]
}
```

This endpoint is `prod_safe: true` and `markers: [smoke, regression]`,
so it runs in prod under `--markers=smoke` (no confirmation prompt) and
in CI regression. The 250ms SLA is enforced by the auto-generated
`response_time_sla` test.

## Example: cross-tenant isolation (RBAC)

```json
{
  "id": "rbac.cross_tenant_forbidden",
  "name": "User from tenant-A cannot read tenant-B artifacts",
  "method": "GET",
  "url": "/v1/artifacts/tenant-b%2Fsecret-img",
  "tags": ["rbac", "security"],
  "markers": ["regression"],
  "prod_safe": false,
  "auth_strategy": "user_token_tenant_a",
  "response": {
    "expected_status": 403,
    "schema": { "type": "object", "required": ["error"] }
  },
  "db_verify": [
    {
      "connection": "audit_postgres",
      "query_id": "denial_logged",
      "query": "SELECT count(*) AS n FROM access_denials WHERE user='tenant-a-user' AND artifact_id='tenant-b/secret-img' AND created_at > now() - interval '10 seconds'",
      "expect": "exists"
    }
  ],
  "assertions": [
    "response.body.error matches /forbidden|unauthorized/i",
    "db.audit_postgres.denial_logged.rows count_greater_than 0"
  ]
}
```

The DB verify on the audit table catches "silent denial" bugs where the
API returns 403 but doesn't log the attempt (audit gap).

## Example environment YAML

```yaml
# environments/qa.yaml
name: qa
prod: false
base_url: https://registry-qa.example.com
default_sla_ms: 500
databases:
  primary_postgres:
    type: postgres
    host: registry-db-qa.internal
    port: 5432
    database: registry
    user: ${secret.QA_DB_USER}
    password: ${secret.QA_DB_PASSWORD}
  audit_postgres:
    type: postgres
    host: registry-audit-qa.internal
    port: 5432
    database: audit
    user: ${secret.QA_AUDIT_USER}
    password: ${secret.QA_AUDIT_PASSWORD}
auth_strategies:
  user_token:
    type: token_endpoint
    url: https://idp-qa.example.com/oauth/token
    credentials:
      username: ${secret.QA_USER}
      password: ${secret.QA_PASSWORD}
    token_path: $.access_token
    expires_in_path: $.expires_in
    refresh_buffer_seconds: 60
    header: Authorization
    header_value: Bearer ${token}
  user_token_tenant_a:
    type: token_endpoint
    url: https://idp-qa.example.com/oauth/token
    credentials:
      username: ${secret.QA_TENANT_A_USER}
      password: ${secret.QA_TENANT_A_PASSWORD}
    token_path: $.access_token
  service_token:
    type: static_token
    token: ${secret.QA_SERVICE_TOKEN}
    header: X-Service-Token
    header_value: ${token}
```

## Example `apiwright.config.json`

```json
{
  "tests_dir": "./tests",
  "environments_dir": "./environments",
  "reports_dir": "./reports",
  "default_env": "qa",
  "default_markers": ["smoke"],
  "log_level": "warn",
  "workers": 8,
  "retry": {
    "count": 2,
    "delay_ms": 1000,
    "backoff": "linear",
    "strict": false
  },
  "report": {
    "html": true,
    "json": true,
    "junit_xml": true,
    "output_dir": "./reports"
  }
}
```

## CI integration (GitHub Actions example)

```yaml
# .github/workflows/api-tests.yml
name: API Tests
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Smoke tests
        env:
          QA_DB_USER: ${{ secrets.QA_DB_USER }}
          QA_DB_PASSWORD: ${{ secrets.QA_DB_PASSWORD }}
          QA_USER: ${{ secrets.QA_USER }}
          QA_PASSWORD: ${{ secrets.QA_PASSWORD }}
          # …
        run: npx apiwright run --env=qa --markers=smoke --log=warn

  regression:
    runs-on: ubuntu-22.04
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Regression shard ${{ matrix.shard }}/4
        env: { ... }
        run: |
          npx apiwright run \
            --env=qa \
            --markers=smoke,regression \
            --shard=${{ matrix.shard }}/4 \
            --workers=4
      - uses: actions/upload-artifact@v4
        with:
          name: reports-shard-${{ matrix.shard }}
          path: reports/
      - name: Publish JUnit results
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: Regression shard ${{ matrix.shard }}
          path: reports/run-*.xml
          reporter: java-junit
```

Notes:
- `--shard=N/M` slices the deterministically-ordered test plan across
  M parallel CI jobs; merge happens via JUnit report aggregation.
- Sharding correctness is guaranteed by the framework — the union of
  M shards is exactly the full plan, no overlap, no gaps.

## Strategy: SDET design principles for the registry suite

1. **One endpoint file per logical operation, not per test type.** The
   §3 catalog produces ~12-16 tests from ONE endpoint definition. Don't
   author negative tests by hand — declare the contract, get coverage.

2. **Mark sparingly, tag liberally.** `markers` is the smoke/regression
   gate; `tags` is the per-team / per-feature slice (`--tag=billing`,
   `--exclude-tag=destructive`). Both AND with each other.

3. **Use `db_verify` to catch async-indexing gaps.** Push-pull-test-with-
   list is a classic anti-pattern: the list lags. Instead, push, then
   `db_verify` directly against the indexing table. The list latency
   gets its own dedicated test.

4. **Per-endpoint `cleanup` is mandatory for write endpoints.** Without
   it, a single run pollutes the test DB and the next run is flaky.
   The runner runs cleanup AFTER assertions, so a failed assertion
   doesn't skip cleanup.

5. **Lean on `retry` for genuinely flaky network paths only.** A
   `retry.count: 2` for every endpoint masks real bugs. Set retries on
   the SHARED config; only override per-endpoint when there's a known
   slow-or-eventual-consistency window.

6. **`prod_safe: true` is a contract with the production data store.**
   An endpoint is prod-safe iff it can be invoked against the prod DB
   without observable side effects (write counts, audit rows, etc.).
   Get this wrong and your `--markers=smoke --env=prod` corrupts data.

7. **Set `default_sla_ms` per env; per-endpoint override only when the
   endpoint is genuinely slower (e.g., scan endpoints).** This avoids
   per-endpoint SLA sprawl.

8. **Negative-auth tests are auto-generated by §3. Don't write them by
   hand.** The `no_auth_returns_401` and `garbage_token_returns_401`
   markers ride on every authenticated endpoint for free.

9. **Authoring discipline: every endpoint is a contract.** Schema,
   expected_status, db_verify, assertions, cleanup. If you can't write
   the full contract, the endpoint isn't ready to ship — the test
   contract is the API contract.

10. **Treat the test repo as production code.** Code-review every
    endpoint JSON. Bad fixtures cause flaky CI; flaky CI causes
    ignored failures; ignored failures cause real bugs. The catalog
    auto-generation makes this CHEAPER, not optional.

## Onboarding workflow for a new SDET

```bash
# 1. Clone the test repo (apiwright is npm-installed)
git clone <test-repo>
cd <test-repo>
npm install

# 2. Set local secrets in .env.qa.yaml (gitignored)
cat > .env.qa.yaml <<EOF
QA_DB_PASSWORD: <ask team>
QA_USER: sdet-onboarding@example.com
QA_PASSWORD: <ask team>
EOF

# 3. Validate the existing tests parse
npx apiwright validate ./tests

# 4. Run smoke against QA (should pass)
npx apiwright run --env=qa --markers=smoke --log=info

# 5. Open the HTML report
open reports/run-*.html

# 6. Author your first endpoint (start with a pull/GET; no db_verify needed)
$EDITOR tests/<feature>/<op>.endpoint.json

# 7. Validate, then run JUST your endpoint
npx apiwright validate ./tests
npx apiwright run --env=qa --endpoint=<your.id> --log=debug
```

## What this skill does NOT do

- It does NOT modify the APIWright framework itself. APIWright is
  treated as a stable dependency.
- It does NOT generate endpoint JSON files automatically from your
  OpenAPI spec — use `apiwright import openapi <url>` for that.
- It does NOT design the underlying registry API. The SDET tests a
  shipped or about-to-ship API contract; they don't author it.

## Related skills

- `audit-v1-spec` — verify the APIWright build is feature-complete
  before relying on it.
