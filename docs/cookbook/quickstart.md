# Quickstart — start with a URL, get 16 free tests

The point of this recipe is to show you the **smallest possible thing
that works**, then iteratively add detail. By the end you'll have
APIWright running against the public httpbin.org API.

**No accounts, no secrets, no Docker compose, no database. No
prerequisite knowledge of the API's schema.**

You don't need to know the full response shape to start testing — that's
exactly the friction this recipe removes.

---

## The mental model: four phases

| Phase | What you write | What you get | Time |
|---|---|---|---|
| **1. Smoke** | 6 lines: id, method, url, `expected_status: 200`, empty schema | Confirms the endpoint is reachable + returns the right status. APIWright generates ~5 cases including idempotency (GET) and content-type validation. | 2 min |
| **2. Shape** | Add `response.schema` (paste-from-actual-response) | Catches "API returned 200 but the body shape changed" | +2 min |
| **3. Semantics** | Add one or more `assertions[]` | Catches "API returned the right shape but the value is wrong" | +2 min per assertion |
| **4. Regression** | Add `markers: ["smoke", "regression"]` + retry policy | Promotes the endpoint into your nightly battery | +1 min |

You can stop at any phase. **Even Phase 1 gives you real value** — APIWright won't fail-silently; it tells you exactly what's missing.

---

## What you need first

- **Node 22 LTS** OR **Docker**. Either works.
- A terminal.
- Internet (httpbin.org is the target).

If you want to skip ahead to the finished version, the ready-built
project is in [`examples/working-example/`](../../examples/working-example/) —
clone the repo, `cd` into it, and run. This recipe shows you how to
build it from scratch so you learn the moving parts.

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

See [installation.md](../installation.md) for the full install guide.

---

## Step 2 — Create the project layout

In an empty directory:

```bash
mkdir -p my-tests/tests my-tests/environments my-tests/reports
cd my-tests
```

Three folders:
- `tests/` — your endpoint declarations (one `.endpoint.json` per endpoint).
- `environments/` — one YAML per deployment target (dev / qa / prod).
- `reports/` — where APIWright writes the run output.

---

## Step 3 — Write the environment

Create `environments/httpbin.yaml`:

```yaml
name: httpbin
prod: false
base_url: https://httpbin.org
default_sla_ms: 10000
```

Four lines. No databases, no secrets, no auth. The `name:` field must
match what you pass to `--env` later.

---

## Step 4 — Write the minimum-viable endpoint (Phase 1)

This is the smallest legal endpoint file. Create `tests/get-basic.endpoint.json`:

```json
{
  "id":     "httpbin.get_basic",
  "name":   "GET /get — first APIWright endpoint",
  "method": "GET",
  "url":    "/get",
  "markers": ["smoke"],
  "request":  {},
  "response": { "expected_status": 200, "schema": {} }
}
```

**That's it. Eight lines of content.** No schema fields, no assertions,
no SLA budget, no body validators.

You don't need to know what `/get` returns to write this file. You
know:
- The method is GET.
- The URL is `/get`.
- A success is HTTP 200.

That's enough to start testing.

---

## Step 5 — Validate offline

```bash
apiwright validate ./tests
```

Expected:
```
INFO: PASS tests/get-basic.endpoint.json
INFO: Validated 1 endpoint file(s) and 0 environment file(s) — OK
```

This catches typos in the JSON before any network call.

---

## Step 6 — Run

```bash
apiwright run --env httpbin --markers smoke
```

