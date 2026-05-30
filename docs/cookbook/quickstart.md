# Quickstart — your first endpoint in 5 minutes

By the end of this recipe you'll have APIWright running against the
public httpbin.org API, with one endpoint declaration generating
roughly 5 test cases and writing three report files.

**No accounts, no secrets, no Docker compose, no database.**

---

## What you need first

- **Node 22 LTS** OR **Docker**. Either works.
- A terminal.
- Internet (httpbin.org is the target).

If you want a faster path, the ready-built version of this exact
project is in [`examples/working-example/`](../../examples/working-example/) —
you can clone the repo, `cd` into it, and run. This recipe shows you
how to **build** the same thing from scratch, so you learn the
moving parts.

---

## Step 1 — Install APIWright

Pick one. The CLI is identical across all three.

### Docker (fastest, no Node install)

No install — you run it through `docker run`. Skip to step 2.

### npm

```bash
npm install -g apiwright
apiwright --version
# 1.0.0
```

### From source

```bash
git clone https://github.com/anshulgupta1791/apiwright.git
cd apiwright
npm install && npm run build
npm link
apiwright --version
```

See [installation.md](../installation.md) for the full install guide
including troubleshooting.

---

## Step 2 — Create the project layout

In an empty directory:

```bash
mkdir -p my-tests/tests my-tests/environments my-tests/reports
cd my-tests
```

Three folders:

- `tests/` — your endpoint declarations (one `.endpoint.json` per
  endpoint).
- `environments/` — one YAML per deployment target (dev / qa / prod
  etc.).
- `reports/` — where APIWright writes the run output. Must be
  writable.

---

## Step 3 — Write one environment

Create `environments/httpbin.yaml`:

```yaml
name: httpbin
prod: false
base_url: https://httpbin.org
default_sla_ms: 10000
```

That's it. Four lines. No databases, no secrets, no auth. The
`name:` field must match what you pass to `--env` later.

---

## Step 4 — Write one endpoint declaration

Create `tests/get-basic.endpoint.json`:

```json
{
  "id": "httpbin.get_basic",
  "name": "GET /get — first APIWright endpoint",
  "method": "GET",
  "url": "/get",
  "markers": ["smoke"],
  "request": {},
  "response": {
    "expected_status": 200,
    "schema": {
      "type": "object",
      "required": ["url", "headers"],
      "properties": {
        "url": { "type": "string" },
        "headers": { "type": "object" }
      }
    }
  },
  "assertions": [
    "response.body.url contains \"httpbin.org\""
  ]
}
```

What each field means:

- `id` — globally unique slug for this endpoint. The runner uses it
  to identify the endpoint in reports and to filter via
  `--endpoint <id>`.
- `name` — human description for the report.
- `method` + `url` — what HTTP request to make. The URL is relative;
  the environment's `base_url` is prepended.
- `markers` — which "stage" this endpoint belongs in (smoke runs on
  every PR; regression runs nightly). See
  [markers-and-lifecycle.md](../markers-and-lifecycle.md).
- `request.headers` — optional outgoing request headers. Empty here.
- `response.expected_status` — what status the runner expects.
- `response.schema` — JSON Schema the response body must satisfy.
- `assertions` — one or more business-logic checks. Here we assert
  that the echoed URL contains `httpbin.org`.

---

## Step 5 — Write one config file

Create `apiwright.config.json` at the project root:

```json
{
  "tests_dir": "./tests",
  "environments_dir": "./environments",
  "reports_dir": "./reports",
  "default_env": "httpbin",
  "default_markers": ["smoke"],
  "report": {
    "html": true,
    "json": true,
    "junit_xml": true,
    "output_dir": "./reports"
  }
}
```

This tells APIWright where to find everything and what to default to
when CLI flags are omitted.

---

## Step 6 — Validate

```bash
apiwright validate ./tests
```

Expected output:

```
✓ 1 endpoint validated.
```

If you get a `schema validation failed` error, double-check the
JSON in your endpoint file. APIWright's meta-schema catches typos
before any network call is made.

---

## Step 7 — Run

```bash
apiwright run --env httpbin --markers smoke
```

Or via Docker (if you didn't install in step 1):

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  -v "$PWD/apiwright.config.json:/app/apiwright.config.json:ro" \
  ghcr.io/anshulgupta1791/apiwright:latest \
  run --env httpbin --markers smoke
```

Expected output:

```
INFO: httpbin.get_basic attempt 1: pass
INFO: httpbin.get_basic attempt 1: pass
INFO: httpbin.get_basic attempt 1: pass
INFO: httpbin.get_basic attempt 1: pass
INFO: httpbin.get_basic attempt 1: pass
INFO: Run summary: planned=1 passed=1 failed=0 flaky=0 duration_ms=...
```

Five attempts because APIWright generated **5 smoke cases** from your
one declaration:

- `status_code_conformance` — does the endpoint return 200?
- `content_type_alignment` — is the body's `Content-Type` correct?
- `response_schema_validation` — does the body match the schema?
- `response_time_sla` — does the response come back within 10000 ms?
- `assertion` — does `response.body.url contains "httpbin.org"`?

---

## Step 8 — Inspect the report

```bash
ls reports/
# run-<timestamp>.json
# run-<timestamp>.html
# run-<timestamp>.xml
```

Open `reports/run-*.html` in a browser. You'll see:

- A green summary banner (1/1 passed).
- An accordion for `httpbin.get_basic`.
- Each generated case with its verdict, the request sent, the
  response received, the assertion result.

This is the same shape APIWright generates for every endpoint, every
run.

---

## What just happened

You declared one endpoint. APIWright auto-generated 5 cases from the
§3 catalog (the universal smoke set: status / content-type / schema /
sla / your assertion) and ran each against the real httpbin.org. The
report captures every request, every response, every check.

That's the leverage: **one ~25-line declaration → ~5 cases in smoke,
~10+ if you'd added body schema + auth + db_verify in regression**.

---

## Where to go next

- **[Testing a CRUD REST API](./crud-api.md)** — full POST/GET/PATCH/DELETE
  coverage with body schemas and cross-request assertions.
- **[Testing an authenticated API](./authenticated-api.md)** — add
  bearer tokens, see auth-boundary cases auto-generate.
- **[Verifying DB side effects](./db-side-effects.md)** — when your
  endpoints write to a database.
- **[Setting up CI](./setting-up-ci.md)** — wire this same project into
  GitHub Actions / Jenkins / GitLab / Azure.

Reference:

- **[concepts.md](../concepts.md)** — the 6-term mental model.
- **[test-catalog.md](../test-catalog.md)** — every case type
  APIWright knows how to generate.
- **[assertions.md](../assertions.md)** — all 20 assertion operators
  with examples.
