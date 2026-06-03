# Cookbook

End-to-end recipes for common APIWright scenarios. Each recipe walks
through a complete task from scratch — declaration, environment,
secrets, CI wiring, the lot.

For *reference* (one page per feature: every CLI flag, every assertion
operator, every config field), see the docs index at [../README.md](../README.md).
For *concepts* (the mental model), see [../concepts.md](../concepts.md).

---

## Pick a recipe

| Recipe | What you'll build | Time |
|---|---|---|
| **[Quickstart](./quickstart.md)** | From zero to first green run against httpbin.org | ~5 min |
| **[Testing a CRUD REST API](./crud-api.md)** | Full POST / GET / PATCH / DELETE coverage of a real API | ~30 min |
| **[Testing an authenticated API](./authenticated-api.md)** | static_token + token_endpoint flows, redaction verified | ~20 min |
| **[Verifying DB side effects](./db-side-effects.md)** | `db_verify` against a real Postgres after writes | ~30 min |
| **[Preparing to import](./preparing-to-import.md)** | Pre-import readiness checklist — what to assess on a Postman collection or OpenAPI spec BEFORE running `apiwright import` | ~30 min |
| **[Migrating from Postman](./migrating-from-postman.md)** | Import an existing collection + augment with schemas, assertions, db_verify | ~30 min |
| **[Migrating from OpenAPI](./migrating-from-openapi.md)** | Import an OpenAPI 3.x / Swagger 2.0 spec + augment with schemas, assertions, db_verify | ~30 min |
| **[Setting up CI](./setting-up-ci.md)** | GitHub Actions / Jenkins / GitLab / Azure — pipeline-by-pipeline | ~20 min per platform |
| **[PUT idempotency](./put-idempotency.md)** | `put_idempotency` — both compare modes, plan-time warnings, opt-out | ~10 min |
| **[HEAD/GET parity](./head-get-parity.md)** | `head_get_parity` — `pair_with` declaration, resolution warnings, auth-strategy caveat, opt-out | ~10 min |

Recipes are self-contained — you can do them in any order. Some
cross-reference each other (the CI recipe assumes you have a working
suite from one of the earlier ones), but each can also stand alone.

---

## Format

Every recipe follows the same structure:

1. **What you'll have when you're done** — one-paragraph end-state.
2. **What you need first** — prerequisites + assumptions.
3. **The walkthrough** — numbered steps; copy-pasteable code.
4. **What just happened** — what the catalog did under the hood.
5. **Where to go next** — adjacent recipes + relevant reference docs.

---

## When you're stuck

- [FAQ](../faq.md) — answers to the 25 most-common questions.
- [Troubleshooting](../troubleshooting.md) — catalogue of common errors with cause + fix.
- [Debugging](../debugging.md) — `--log debug`, the JSON report, jq recipes.
- [Limitations](../limitations.md) — what v1.0 doesn't do (so you don't waste time fighting it).
- [GitHub Issues](https://github.com/anshulgupta1791/apiwright/issues) — open a bug or question if the above didn't help.

---

## Contributing a recipe

Have a useful pattern that's not here yet? Open a PR adding a new
`.md` file under `docs/cookbook/` and link it from this index. Recipe
guidelines:

- One end-to-end task per recipe.
- Copy-pasteable code (full env yaml, full declarations, full CLI
  command).
- Show the expected output so the reader can confirm they're on track.
- Honest about gotchas — if the feature has a known limitation, say
  so and reference [limitations.md](../limitations.md).

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the general PR flow.
