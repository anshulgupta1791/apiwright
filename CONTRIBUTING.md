# Contributing to APIWright

Thanks for your interest in improving APIWright! Bug reports, feature requests,
documentation fixes, and pull requests are all welcome.

This project is governed by a [Code of Conduct](./CODE_OF_CONDUCT.md); by
participating you agree to abide by it. Security issues have their own
private-disclosure flow — see [SECURITY.md](./SECURITY.md) before opening a
public issue.

---

## Ways to contribute

- **File an issue** — bug reports, feature requests, documentation gaps:
  https://github.com/anshulgupta1791/apiwright/issues
- **Discuss a design** — large changes start with a discussion (open an issue
  with the `discussion` label) so we can agree on the approach before code.
- **Improve the docs** — typos, missing examples, unclear explanations. Docs
  PRs are reviewed quickly and don't need accompanying code changes.
- **Submit a pull request** — bug fix or feature, following the flow below.

## Prerequisites

- **Node.js 22 LTS** — `node --version` should report `v22.x`. Newer LTS lines
  are accepted in CI but `22` is the supported baseline.
- **npm 10+** (ships with Node 22).
- **Docker** — required to build the production image and to run the
  database-backed integration tests locally (testcontainers spins up real
  Postgres / MySQL / MongoDB / Neo4j on demand).
- **git** + a fork of `anshulgupta1791/apiwright`.

## Local setup

```bash
git clone https://github.com/<your-fork>/apiwright.git
cd apiwright
npm install
```

That's it. There are no environment variables, secret files, or docker-compose
to bring up just to run the gated suite — the integration tests are hermetic.

## The development loop

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src tests --max-warnings 0
npm test               # vitest run (unit + integration)
npm run test:coverage  # gated: ≥95% on statements/branches/functions/lines
```

The pre-commit hook runs all of the above plus secret detection
(`gitleaks`), `npm audit`, and Semgrep (if installed locally; CI runs it
regardless). A failing hook means your commit is rejected — fix the failure
and re-commit; **do not** bypass the hook with `--no-verify` unless you have a
very specific reason and call it out in the PR description.

If you only want a tight inner loop while iterating, `npm run test:watch`
re-runs the affected suite on save without the coverage step.

## Branching + pull-request flow

1. **Branch off `main`.** Conventional branch prefix: `feat/…`, `fix/…`,
   `chore/…`, `docs/…`.
2. **Keep PRs focused.** One concern per PR makes review faster and merges
   safer. If a change naturally splits into "refactor first, then add
   feature," ship the refactor as its own PR.
3. **Write a clear PR description.** What problem does this solve, why this
   approach, what risks did you consider, how was it tested. The PR template
   prompts for all of this.
4. **Reference issues** with `closes #N` / `fixes #N` so they auto-close.
5. **CI must be green.** Lint, typecheck, unit, integration, coverage,
   semgrep, gitleaks, and `npm audit` all gate the merge. If a check fails,
   fix it — don't ask reviewers to "ignore" anything.

## Coding standards

- **TypeScript strict mode** with no `any` in public APIs. Internal `any` is
  permitted only with an inline justification comment.
- **ESLint clean** (`--max-warnings 0`). Auto-fix safe issues with
  `npm run lint:fix`.
- **Prettier formatted** (`npm run format`).
- **File sizes**: 300-line soft limit, 500-line hard cap. Split modules
  before they grow unwieldy.
- **Public functions carry TSDoc.** Param / return / throws documented.
- **No `console.log`.** Use the `pino`-based logger.
- **Pure, deterministic, no-throw** is the house style for parsers and
  evaluators — they return result objects, never throw.
- **`/* istanbul ignore next */` is allowed only** for the four
  unreachable-by-construction categories described in
  `configs/vitest.config.ts` (process.exit boundary, platform-specific
  branches, provably-unreachable defensive guards with a named invariant, and
  real interactive stdin). Every ignore needs a one-line justification.

## Tests

- **Unit tests** (`tests/unit/`) — every behaviour change ships with tests
  that fail before your change and pass after. Aim for the smallest test
  that proves the intent; don't game coverage with mirror tests.
- **Integration tests** (`tests/integration/`) — hermetic; round-trip
  recorded fixtures through real modules with no network access.
- **Fixtures** (`tests/fixtures/`) — sample data the tests consume.
- The 95% coverage gate is non-negotiable; lower-coverage PRs are blocked at
  CI. If a code path is genuinely untestable, use a justified `istanbul
  ignore` rather than lowering the gate.
- **End-to-end / real-service tests live in the sibling
  [`apiwright-testing`](https://github.com/anshulgupta1791/apiwright-testing)
  framework**, not here. If your change needs an e2e check, add it there.

## Commit messages

Conventional Commits with the standard prefixes:

```
feat: add --shard flag to the run command
fix(env): resolve ${secret.*} inside databases block
docs(cli): document the new --shard flag
chore(deps): bump pg to 8.13.3
test(runner): add boundary coverage for retry backoff
refactor(reporter): extract junit row builder
```

PR titles use the same format so the squashed merge commit on `main` is
well-formed without manual editing.

## Where to find things

| Looking for… | Where |
|---|---|
| What APIWright is + how to use it | [`README.md`](./README.md) + [`docs/`](./docs/) |
| CLI reference | [`docs/cli.md`](./docs/cli.md) |
| Endpoint declaration model | [`docs/canonical-model.md`](./docs/canonical-model.md) |
| Environment + secrets | [`docs/environment-config.md`](./docs/environment-config.md) |
| Postman importer | [`docs/postman-import.md`](./docs/postman-import.md) |
| Real-service / e2e tests | sibling [`apiwright-testing`](https://github.com/anshulgupta1791/apiwright-testing) repo |
| CI integration | [`examples/ci/`](./examples/ci/) |

## Releases

Releases are tagged `v<semver>` from `main`. See [GitHub
Releases](https://github.com/anshulgupta1791/apiwright/releases) for the
changelog. Maintainers handle tagging; contributor PRs do not bump version
numbers.

## Questions?

Open a [GitHub Issue](https://github.com/anshulgupta1791/apiwright/issues)
or a [GitHub Discussion](https://github.com/anshulgupta1791/apiwright/discussions).
All project communication happens on GitHub.

For security reports, follow the process in [SECURITY.md](./SECURITY.md) —
it routes through GitHub's private vulnerability reporting so the issue
stays confidential until a fix is published.

Thanks for contributing!
