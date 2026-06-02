# Markdown docs generator (`apiwright docs generate`)

`apiwright docs generate` reads your endpoint declarations and emits
one Markdown file per endpoint — a continuously-fresh API reference
for your team, generated from the same source-of-truth your tests
already use.

Run it in CI on every merge; commit the output to a docs site or
publish via GitHub Pages.

---

## Quick start

```bash
apiwright docs generate --source ./tests --output ./docs/api
```

What you get (for a `tests/` with 12 endpoint files):

```
docs/api/
  users-create.md
  users-list.md
  users-get.md
  users-update.md
  users-delete.md
  orders-create.md
  ...
```

One `.md` per declaration. Each carries the spec for the endpoint —
request, response, schema, auth, db effects, declared assertions,
which auto-generated cases run, markers.

---

## What each generated MD looks like

For an endpoint like:

```json
{
  "id": "users.create",
  "name": "POST /users — create a new user",
  "method": "POST",
  "url": "/api/v1/users",
  "tags": ["users", "write"],
  "markers": ["regression"],
  "auth_strategy": "bearer",
  "request": {
    "body_schema": { ... },
    "body_example": { ... }
  },
  "response": {
    "expected_status": 201,
    "schema": { ... }
  },
  "db_verify": [ ... ],
  "assertions": [ ... ]
}
```

The generated MD has these sections (each generator owns a section
in `src/docs/sections/`):

```markdown
# POST /users — create a new user

**Endpoint id:** `users.create`
**Method:** `POST`
**URL:** `/api/v1/users`
**Tags:** `users`, `write`

## Authentication

Uses the `bearer` strategy from the environment config (static token
in the `Authorization` header).

## Request

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `email` | string | ✅ | format: email |
| `name` | string | ✅ | minLength: 1, maxLength: 200 |

**Example body:**

```json
{ "email": "qa@example.com", "name": "QA Bot" }
```

## Response

**Expected status:** `201`
**SLA:** 500 ms

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | ✅ | pattern: ^[a-f0-9-]{36}$ |
| `email` | string | ✅ | format: email |

## Database side effects

Connection: `primary_postgres`
Query: `SELECT email FROM users WHERE email = '${request.body.email}'`
Expect: `match` against `{ email: ${request.body.email} }`

## Markers

`regression`

## Test coverage

Auto-generated cases for this endpoint:

- `status_code_conformance` (smoke)
- `content_type_alignment` (smoke)
- `response_schema_validation` (smoke)
- `response_time_sla` (smoke)
- `auth_happy_path` (smoke)
- `no_auth_returns_401` (regression)
- `garbage_token_returns_401` (regression)
- `method_not_allowed` (regression)
- `malformed_json_returns_400` (regression)
- `required_field_omission_returns_400` × 2 (one per required field, regression)
- `type_violation_returns_400` × 2 (one per typed field, regression)
- `boundary_battery` × 4 (minLength / maxLength on `name`, regression)
- `db_state_matches_expectation` (regression)

Plus declared assertions:

- `response.body.id is_uuid_v4`
- `response.body.email equals request.body.email`
```

The exact section order, headings, and table format are deterministic
— two runs against the same input produce **byte-identical** output.
This means you can commit the output and `git diff` will show only
what changed.

---

## Why generate docs from declarations

The same problem that makes APIWright work for testing makes it work
for docs: **the declaration IS the contract**. If you write API docs
as a separate artifact, they drift the first time someone changes the
API. If you generate them from the same declarations the tests use,
they can't.

Concretely:

- **No drift.** When a developer updates the declaration to match a
  schema change, the docs update automatically on the next CI run.
- **Always-fresh test-coverage section.** Readers see exactly which
  cases run, classified by marker — not a stale "coverage" note.
- **Single source of truth.** Spec + tests + docs all point at the
  same `.endpoint.json`.

---

## Where to publish the output

A few common patterns:

### Commit to repo + GitHub Pages

```yaml
# .github/workflows/docs.yml
on:
  push:
    branches: [main]

jobs:
  docs:
    steps:
      - uses: actions/checkout@v4
      - run: apiwright docs generate --source ./tests --output ./docs/api
      - run: |
          git config user.email actions@github.com
          git config user.name "Docs Bot"
          git add docs/api
          git diff --cached --quiet || git commit -m "docs(api): regenerate from declarations"
          git push
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/
      - uses: actions/deploy-pages@v4
```

### Serve via static-site generator (mkdocs / docusaurus / vitepress)

Generate into the site's content directory:

```yaml
- run: apiwright docs generate --source ./tests --output ./website/docs/api
- run: cd website && npm install && npm run build
- run: aws s3 sync website/build s3://my-docs-bucket/
```

### Render in your existing docs portal

If you have a docs portal (Confluence, Notion, Backstage, ReadMe.io,
etc.) that ingests Markdown, generate locally + upload via that
portal's API.

---

## CLI reference

```
apiwright docs generate [options]

Options:
  --source <dir>   Directory of *.endpoint.json files to read (default: ./tests)
  --output <dir>   Directory to write generated *.md files (required)
  --help           Show this help
```

The output directory is created if it doesn't exist. Existing files
in the output directory are **overwritten**; files for endpoints that
no longer exist in the source are **not deleted** (run a clean of
the output directory before each regeneration if that matters).

---

## Determinism

Two runs against the same `--source` produce byte-identical output.
Properties enforced:

- Sorted alphabetically by output filename.
- Sorted alphabetically within each MD: tags, markers, declared
  assertions, schema fields per section, generated case list.
- No timestamps, hostnames, or process-IDs leak into the rendered
  Markdown.
- Whitespace is normalised; trailing blank lines are stripped.

This is verified end-to-end by external meta-tests that compare two
back-to-back runs byte-for-byte.

---

## Customising the output

v1.0 of the docs generator doesn't support templates / custom section
ordering / theming — the format is fixed. Customisation is a v1.5+
roadmap item.

If you need a different shape, you can:

1. Generate to `./docs/api` (fixed shape).
2. Post-process with a small script that reads the generated MD and
   re-formats into whatever shape you need.

The structured JSON declaration is also available — you can write a
custom Markdown generator that reads the same `.endpoint.json` files
APIWright reads, if you don't want a post-processing step. The
canonical model is documented in
[canonical-model.md](./canonical-model.md).

---

## What's in vs. what's out of generated docs

| In | Out |
|---|---|
| Endpoint id, name, method, URL | Implementation notes about the endpoint |
| Tags, markers | Free-text descriptions outside the declaration |
| Request: headers, body_schema (as a table), body_example | Code examples in languages other than JSON |
| Response: expected_status, sla_ms, schema | Response examples for non-success statuses |
| Auth strategy reference (read from env YAML at doc-gen time) | Auth strategy implementation details |
| `db_verify` block (connection, query, expect, fields) | Database schema beyond what's queried |
| Declared `assertions` | Notes about why each assertion exists |
| Generated case list grouped by marker | The actual catalog implementation |

The generator IS a thin renderer over the declaration — it adds
nothing the declaration doesn't carry. If you want richer docs,
enrich the declaration (the spec carries `tags`, `name`, multiple
example bodies, etc.).

---

## See also

- [canonical-model.md](./canonical-model.md) — the full declaration
  schema (what the generator reads).
- [cli.md](./cli.md) — the `docs` subcommand reference.
- [test-catalog.md](./test-catalog.md) — what the "test coverage"
  section enumerates.
- An external meta-test harness verifies the
  one-MD-per-endpoint, all-sections-present, byte-identical contract.
