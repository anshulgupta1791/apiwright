# Markers and pipeline lifecycle

Markers are how APIWright slices the catalog into subsets for
different CI stages. Three markers, one shorthand, one rule.

---

## The three markers

| Marker | What it covers | Designed for |
|---|---|---|
| `smoke` | Happy-path commodity: status_code_conformance, content_type_alignment, response_schema_validation, response_time_sla, auth_happy_path, plus every declared `assertion` | Every PR — fast feedback |
| `regression` | Negative + boundary + idempotency + db-state cases: no_auth_returns_401, garbage_token_returns_401, method_not_allowed, malformed_json_returns_400, required_field_omission_returns_400, type_violation_returns_400, boundary_battery, get_idempotency, delete_idempotency, db_state_matches_expectation | Pre-deploy / nightly — thorough |
| `e2e` | Reserved for multi-step flows | v1.5+ (no cases generated today) |

The marker on each generated case is assigned by the catalog generator
— you don't (and can't) override it per case. The endpoint's
`markers` field controls whether the endpoint participates in a given
marker selection.

---

## The shorthand: `all`

`--markers all` is shorthand for "every marker the catalog supports"
(today: smoke + regression; tomorrow: + e2e). Use on demand for full
sweeps; don't use as a default in CI because the run is long.

```bash
apiwright run --env qa --markers all
```

---

## The rule

A generated case runs iff:

1. Its `case.marker` is in the `--markers` selection, AND
2. The endpoint's `endpoint.markers` array includes any marker in the
   `--markers` selection (so the endpoint participates in the
   subset), AND
3. All CLI filters (`--tag`, `--exclude-tag`, `--endpoint`, `--path`)
   pass.

In practice: declare your endpoints with `markers: ["smoke"]`
(the default) and most things work. Use `markers:
["regression"]` only for endpoints you genuinely want to exclude from
the smoke pass.

---

## The endpoint's `markers` field

```json
{
  "id": "users.create",
  "markers": ["smoke"],
  ...
}
```

| Endpoint `markers` value | Runs under `--markers smoke`? | Runs under `--markers regression`? | Runs under `--markers all`? |
|---|---|---|---|
| `["smoke"]` | ✅ | ✅ (cases marked smoke run as part of regression — see below) | ✅ |
| `["regression"]` | ❌ | ✅ | ✅ |
| `["smoke", "regression"]` | ✅ | ✅ | ✅ |
| `[]` or absent | (defaults to `["smoke"]`) | — | — |

**Practical rule:** put every endpoint in smoke. Almost no endpoint
needs to be smoke-excluded. The regression-only case is for endpoints
that are too slow / too destructive / too rate-limited for fast PR
feedback.

---

## The recommended pipeline

```
┌──────────────────┐    PR open / push to a feature branch
│   PR checks      │    → apiwright run --env qa --markers smoke
│   (fast, ~5min)  │       (only smoke-classified cases on smoke-included endpoints)
└──────────────────┘

┌──────────────────┐    Merge to main / release branch
│  Pre-deploy QA   │    → apiwright run --env staging --markers smoke,regression
│  (thorough,      │       (full catalog except multi-step flows)
│   ~15-30min)     │
└──────────────────┘

┌──────────────────┐    Cron / nightly
│  Nightly         │    → apiwright run --env qa --markers all
│  (everything,    │       + an alert if anything new flakes
│   long)          │
└──────────────────┘

┌──────────────────┐    Manual triggered
│  On-demand       │    → apiwright run --env <any> --endpoint <id>
│  debug           │       --markers all --log debug
└──────────────────┘
```

---

## Worked example — what each stage runs

