# In-House E2E Validation Sandbox

A user-shaped sandbox that exercises the APIWright CLI against **real
public APIs** — no mocks. The directory is laid out exactly the way a
real customer's test repo would be (the `tests/` + `environments/` +
`apiwright.config.json` triplet documented in `examples/README.md`).

The sibling `tests/e2e/checkpoint-*.e2e.test.ts` files spawn the
APIWright CLI as a subprocess against this sandbox and assert on the
artifacts the CLI writes to `reports/`. This is the only place in the
repo that tests the **public CLI surface** end-to-end through a
subprocess. Everything else under `tests/integration/` instantiates
`runOnce(config)` directly.

## Layout

```
in-house-validation/
├── apiwright.config.json         # tests_dir + environments_dir + reports_dir
├── environments/
│   └── httpbin.yaml              # Checkpoint A — public httpbin.org target
├── tests/
│   └── httpbin/
│       ├── get-basic.endpoint.json
│       ├── post-body-echo.endpoint.json
│       ├── status-conformance.endpoint.json
│       ├── delay-sla.endpoint.json
│       └── headers-echo.endpoint.json
├── reports/                      # generated; gitignored
└── README.md
```

## Running by hand

```bash
# From repo root, build the framework first:
npm run build

# Validate the sandbox files parse cleanly:
node dist/cli/entry.js validate ./tests/e2e/in-house-validation/tests

# Run smoke from inside the sandbox directory:
cd tests/e2e/in-house-validation
node ../../../dist/cli/entry.js run --env=httpbin --markers=smoke

# Inspect the HTML report:
open reports/run-*.html
```

## Why httpbin.org for Checkpoint A?

- No auth, no rate limit, no signup — Checkpoint A has zero credential
  setup, so it runs in any CI without secret management.
- Every HTTP status code, method, auth mode, delay is hittable on
  demand via deterministic paths (`/status/{code}`, `/delay/{n}`).
- Response shapes are stable — schema-validation tests don't break
  when their public API quietly adds a field.

Subsequent checkpoints layer on additional real targets (GitHub API,
PokeAPI, JSONPlaceholder, Stripe test mode, MongoDB Atlas, Neo4j AuraDB,
PlanetScale, Apicurio, MLflow). Each target is added in its own PR
alongside the test file that exercises it.

## Credentials roadmap

| Target | Credential | Env var | Used by checkpoint |
| --- | --- | --- | --- |
| httpbin.org | none | — | A |
| JSONPlaceholder | none | — | B |
| PokeAPI | none | — | B |
| GitHub REST | fine-grained PAT (one test repo) | `APIWRIGHT_E2E_GH_PAT` | C, D |
| Stripe test mode | secret key (`sk_test_…`) | `APIWRIGHT_E2E_STRIPE_KEY` | E |
| OpenWeatherMap | API key | `APIWRIGHT_E2E_OWM_KEY` | E |
| MongoDB Atlas | connection URI | `APIWRIGHT_E2E_MONGO_URI` | F |
| Neo4j AuraDB | URI + user + password | `APIWRIGHT_E2E_NEO4J_*` | F |
| PlanetScale MySQL | connection URI | `APIWRIGHT_E2E_MYSQL_URI` | F |

Local development reads these from `.env.e2e.yaml` (gitignored at the
repo root). CI reads them from GitHub Actions repo secrets.
