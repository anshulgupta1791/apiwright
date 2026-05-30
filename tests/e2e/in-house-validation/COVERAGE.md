# In-House E2E Coverage Matrix

Every user-facing claim in `the v1 spec` mapped to the endpoint
file(s) and test file(s) that exercise it against a real public API or
self-hosted real production tool. **No mocks.** When a target needs a
credential, the test self-skips if the credential is absent — so a
fresh clone with no env vars set produces a green run that exercises
only the no-auth checkpoints.

## Targets and credentials

| # | Target | Type | Credential | Env var |
| --- | --- | --- | --- | --- |
| 1 | httpbin.org | public, no auth | none | — |
| 2 | jsonplaceholder.typicode.com | public, no auth | none | — |
| 3 | pokeapi.co | public, no auth | none | — |
| 4 | api.github.com (anonymous) | public, optional auth | none | — |
| 5 | api.github.com (PAT) | scoped fine-grained PAT, single test repo | personal PAT | `APIWRIGHT_E2E_GH_PAT` |
| 6 | api.stripe.com (test mode) | test-only API | test secret key | `APIWRIGHT_E2E_STRIPE_KEY` |
| 7 | api.openweathermap.org | public free tier | API key | `APIWRIGHT_E2E_OWM_KEY` |
| 8 | MongoDB Atlas (free M0) | hosted real Mongo | connection URI | `APIWRIGHT_E2E_MONGO_URI` |
| 9 | Neo4j AuraDB (free tier) | hosted real Neo4j | URI + user + pass | `APIWRIGHT_E2E_NEO4J_*` |
| 10 | PlanetScale (free MySQL) | hosted real MySQL | connection URI | `APIWRIGHT_E2E_MYSQL_URI` |
| 11 | Apicurio Registry (Docker compose) | self-hosted real registry + Postgres | none (local) | — |
| 12 | MLflow tracking server (Docker compose) | self-hosted real tracking + MySQL | none (local) | — |

## Coverage matrix — every v1.0 claim → exercising endpoint/test file

### §3 Test catalog — "65-70% coverage for free"

