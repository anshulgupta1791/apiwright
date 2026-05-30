# Working example — APIWright against httpbin.org

A complete, runnable APIWright mini-project. **No setup, no secrets,
no Docker required** — point it at the public httpbin.org and you
have a working suite in under a minute.

Use it as a starting template, a sanity-test for a fresh install, or a
reference layout to mimic in your own project.

---

## Run it

From this directory, with APIWright installed:

```bash
apiwright run --config ./apiwright.config.json --env httpbin --markers smoke
```

Or against the public Docker image:

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  -v "$PWD/apiwright.config.json:/app/apiwright.config.json:ro" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  run --config /app/apiwright.config.json --env httpbin --markers smoke
```

Expected output:

```
Run summary: planned=5 passed=5 failed=0 flaky=0 duration_ms=...
```

Plus three report files at `./reports/run-<ts>.{json,html,xml}`.

Open the HTML report in a browser to inspect what ran.

---

## What's in here

```
working-example/
├── README.md                            ← this file
├── apiwright.config.json                ← run-level configuration
├── environments/
│   └── httpbin.yaml                     ← env pointing at https://httpbin.org
└── tests/
    ├── get-basic.endpoint.json          ← simplest case: GET /get
    ├── status-conformance.endpoint.json ← GET /status/200 — status check
    ├── headers-echo.endpoint.json       ← GET /headers — assertions on headers
    ├── post-body-echo.endpoint.json     ← POST /post — body schema + boundary tests
    └── delay-sla.endpoint.json          ← GET /delay/0 — SLA conformance
```

Five declarations expanding to roughly 30 generated test cases (smoke
+ regression).

---

## What this demonstrates

### Concept layering (read in order)

1. **`environments/httpbin.yaml`** — the simplest possible env: name,
   `prod: false`, base URL, default SLA. No secrets, no databases, no
   auth strategies.
2. **`apiwright.config.json`** — the simplest useful config:
   tests_dir + environments_dir + reports_dir + which env / markers
   to default to.
3. **`tests/get-basic.endpoint.json`** — the simplest declaration:
   one GET, response with expected_status and a schema. Generates ~5
   smoke cases.
4. **`tests/status-conformance.endpoint.json`** — declaring a
   non-200 expected_status (200 explicitly here, but pattern-wise
   you'd write `404` for a /status/404 endpoint).
5. **`tests/headers-echo.endpoint.json`** — using `assertions[]` to
   verify a header round-trip (the API echoes what you sent).
6. **`tests/post-body-echo.endpoint.json`** — the catalog's big
   leverage: one declaration with `body_schema` (required + typed +
   boundary-constrained) auto-expands to ~15 regression cases for
   free.
7. **`tests/delay-sla.endpoint.json`** — declaring `sla_ms` so the
   `response_time_sla` case has something to assert.

### What you'd add for a real project

Compared to a real codebase, this example is missing:

- **Auth** — see [docs/environment-config.md](../../docs/environment-config.md)
  for the `auth_strategies` block.
- **DB verification** — see [docs/db-verify.md](../../docs/db-verify.md)
  for the `db_verify` block and `databases` env block.
- **Secrets** — this example has none; real projects use `${secret.*}`
  references that resolve from `process.env` and redact in reports.
- **Tags + markers strategy** — every endpoint here is in the default
  marker; real projects split smoke/regression and use tags for
  service-level filtering. See [docs/markers-and-lifecycle.md](../../docs/markers-and-lifecycle.md).
- **CI workflow** — see [examples/ci/](../ci/) for ready-to-paste
  workflows.

---

## Mutating this example

Copy the whole `working-example/` directory into your own project as
a starting point:

```bash
cp -r examples/working-example my-api-tests/
cd my-api-tests
```

Then:

1. Edit `environments/httpbin.yaml` → rename to your env, change
   `base_url`, add `databases` + `auth_strategies` as needed.
2. Edit `apiwright.config.json` → change `default_env` to your env
   name.
3. Replace the example endpoint declarations with your own (or run
   `apiwright import openapi <your-spec.yaml>` / `apiwright import
   postman <your-collection.json>` to bootstrap from an existing
   spec).

See [docs/installation.md](../../docs/installation.md) for install
options if you don't have APIWright yet, and [docs/concepts.md](../../docs/concepts.md)
for the full mental model.
