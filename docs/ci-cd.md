# CI/CD integration

APIWright is built to live in your CI pipeline. The shape is the same
for every platform:

1. **Pull the published Docker image.**
2. **Mount your `tests/` and `environments/` directories** into the
   container.
3. **Forward your platform's secrets** as environment variables —
   APIWright's `${secret.*}` references resolve from `process.env`.
4. **Run the configured markers** for the stage (smoke on PRs,
   regression nightly).
5. **Publish the JUnit XML** to the platform's native test view; archive
   the HTML report as a build artifact.

Ready-to-paste workflows for the four major platforms live in
[`examples/ci/`](../examples/ci/). This page explains the recipe.

---

## The four platforms (drop-in workflows)

| Platform | File | Where to put it |
|---|---|---|
| GitHub Actions | [`examples/ci/github-actions.yml`](../examples/ci/github-actions.yml) | `.github/workflows/apiwright.yml` |
| Jenkins (declarative) | [`examples/ci/Jenkinsfile`](../examples/ci/Jenkinsfile) | `Jenkinsfile` at repo root |
| GitLab CI | [`examples/ci/gitlab-ci.yml`](../examples/ci/gitlab-ci.yml) | `.gitlab-ci.yml` at repo root |
| Azure Pipelines | [`examples/ci/azure-pipelines.yml`](../examples/ci/azure-pipelines.yml) | `azure-pipelines.yml` at repo root |

Replace the placeholders documented in [`examples/README.md`](../examples/README.md):

- `ghcr.io/<org>/apiwright:1.0.0` → your registry/version.
- `qa` (in `--env=qa`) → your environment name.
- `smoke,regression` (in `--markers=`) → your marker selection.
- Secret env var names (`QA_DB_USER`, `QA_DB_PASSWORD`, etc.) → whatever
  your environment YAML references.

---

## The recipe in detail

### Step 1: Pull the Docker image

The published image is `ghcr.io/anshulgupta1791/apiwright:<version>`.
Pinning to a specific version (`:1.0.0`) is recommended over
`:latest` for CI — keeps your tests reproducible if the image is
republished.

The image is under 200 MB. Cold pull on most CI runners takes
~10-30 seconds; caching across jobs cuts that further.

### Step 2: Mount your directories

Three mounts:

```bash
-v "$PWD/tests:/app/tests:ro"               # endpoint declarations (read-only)
-v "$PWD/environments:/app/environments:ro" # environment YAMLs (read-only)
-v "$PWD/reports:/app/reports"              # writable output directory
```

The container runs as a non-root user; on Linux runners, ensure the
host user has read access to `tests/` + `environments/` and write
access to `reports/`.

### Step 3: Forward secrets

APIWright resolves `${secret.X}` from its own `process.env` at run
time. Whatever env vars you forward into the container become
available to the env loader.

```bash
-e QA_DB_USER -e QA_DB_PASSWORD -e QA_API_TOKEN
```

In your environment YAML:

```yaml
auth_strategies:
  bearer:
    type: static_token
    token: ${secret.QA_API_TOKEN}     # resolves to $QA_API_TOKEN at run time
    header: Authorization
    header_value: Bearer ${token}
```

**Never hardcode secrets in YAML.** Use your platform's secret manager
(GitHub Secrets / GitLab CI variables / Jenkins credentials / Azure
Key Vault) → expose as env vars → forward into the container.

Every `${secret.*}` value is automatically redacted in every report
artifact APIWright writes (see [reports.md](./reports.md)).

### Step 4: Run the configured markers

Pick markers per CI stage:

| Stage | Marker | Why |
|---|---|---|
| PR check | `smoke` | Fast (happy-path commodity). Gates merges without blocking velocity. |
| Pre-deploy | `smoke,regression` | Thorough (commodity + negatives + boundary + db). Catches the wider bug class before staging. |
| Nightly | `all` | Everything, including longest-running cases. Surfaces drift you wouldn't otherwise catch. |
| On-demand | `--endpoint <id>` | Single-endpoint deep-dive while debugging. |

See [markers-and-lifecycle.md](./markers-and-lifecycle.md) for the full
recommended pipeline integration.

### Step 5: Publish reports

APIWright writes three files per run. Wire each into your CI's native
viewer:

| File | Where to send it |
|---|---|
| `reports/run-*.xml` | The platform's test-result publisher (renders the green/red badges on the build) |
| `reports/run-*.html` | The platform's artifact storage (downloadable for QA to inspect) |
| `reports/run-*.json` | The platform's artifact storage (downstream tooling can fetch + parse) |

---

## Platform-specific notes

### GitHub Actions

```yaml
- name: Run APIWright
  run: |
    docker run --rm \
      -v "$PWD/tests:/app/tests:ro" \
      -v "$PWD/environments:/app/environments:ro" \
      -v "$PWD/reports:/app/reports" \
      -e QA_DB_USER -e QA_DB_PASSWORD -e QA_API_TOKEN \
      ghcr.io/anshulgupta1791/apiwright:1.0.0 \
      run --env qa --markers smoke
  env:
    QA_DB_USER:    ${{ secrets.QA_DB_USER }}
    QA_DB_PASSWORD: ${{ secrets.QA_DB_PASSWORD }}
    QA_API_TOKEN:  ${{ secrets.QA_API_TOKEN }}

- name: Publish JUnit results
  if: always()
  uses: dorny/test-reporter@v1
  with:
    name: APIWright
    path: reports/run-*.xml
    reporter: java-junit

- name: Archive HTML report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: apiwright-html-report
    path: reports/run-*.html
```

