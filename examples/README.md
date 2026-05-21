# APIWright CI/CD Integration Examples

This directory contains copy-paste reference workflows for the major CI/CD
platforms supported by APIWright v1.0 (see `V1_BUILD_SPEC.md` §14).

All examples follow the same recipe:

1. **Pull and run the published Docker image** (`ghcr.io/<org>/apiwright:1.0.0`).
2. **Mount three host directories** into the container:
   - `tests/` — the endpoint and flow JSON files.
   - `environments/` — the YAML environment files.
   - `reports/` — the writable output directory (HTML + JUnit XML + JSON).
3. **Inject secrets via environment variables** — every `${secret.*}`
   reference in your environment YAML resolves from `process.env`. Use
   the CI platform's native secret manager, never literals.
4. **Archive the JUnit XML** so test-management systems (TestRail, Zephyr,
   qTest, ReportPortal, etc.) can ingest the results.
5. **Publish the HTML report** as a downloadable build artifact so QAs
   can inspect failures without re-running the suite locally.

## Files

| Platform | File | Notes |
| --- | --- | --- |
| GitHub Actions | [`ci/github-actions.yml`](ci/github-actions.yml) | Drop into `.github/workflows/apiwright.yml` |
| Jenkins | [`ci/Jenkinsfile`](ci/Jenkinsfile) | Declarative pipeline; expects Docker on the agent |
| GitLab CI | [`ci/gitlab-ci.yml`](ci/gitlab-ci.yml) | Use as your repo's `.gitlab-ci.yml` |
| Azure Pipelines | [`ci/azure-pipelines.yml`](ci/azure-pipelines.yml) | Use as your repo's `azure-pipelines.yml` |

## Replacing the placeholder values

Every example uses the same set of placeholders. Replace them before you
commit the workflow to your repository:

| Placeholder | What to put there |
| --- | --- |
| `ghcr.io/<org>/apiwright:1.0.0` | The image coordinates published by your release pipeline |
| `qa` (in `--env=qa`) | The environment name to run against |
| `smoke,regression` (in `--markers=`) | The marker selection for this job |
| `QA_DB_USER`, `QA_DB_PASSWORD`, `QA_USER`, `QA_PASSWORD` | Whatever `${secret.*}` references your environment YAML uses |

## What gets archived

Every example archives the whole `reports/` directory. By default APIWright
writes three files per run, all sharing a single timestamped basename:

- `reports/run-<ts>.html` — the human-readable Technical Report.
- `reports/run-<ts>.xml` — JUnit XML for test-management ingestion.
- `reports/run-<ts>.json` — the structured RunResult sidecar.

Job-level test reporting (the green/red check on a PR) reads the JUnit
XML using each platform's native test-result publisher.