Or via Docker (if you didn't install in step 1):

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  run --env httpbin --markers smoke
```

Expected:
```
WARN: Endpoint 'httpbin.get_basic': response.schema is empty or pending review;
      response_schema_validation skipped to avoid false-positive PASSes against
      any 2xx body. Tighten the schema in the endpoint file to enable validation.
INFO: PASS httpbin.get_basic
Run summary: planned=1 passed=1 failed=0 flaky=0 duration_ms=347
```

**That WARN line is the key thing.** APIWright tells you exactly what
you skipped and why. It refused to silently "pass" your schema check
against an empty schema (a 2026-05 audit bug fix — see PR #80) — it
makes you opt-in to that validation when you're ready.

With the empty schema, here's what APIWright still ran for you:

| Case | What it checked |
|---|---|
| `status_code_conformance` | Did the endpoint return 200? |
| `content_type_alignment` | Did the response carry the right `Content-Type` header? |
| `response_time_sla` | Did the response come back within 10000 ms? |
| `idempotency_get_two_request` | Two back-to-back GETs produced the same body? |
| `response_schema_validation` | **SKIPPED** with the WARN above. |

That's real coverage for ~8 lines of declaration. **You've already
got value before knowing anything about the response shape.**

---

## Step 7 — Open the HTML report

```bash
open reports/run-*.html        # macOS
xdg-open reports/run-*.html    # Linux
start reports/run-*.html       # Windows
```

You'll see:
- A summary banner (1 passed, 1 warning).
- An accordion for `httpbin.get_basic`.
- **The actual response body**, captured verbatim:
  ```json
  {
    "args": {},
    "headers": {
      "Accept": "*/*",
      "Host": "httpbin.org",
      "User-Agent": "node",
      "X-Amzn-Trace-Id": "Root=1-..."
    },
    "origin": "1.2.3.4",
    "url": "https://httpbin.org/get"
  }
  ```

**This is where Phase 2 begins.** You now know the response shape
because the report told you. You didn't have to read the docs or
guess.

---

## Step 8 — Phase 2: add the schema

Open `tests/get-basic.endpoint.json` and replace the empty schema with
what you actually saw:

```json
"response": {
  "expected_status": 200,
  "schema": {
    "type": "object",
    "required": ["url", "headers", "origin"],
    "properties": {
      "url":     { "type": "string", "format": "uri" },
      "headers": { "type": "object" },
      "origin":  { "type": "string" }
    }
  }
}
```

Re-run:
```bash
apiwright run --env httpbin --markers smoke
```

Now the WARN is gone. The `response_schema_validation` case actually
runs and passes — you've locked in the shape contract.

---

## Step 9 — Phase 3: add a real assertion

Add to your endpoint file:

```json
"assertions": [
  "response.body.url contains \"httpbin.org\""
]
```

Re-run. The report now shows your assertion in addition to the
auto-generated cases. **One assertion = one extra case.** Add the
assertions you care about, in the order you think of them. There's no
"complete set" you need to hit.

---

## Step 10 — Phase 4: promote to regression

Change the markers line:

```json
"markers": ["smoke", "regression"]
```

Re-run with both markers:

```bash
apiwright run --env httpbin --markers smoke,regression
```

This adds the regression battery — body negatives, auth negatives,
boundary battery (if you'd added body schemas), method-not-allowed
checks. Per-endpoint test count typically jumps from ~5 to ~10-16.

---

## What just happened

| What you wrote | What you got |
|---|---|
| 8-line minimal stub | 4 auto-generated test cases + 1 honest SKIPPED-with-WARN |
| 14-line stub + schema | 5 auto-generated test cases (the schema check joined the party) |
| 15-line stub + schema + 1 assertion | 6 cases |
| Same + `regression` marker | 10-16 cases (depending on declared shape) |

You went from "I have a URL" to "10+ tests running" in about ten minutes,
**without ever needing to know the full API spec up front**. The tool
shows you what it sees, and you tighten the checks at your own pace.

---

## A common worry: "but what if the API changes shape?"

That's exactly what Phase 2's schema check protects against. The
moment the API adds, removes, or retypes a field that you've declared
in `required` or `properties`, the `response_schema_validation` case
goes red and your CI fails. You don't have to hand-write that check —
the schema is the check.

If you forgot to add the schema (left it `{}`), APIWright doesn't
silently pretend everything's fine. It WARNs on every run, in every
report, until you tighten it. That noise is the feature.

---

## Where to go next

- **[Testing a CRUD REST API](./crud-api.md)** — full POST/GET/PATCH/DELETE coverage with body schemas and cross-request assertions.
- **[Testing an authenticated API](./authenticated-api.md)** — add bearer tokens, see auth-boundary cases auto-generate.
- **[Verifying DB side effects](./db-side-effects.md)** — when your endpoints write to a database.
- **[Setting up CI](./setting-up-ci.md)** — wire this same project into GitHub Actions / Jenkins / GitLab / Azure.

If you already have a Postman collection or OpenAPI spec, **skip the
minimal-stub path entirely**:

- **[Migrating from Postman](./migrating-from-postman.md)** — `apiwright import postman <file>` auto-generates the stubs for every request.
- **[Migrating from OpenAPI](./migrating-from-openapi.md)** — `apiwright import openapi <file>` does the same from a spec.

Reference:

- **[concepts.md](../concepts.md)** — the 6-term mental model.
- **[test-catalog.md](../test-catalog.md)** — every case type APIWright knows how to generate.
- **[assertions.md](../assertions.md)** — all 20 assertion operators with examples.
- **[compatibility.md](../compatibility.md)** — the SemVer policy: what's stable across v1.x.