Use `if: always()` on the publish step so reports get uploaded even
when tests fail (so you can see WHY they failed).

### Jenkins

```groovy
stage('APIWright') {
  steps {
    withCredentials([
      string(credentialsId: 'qa-api-token', variable: 'QA_API_TOKEN'),
      usernamePassword(credentialsId: 'qa-db', usernameVariable: 'QA_DB_USER', passwordVariable: 'QA_DB_PASSWORD')
    ]) {
      sh '''
        docker run --rm \
          -v "$PWD/tests:/app/tests:ro" \
          -v "$PWD/environments:/app/environments:ro" \
          -v "$PWD/reports:/app/reports" \
          -e QA_DB_USER -e QA_DB_PASSWORD -e QA_API_TOKEN \
          ghcr.io/anshulgupta1791/apiwright:1.0.0 \
          run --env qa --markers smoke
      '''
    }
  }
  post {
    always {
      junit 'reports/run-*.xml'
      archiveArtifacts artifacts: 'reports/run-*.html, reports/run-*.json',
                       allowEmptyArchive: true
    }
  }
}
```

### GitLab CI

```yaml
apiwright:
  image: ghcr.io/anshulgupta1791/apiwright:1.0.0
  stage: test
  variables:
    APIWRIGHT_ARGS: "run --env qa --markers smoke"
  script:
    - apiwright $APIWRIGHT_ARGS
  artifacts:
    when: always
    reports:
      junit: reports/run-*.xml
    paths:
      - reports/
```

`reports/run-*.xml` under `artifacts.reports.junit` populates the
merge-request UI's test-result tab automatically.

### Azure Pipelines

```yaml
- task: Docker@2
  displayName: 'Run APIWright'
  inputs:
    command: run
    arguments: >
      --rm
      -v $(Build.SourcesDirectory)/tests:/app/tests:ro
      -v $(Build.SourcesDirectory)/environments:/app/environments:ro
      -v $(Build.SourcesDirectory)/reports:/app/reports
      -e QA_DB_USER -e QA_DB_PASSWORD -e QA_API_TOKEN
      ghcr.io/anshulgupta1791/apiwright:1.0.0
      run --env qa --markers smoke
  env:
    QA_DB_USER:    $(QA_DB_USER)
    QA_DB_PASSWORD: $(QA_DB_PASSWORD)
    QA_API_TOKEN:  $(QA_API_TOKEN)

- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: '**/run-*.xml'
    testRunTitle: 'APIWright'
```

---

## Without Docker (native install)

If your runner has Node 22 and APIWright installed natively (via
`npm install -g`), the recipe is simpler:

```bash
apiwright run --env qa --markers smoke
```

Reports land in `./reports/` by default — collect them with the
platform's standard artifact mechanism.

The Docker pattern is the recommended default because it's
reproducible (no Node version drift), but a native install works fine
when your runner is well-controlled.

---

## CI patterns

### Fail-fast vs. run-all

By default a failing case fails the run with a non-zero exit code. To
keep running after failures (so the report contains all failures, not
just the first), the run command doesn't short-circuit — but the
exit code is still non-zero.

This means: even on a failure, the JUnit XML / HTML / JSON reports are
written for inspection. Always use `if: always()` / `condition:
always()` on the publish/archive steps.

### Parallel sharding

For very large suites (500+ endpoints), split across parallel jobs:

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: apiwright run --env qa --markers smoke --shard ${{ matrix.shard }}/4
```

Each shard runs a deterministic 25 % of the plan. See
[performance-and-scale.md](./performance-and-scale.md).

### Per-stage configs

Different config per stage (faster on PRs, more thorough on nightly):

```bash
# PR job
apiwright run --config configs/apiwright.pr.json --env qa

# Nightly job
apiwright run --config configs/apiwright.nightly.json --env qa
```

`apiwright.pr.json` has `workers: 8`, `retry.count: 0`, `markers:
[smoke]`. `apiwright.nightly.json` has `workers: 4`, `retry.count: 2`,
`markers: [smoke, regression]`. See [configuration.md](./configuration.md).

### Container-network linking for db_verify

If your `db_verify` connects to a database running as another
docker-compose service, link the network:

```yaml
services:
  apiwright:
    image: ghcr.io/anshulgupta1791/apiwright:1.0.0
    depends_on: [postgres]
    networks: [app-net]
    volumes:
      - ./tests:/app/tests:ro
      - ./environments:/app/environments:ro
      - ./reports:/app/reports
    environment:
      QA_PG_HOST: postgres   # the in-network hostname, not "localhost"
      QA_PG_USER: app
      QA_PG_PASSWORD: app
    command: ["run", "--env", "qa", "--markers", "smoke"]

  postgres:
    image: postgres:16
    networks: [app-net]

networks:
  app-net: {}
```

In the env YAML, `host: ${secret.QA_PG_HOST}` resolves to
`postgres` — the docker-compose service name, which IS reachable from
the apiwright container.

---

## See also

- [docker.md](./docker.md) — Docker usage in detail.
- [configuration.md](./configuration.md) — `apiwright.config.json`
  reference.
- [reports.md](./reports.md) — what each report file contains.
- [markers-and-lifecycle.md](./markers-and-lifecycle.md) — what to run
  in which stage.
- [`examples/ci/`](../examples/ci/) — copy-paste workflow files.