| Claim | Endpoint file | Test file | Target |
| --- | --- | --- | --- |
| One endpoint → ~12-16 generated tests | `tests/jsonplaceholder/posts-get.endpoint.json` | `checkpoint-b-catalog-coverage.e2e.test.ts` | JSONPlaceholder |
| `no_auth_returns_401` auto-generated | `tests/github-pat/issues-list.endpoint.json` (auth-protected) | `checkpoint-d-auth.e2e.test.ts` | GitHub PAT |
| `garbage_token_returns_401` auto-generated | same | same | GitHub PAT |
| `method_not_allowed` auto-generated | `tests/httpbin/post-body-echo.endpoint.json` | `checkpoint-a-wiring.e2e.test.ts` | httpbin |
| `malformed_json_returns_400` auto-generated | same | same | httpbin |
| `required_field_omission_returns_400` per field | `tests/stripe/charge-create.endpoint.json` | `checkpoint-e-validation.e2e.test.ts` | Stripe test |
| `type_violation_returns_400` per typed field | same | same | Stripe test |
| `boundary_battery` (min/max/length) | same | same | Stripe test |
| `response_schema_validation` happy path | `tests/github-anon/user-profile.endpoint.json` | `checkpoint-c-filters.e2e.test.ts` | GitHub anonymous |
| `response_time_sla` enforcement | `tests/httpbin/delay-sla.endpoint.json` (sla_ms < /delay/1's latency) | `checkpoint-a-wiring.e2e.test.ts` | httpbin |
| `get_idempotency` (run twice, compare) | `tests/github-anon/user-profile.endpoint.json` | `checkpoint-c-filters.e2e.test.ts` | GitHub anonymous |
| `delete_idempotency` | `tests/github-pat/gist-delete.endpoint.json` | `checkpoint-d-auth.e2e.test.ts` | GitHub PAT |

### §9 Filters — every flag interacts cleanly

| Claim | Test file | Notes |
| --- | --- | --- |
| `--markers=smoke` | `checkpoint-c-filters.e2e.test.ts` | runs subset, counts |
| `--markers=smoke,regression` | same | runs union |
| `--markers=all` | same | runs full count |
| `--tag=billing` | same | uses tagged endpoints |
| `--exclude-tag=destructive` | same | drops destructive-tagged |
| `--path=tests/github-anon/` | same | runs subtree only |
| `--endpoint=github.user_profile` | same | runs exactly one |
| Filters compose AND | same | combined flags intersect |
| `prod_safe` enforcement | `checkpoint-c-filters.e2e.test.ts` | prod env drops non-safe |

### §9 + Fix #6 Runner / parallelism

| Claim | Test file | Endpoint file(s) |
| --- | --- | --- |
| `--workers=N` default = CPU | `checkpoint-a-wiring.e2e.test.ts` | sandbox config defaults |
| Higher workers = faster I/O | `checkpoint-a-wiring.e2e.test.ts` | httpbin 5 endpoints |
| Deterministic ordering across worker counts | `checkpoint-a-wiring.e2e.test.ts` | same |
| `--shard=N/M` covers full plan | `checkpoint-a-wiring.e2e.test.ts` | same |
| Per-endpoint timeout fires | `checkpoint-a-wiring.e2e.test.ts` | `tests/httpbin/delay-sla.endpoint.json` w/ tight timeout |
| Crash isolation | `checkpoint-d-auth.e2e.test.ts` | one endpoint hits invalid DNS |
| Partial JSONL on SIGKILL | `checkpoint-a-wiring.e2e.test.ts` | spawned subprocess interrupted |
| Retries on transient failures | `checkpoint-a-wiring.e2e.test.ts` | httpbin `/status/503` |
| `--retries=N` CLI override | same | same |

### §6 Auth strategies

| Claim | Endpoint file | Test file | Target |
| --- | --- | --- | --- |
| `static_token` (Bearer header) | `tests/github-pat/user-me.endpoint.json` | `checkpoint-d-auth.e2e.test.ts` | GitHub PAT |
| `static_token` (X-API-Key header) | `tests/openweather/forecast-by-city.endpoint.json` | `checkpoint-e-validation.e2e.test.ts` | OpenWeather |
| API key in query param | `tests/openweather/forecast-by-coords.endpoint.json` | same | OpenWeather |
| `token_endpoint` (OAuth-style) | `tests/stripe/oauth-flow.endpoint.json` | `checkpoint-e-validation.e2e.test.ts` | Stripe (test-mode OAuth) |
| Anonymous (no auth) | `tests/pokeapi/pokemon-by-name.endpoint.json` | `checkpoint-b-catalog-coverage.e2e.test.ts` | PokeAPI |

### §8 Templating

| Claim | Endpoint file | Test file |
| --- | --- | --- |
| `${env.base_url}` resolves | every endpoint | every test |
| `${secret.*}` resolves + redacts | `tests/github-pat/user-me.endpoint.json` | `checkpoint-d-auth.e2e.test.ts` |
| `${request.body.*}` in URL | `tests/jsonplaceholder/post-create.endpoint.json` | `checkpoint-b-catalog-coverage.e2e.test.ts` |
| `${response.body.*}` chained | `tests/github-pat/issue-create-then-comment.endpoint.json` | `checkpoint-d-auth.e2e.test.ts` |
| `${db.<conn>.<qid>.*}` chained | `tests/apicurio/schema-create.endpoint.json` | `checkpoint-g-databases.e2e.test.ts` |

### §5 Database connectors

| Claim | Endpoint file | Test file | Backend |
| --- | --- | --- | --- |
| Postgres `db_verify` | `tests/apicurio/schema-create.endpoint.json` | `checkpoint-g-databases.e2e.test.ts` | Apicurio + Postgres (docker) |
| MySQL `db_verify` | `tests/mlflow/run-create.endpoint.json` | `checkpoint-g-databases.e2e.test.ts` | MLflow + MySQL (docker) |
| MongoDB `db_verify` | `tests/mongo/document-insert.endpoint.json` | `checkpoint-f-hosted-dbs.e2e.test.ts` | MongoDB Atlas |
| Neo4j `db_verify` | `tests/neo4j/node-create.endpoint.json` | `checkpoint-f-hosted-dbs.e2e.test.ts` | Neo4j AuraDB |
| `expect: "exists"` | every db_verify endpoint | corresponding test |
| `expect: "match"` w/ `fields` | `tests/apicurio/schema-create.endpoint.json` | same |
| `expect: "none"` | `tests/apicurio/schema-delete-verify-gone.endpoint.json` | same |
| `cleanup` on pass | `tests/apicurio/schema-create.endpoint.json` | same |
| `cleanup` on fail | `tests/apicurio/schema-create-bad-payload.endpoint.json` (forced fail) | same |

### §10 Reporting

| Claim | Test file | Notes |
| --- | --- | --- |
| HTML report renders | `checkpoint-a-wiring.e2e.test.ts` | DOM has run summary |
| JSON sidecar valid | `checkpoint-a-wiring.e2e.test.ts` | parses + has shape |
| JUnit XML valid | `checkpoint-a-wiring.e2e.test.ts` | xmllint passes |
| Console `--log=error/warn/info/debug` | `checkpoint-a-wiring.e2e.test.ts` | different output sizes |
| Console redaction (Fix #1) | `checkpoint-d-auth.e2e.test.ts` | PAT replaced with `[REDACTED]` |
| Flaky reported as `passed` + note | `checkpoint-a-wiring.e2e.test.ts` | httpbin `/status/503,200` |

### §11 + Fix #3 Markdown docs generator

| Claim | Test file |
| --- | --- |
| One MD per endpoint | `checkpoint-i-docs-generator.e2e.test.ts` |
| Sections present | same |
| Deterministic byte-identical | same |
| Bounded depth | same |

### §1 Importers

| Claim | Fixture | Test file |
| --- | --- | --- |
| Postman v2.1 import | `fixtures/sample.postman_collection.json` | `checkpoint-h-importers.e2e.test.ts` |
| OpenAPI import | `fixtures/sample.openapi.yaml` | same |
| Imported endpoints validate | — | same |

### §12 CLI surface

| Claim | Test file |
| --- | --- |
| `apiwright --help` | `checkpoint-a-wiring.e2e.test.ts` |
| `apiwright validate ./tests` happy path | same |
| `apiwright validate ./tests` with bad file | same |
| `apiwright run` exit codes | same |

### §13 + Fix #5 Docker packaging

| Claim | Test file |
| --- | --- |
| Image builds + runs | `checkpoint-j-docker-image.e2e.test.ts` |
| Image < 200MB | same |
| Mounts work | same |
| Env-var passthrough | same |

### §14 + Fix #4 CI examples

Already covered by `tests/integration/examples/ci-examples-validation.test.ts`
(static YAML validation — no runtime). Not duplicated here.

## What this matrix does NOT cover (and where it's covered instead)

- Algorithm correctness of individual modules — handled by `tests/unit/`.
- Module-level wiring with fakes — handled by `tests/integration/`.
- Pre-commit gate behaviour — handled by `tests/e2e/auth.e2e.test.ts` and `tests/e2e/db-drivers.e2e.test.ts` (pre-existing, against Docker DBs).

## Suite execution

Once the data + test files are committed:

```bash
# Run the full E2E regression
npm run test:e2e

# Run a single checkpoint
npm run test:e2e -- tests/e2e/checkpoint-a-wiring.e2e.test.ts

# Run with credentials set (full coverage)
APIWRIGHT_E2E_GH_PAT=ghp_… \
APIWRIGHT_E2E_STRIPE_KEY=sk_test_… \
APIWRIGHT_E2E_OWM_KEY=… \
APIWRIGHT_E2E_MONGO_URI=mongodb+srv://… \
APIWRIGHT_E2E_NEO4J_URI=neo4j+s://… \
APIWRIGHT_E2E_NEO4J_USER=neo4j \
APIWRIGHT_E2E_NEO4J_PASSWORD=… \
APIWRIGHT_E2E_MYSQL_URI=mysql://… \
  npm run test:e2e
```

Tests self-skip with a clear message when their required credential is
absent — a no-credential run still proves the no-auth checkpoints work.
