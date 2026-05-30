# Setting up CI

By the end of this recipe your APIWright suite runs on every PR (fast
smoke) and nightly (full regression), with results posted to your
CI's native test view and HTML reports archived as build artifacts.

Four sections — one per platform. The recipe is the same shape on
each; copy-paste the right snippet, swap your placeholders.

---

## What you need first

- APIWright suite that runs locally (any of the cookbook recipes).
- A test environment (`environments/<env>.yaml`) accessible from
  your CI runners.
- Any secrets that env references stored in your CI's secret
  manager (NOT committed to the repo).
- Decisions:
  - Which markers run on PR vs nightly? (Recommended:
    `smoke` on PR, `smoke,regression` nightly.)
  - Which env? (Usually a long-lived `qa` env that survives between
    deploys.)
  - Which Docker image tag? (Pin to `:1.0.0`, not `:latest`.)

---

## The recipe (shared across all platforms)

Every CI integration follows the same shape:

1. **Pull the Docker image** `ghcr.io/anshulgupta1791/apiwright:<version>`.
2. **Mount** your `tests/` + `environments/` + `reports/` directories.
3. **Forward secrets** as env vars (`-e QA_API_TOKEN`, etc.) so
   `${secret.*}` references resolve.
4. **Run** with the platform-appropriate markers.
5. **Publish JUnit XML** to the platform's native test-result view.
6. **Archive HTML report** as a build artifact for QA to inspect.

Ready-made workflow files for the four platforms live in
[`examples/ci/`](../../examples/ci/). This recipe explains how to
adapt them.

---

## GitHub Actions

`.github/workflows/apiwright.yml`:

```yaml
name: APIWright

on:
  pull_request:
  schedule:
    - cron: '0 2 * * *'   # nightly at 02:00 UTC

jobs:
  apiwright:
    name: API tests (${{ github.event_name == 'pull_request' && 'smoke' || 'smoke,regression' }})
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run APIWright
        run: |
          mkdir -p reports
          docker run --rm \
            -v "$PWD/tests:/app/tests:ro" \
            -v "$PWD/environments:/app/environments:ro" \
            -v "$PWD/reports:/app/reports" \
            -v "$PWD/apiwright.config.json:/app/apiwright.config.json:ro" \
            -e QA_API_TOKEN \
            -e QA_DB_USER \
            -e QA_DB_PASSWORD \
            ghcr.io/anshulgupta1791/apiwright:1.0.0 \
            run --env qa \
                --markers "${{ github.event_name == 'pull_request' && 'smoke' || 'smoke,regression' }}"
        env:
          QA_API_TOKEN:   ${{ secrets.QA_API_TOKEN }}
          QA_DB_USER:     ${{ secrets.QA_DB_USER }}
          QA_DB_PASSWORD: ${{ secrets.QA_DB_PASSWORD }}

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

Two markers via the `${{ ... }}` conditional — single workflow,
correct behaviour for both PR and nightly.

`if: always()` on the publish/archive steps so reports upload even
when tests fail. (Which is exactly when you need them.)

---

## Jenkins (declarative)

`Jenkinsfile`:

```groovy
pipeline {
  agent any

  triggers {
    cron('0 2 * * *')   // nightly
  }

  environment {
    APIWRIGHT_IMAGE = 'ghcr.io/anshulgupta1791/apiwright:1.0.0'
  }

  stages {
    stage('APIWright') {
      steps {
        script {
          def markers = env.CHANGE_ID ? 'smoke' : 'smoke,regression'

          withCredentials([
            string(credentialsId: 'qa-api-token', variable: 'QA_API_TOKEN'),
            usernamePassword(credentialsId: 'qa-db',
              usernameVariable: 'QA_DB_USER',
              passwordVariable: 'QA_DB_PASSWORD')
          ]) {
            sh """
              mkdir -p reports
              docker run --rm \
                -v "\$PWD/tests:/app/tests:ro" \
                -v "\$PWD/environments:/app/environments:ro" \
                -v "\$PWD/reports:/app/reports" \
                -v "\$PWD/apiwright.config.json:/app/apiwright.config.json:ro" \
                -e QA_API_TOKEN -e QA_DB_USER -e QA_DB_PASSWORD \
                \${APIWRIGHT_IMAGE} \
                run --env qa --markers ${markers}
            """
          }
        }
      }
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

`env.CHANGE_ID` is set on PR builds; absent on branch / cron builds.
That's how the conditional picks markers.

`junit` (in the `post { always { ... } }`) publishes XML to
Jenkins' native test-result page.

---

## GitLab CI

`.gitlab-ci.yml`:

```yaml
stages: [test]

variables:
  APIWRIGHT_IMAGE: "ghcr.io/anshulgupta1791/apiwright:1.0.0"

.apiwright_template: &apiwright_template
  image: $APIWRIGHT_IMAGE
  stage: test
  before_script:
    - mkdir -p reports
  artifacts:
    when: always
    reports:
      junit: reports/run-*.xml
    paths:
      - reports/
    expire_in: 30 days

apiwright_smoke:
  <<: *apiwright_template
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - apiwright run --env qa --markers smoke

apiwright_nightly:
  <<: *apiwright_template
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
  script:
    - apiwright run --env qa --markers smoke,regression
```

GitLab's `image:` field means the APIWright image IS the job — no
docker-in-docker overhead. Secrets come from GitLab CI variables
(Settings → CI/CD → Variables); they appear as env vars
automatically.

`artifacts.reports.junit` populates the merge-request UI's
test-result tab natively.

Enable the nightly via Settings → CI/CD → Schedules.

---

## Azure Pipelines

`azure-pipelines.yml`:

```yaml
trigger:
  branches:
    include: [main]

pr:
  branches:
    include: ['*']

schedules:
  - cron: "0 2 * * *"
    displayName: Nightly APIWright
    branches:
      include: [main]
    always: true

variables:
  APIWRIGHT_IMAGE: 'ghcr.io/anshulgupta1791/apiwright:1.0.0'

jobs:
  - job: apiwright
    pool:
      vmImage: 'ubuntu-latest'
    steps:
      - task: Docker@2
        displayName: 'Run APIWright'
        inputs:
          command: run
          arguments: >
            --rm
            -v $(Build.SourcesDirectory)/tests:/app/tests:ro
            -v $(Build.SourcesDirectory)/environments:/app/environments:ro
            -v $(Build.SourcesDirectory)/reports:/app/reports
            -v $(Build.SourcesDirectory)/apiwright.config.json:/app/apiwright.config.json:ro
            -e QA_API_TOKEN -e QA_DB_USER -e QA_DB_PASSWORD
            $(APIWRIGHT_IMAGE)
            run --env qa --markers smoke,regression
        env:
          QA_API_TOKEN:   $(QA_API_TOKEN)
          QA_DB_USER:     $(QA_DB_USER)
          QA_DB_PASSWORD: $(QA_DB_PASSWORD)

      - task: PublishTestResults@2
        displayName: 'Publish JUnit results'
        condition: always()
        inputs:
          testResultsFormat: JUnit
          testResultsFiles: '**/run-*.xml'
          testRunTitle: 'APIWright'

      - task: PublishBuildArtifacts@1
        displayName: 'Archive HTML report'
        condition: always()
        inputs:
          PathtoPublish: 'reports'
          ArtifactName: 'apiwright-reports'
```

Schedules live in `schedules:` at the top of the YAML.
`condition: always()` so reports upload even on failure.

---

## Forwarding secrets — the universal pattern

Three steps, identical across platforms:

1. **Store the secret in the platform's secret manager.** Never
   commit values to the repo.

2. **Expose as an env var** in the CI job step. The pattern varies
   per platform (`secrets.X` / `withCredentials` / `$X` / `$(X)`),
   but the effect is the same: a `process.env.X` available in the
   container.

3. **Forward into the container** with `-e X` (no `=value`!). The
   container inherits the variable from the parent process.

   ```bash
   docker run --rm -e QA_API_TOKEN ghcr.io/anshulgupta1791/apiwright:1.0.0 ...
   ```

4. In your env YAML, reference: `token: ${secret.QA_API_TOKEN}`.

The value is automatically registered for redaction; any secret
that ever appears in any output is replaced with `[REDACTED]`.

---

## Database access in CI

If your `db_verify` connects to a database, make sure CI can reach
it:

| Setup | What to do |
|---|---|
| **DB lives in a long-running QA environment** | Just forward `QA_DB_HOST`, `_USER`, `_PASSWORD` secrets; nothing else to do |
| **DB is a docker-compose service in the CI job** | Use docker-compose to bring up DB + APIWright on the same network; the env YAML's `host` references the compose service name, not `localhost` |
| **DB is on a private network behind a VPN** | Configure the CI runner with VPN access OR run APIWright on a self-hosted runner inside the network |

The docker-compose pattern is documented in [docker.md](../docker.md).

---

## Sharding for very large suites

If your full regression takes 30+ minutes, split it across parallel
CI jobs:

```yaml
# GitHub Actions matrix sharding example
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: |
      apiwright run --env qa --markers smoke,regression \
        --shard ${{ matrix.shard }}/4
```

Each shard runs a deterministic 25 % of the plan. APIWright shards
by consistent hashing on the plan key — same plan + same N always
produces the same shards.

See [performance-and-scale.md](../performance-and-scale.md).

---

## Per-stage configs

If different stages want very different settings (faster on PRs,
more thorough on nightly), have multiple configs:

```
configs/
  apiwright.pr.json         # workers=8, markers=smoke, retries=0
  apiwright.nightly.json    # workers=4, markers=all,   retries=2
```

```bash
apiwright run --config configs/apiwright.pr.json --env qa     # PR
apiwright run --config configs/apiwright.nightly.json --env qa # nightly
```

Most teams find one config per (target × stage) is the sweet spot —
flexible without explosion.

See [configuration.md](../configuration.md).

---

## Common pitfalls

### "reports/ is empty after the job"

The `-v $PWD/reports:/app/reports` mount may not exist on the host
when docker tries to bind-mount. Add `mkdir -p reports` before the
`docker run`.

### "Authorization: Bearer [REDACTED]" appears in logs

That's APIWright redacting the secret. Good. Means the contract is
working.

### Test passes locally, fails in CI

Read [troubleshooting.md](../troubleshooting.md)'s "It worked
locally but fails in CI" section — usually network reachability or
secret mismatch.

### Image pull is slow

Pin to a specific version (`:1.0.0`, not `:latest`) and most CI
platforms will cache the image across runs.

---

## Where to go next

- Pick a recipe that matches what your endpoints actually do:
  [CRUD API](./crud-api.md), [Authenticated API](./authenticated-api.md),
  [DB side effects](./db-side-effects.md).
- Hardening: [Best practices](../best-practices.md) — file layout,
  marker discipline, tag taxonomy at the team scale.
- Scaling beyond a few-hundred endpoints:
  [Performance & scale](../performance-and-scale.md).

Reference:

- **[ci-cd.md](../ci-cd.md)** — full per-platform integration
  reference including sharding, docker-compose linking, container-
  network setup.
- **[examples/ci/](../../examples/ci/)** — copy-paste workflow files.
- **[docker.md](../docker.md)** — Docker image usage in depth.