For a sample 50-endpoint suite where 45 endpoints are
`markers: ["smoke"]` (the default) and 5 are `markers: ["regression"]`
(destructive write endpoints we don't want in PR checks):

| Stage | Markers | Endpoints in scope | Cases generated |
|---|---|---|---|
| PR check | smoke | 45 | ~225 (5 commodity cases each: status, schema, content-type, sla, auth_happy) |
| Pre-deploy | smoke,regression | 50 | ~600 (45 × ~5 smoke + 45 × ~6 regression + 5 × ~12 regression) |
| Nightly | all | 50 | ~600 (same as pre-deploy today; e2e cases v1.5+) |

PR check completes in ~2 min; pre-deploy in ~8 min; nightly the same.

---

## What's at each marker — the catalog breakdown

Cross-referencing [test-catalog.md](./test-catalog.md):

### smoke (universal correctness + auth-happy + assertions)

- `status_code_conformance` — always
- `content_type_alignment` — always
- `response_schema_validation` — if `response.schema` declared
- `response_time_sla` — always
- `auth_happy_path` — if `auth_strategy` declared
- `assertion` — one per `assertions[]` entry

For a typical endpoint with auth + 3 assertions: 5 + 3 = ~8 smoke cases.

### regression (negatives + boundaries + db)

- `no_auth_returns_401` — if `auth_strategy` declared
- `garbage_token_returns_401` — if `auth_strategy` declared
- `method_not_allowed` — always
- `malformed_json_returns_400` — if `body_example` present
- `required_field_omission_returns_400` — one per required field
- `type_violation_returns_400` — one per typed field
- `boundary_battery` — per constraint (numeric / string-length /
  enum)
- `get_idempotency` — if method is GET
- `delete_idempotency` — if method is DELETE
- `db_state_matches_expectation` — if `db_verify` + write method

For a typical POST with 5 required, 6 typed, 3 boundary constraints,
1 db_verify: 2 auth + 1 method + 1 malformed + 5 required + 6 typed +
8 boundary + 1 db = ~24 regression cases.

### e2e

Reserved for v1.5+ multi-step flows. No cases generated in v1.0.

---

## Common mistakes

### Putting all endpoints under `regression` to skip PR checks

```json
"markers": ["regression"]   // ❌ all 50 endpoints
```

Result: PRs don't catch any regressions until the nightly. By then
the merge that broke things has been on main for ~12 h.

**Fix:** keep all endpoints in `smoke` (default). For genuinely-slow
or destructive ones, also tag with `--exclude-tag <name>` in PR CI:

```yaml
- run: apiwright run --env qa --markers smoke --exclude-tag destructive
```

### Using `--markers all` in PR CI

```yaml
- run: apiwright run --env qa --markers all   # ❌ slow on every PR
```

Result: PR feedback loop is 15-30 min instead of 2-5 min. Devs
context-switch away while CI runs; PR throughput drops.

**Fix:** smoke for PR, smoke+regression for pre-deploy / nightly.

### Forgetting the `--markers` flag entirely

```yaml
- run: apiwright run --env qa   # picks up default_markers from config
```

Works fine if `apiwright.config.json` sets `default_markers:
["smoke"]`. If the config sets `["all"]` you've silently signed up for
every-stage-runs-everything. Explicit is better.

---

## Bypassing the marker filter

`apiwright run --endpoint <id>` runs every case for that one endpoint
regardless of markers. Useful for debugging — the single endpoint's
full catalog runs, you see exactly what generates and what fails.

`--tag <tag>` filters the endpoint set but still respects the
marker selection. `--tag` is for "which endpoints"; `--markers` is
for "which cases per endpoint."

---

## Production environments — extra gating

When the environment YAML has `prod: true`, APIWright applies extra
gates beyond markers:

- Destructive (write/delete) cases are skipped by default — even if
  they're in the marker selection.
- Override with `--allow-non-smoke-in-prod` for the rare case where
  you want regression-against-prod-readonly (with the destructive
  cases still skipped because the endpoints would be `prod_safe: false`).

The intent: a misconfigured prod run can't accidentally
delete user data. See [environment-config.md](./environment-config.md)
for the `prod_safe` declaration field.

---

## See also

- [test-catalog.md](./test-catalog.md) — which catalog generator
  produces which case marker.
- [ci-cd.md](./ci-cd.md) — concrete pipeline YAML per platform.
- [cli.md](./cli.md) — every flag including `--markers` and
  `--allow-non-smoke-in-prod`.
- [best-practices.md](./best-practices.md) — marker discipline at the
  declaration level.
