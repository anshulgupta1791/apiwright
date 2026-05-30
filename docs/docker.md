# Docker usage

The published Docker image is the recommended way to run APIWright in
CI and the simplest way to run it locally without installing Node.

Image: `ghcr.io/anshulgupta1791/apiwright:<version>`

| Tag | Use for |
|---|---|
| `:1.0.0` | Pin to a specific release. **Recommended for CI** — reproducible across re-runs. |
| `:1.0` | Track the latest 1.0.x patch. |
| `:latest` | Track the latest stable release. Convenient for local; avoid in CI. |

Image size is under 200 MB (enforced — the release workflow refuses
to publish images exceeding the limit).

---

## Quick start

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  ghcr.io/anshulgupta1791/apiwright:latest \
  run --env qa --markers smoke
```

What that does:

- `--rm` — remove the container after the run completes (default
  recommendation).
- `-v $PWD/tests:/app/tests:ro` — mount your declarations read-only.
- `-v $PWD/environments:/app/environments:ro` — mount env YAMLs
  read-only.
- `-v $PWD/reports:/app/reports` — writable mount for reports.
- The CLI args (`run --env qa --markers smoke`) are passed straight
  through to the apiwright binary inside the container.

---

## Pinning versions

For CI, always pin to a specific patch version:

```bash
docker pull ghcr.io/anshulgupta1791/apiwright:1.0.0
docker run --rm ... ghcr.io/anshulgupta1791/apiwright:1.0.0 run --env qa --markers smoke
```

Pinning ensures the image you tested against is the same one CI runs
weeks later — no surprise upgrades when a new tag is published.

---

## Mounting your project layout

The container expects (by convention) three directories at the paths
`/app/tests`, `/app/environments`, `/app/reports`. Map your host
layout to those paths:

```
your-project/                    →  /app inside container
├── tests/                       →  /app/tests              (ro)
├── environments/                →  /app/environments       (ro)
├── reports/                     →  /app/reports            (rw)
└── apiwright.config.json        →  /app/apiwright.config.json
```

If your config file is anywhere unusual, mount it too and reference
it with `--config`:

```bash
docker run --rm \
  -v "$PWD/configs:/app/configs:ro" \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  run --config /app/configs/apiwright.json --env qa --markers smoke
```

---

## Forwarding secrets

APIWright resolves `${secret.X}` from `process.env` inside the
container. Forward whatever env vars your environment YAML
references:

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  -e QA_API_TOKEN \
  -e QA_DB_USER \
  -e QA_DB_PASSWORD \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  run --env qa --markers smoke
```

Using `-e VAR_NAME` (without `=value`) forwards the value from your
shell — never write secrets inline.

For multiple vars, an env file is cleaner:

```bash
docker run --rm \
  --env-file .env.qa \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  run --env qa --markers smoke
```

`.env.qa` looks like:

```
QA_API_TOKEN=...
QA_DB_USER=...
QA_DB_PASSWORD=...
```

Make sure `.env.qa` is in `.gitignore` — never commit secrets.

---

## docker-compose

For local development against databases you bring up via compose:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    networks: [appnet]

  api:
    image: yourorg/your-api:dev
    depends_on: [postgres]
    networks: [appnet]
    ports: ["3000:3000"]

  apiwright:
    image: ghcr.io/anshulgupta1791/apiwright:1.0.0
    depends_on: [api, postgres]
    networks: [appnet]
    volumes:
      - ./tests:/app/tests:ro
      - ./environments:/app/environments:ro
      - ./reports:/app/reports
    environment:
      QA_PG_HOST: postgres
      QA_PG_USER: app
      QA_PG_PASSWORD: app
    profiles: [test]   # only runs when explicitly invoked
    command: ["run", "--env", "qa", "--markers", "smoke"]

networks:
  appnet: {}
```

Then:

```bash
docker compose up -d api postgres   # start your stack
docker compose run --rm apiwright   # run the test suite once
```

The `profiles: [test]` keeps the apiwright service from auto-starting
with `up -d`; it runs only when explicitly invoked with `compose run`.

Inside the env YAML, the database host is the compose service name:

```yaml
# environments/qa.yaml
databases:
  primary_postgres:
    type: postgres
    host: ${secret.QA_PG_HOST}    # resolves to "postgres" (the service name)
    port: 5432
    database: app
    user: ${secret.QA_PG_USER}
    password: ${secret.QA_PG_PASSWORD}
```

---

## Custom base URL

Your APIWright container needs to reach your API. Options:

| Setup | Base URL in env YAML |
|---|---|
| API in same docker-compose | `http://api:3000` (service name) |
| API on host, container on Linux | `http://host.docker.internal:3000` (Linux 20.10+) or `http://172.17.0.1:3000` |
| API on host, container on macOS/Windows | `http://host.docker.internal:3000` (built-in) |
| API at public URL | `https://qa-api.example.com` (works anywhere) |

---

## Running ad-hoc CLI commands

Beyond `run`, every other subcommand works the same way:

```bash
# Validate declarations:
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  validate /app/tests

# Import a Postman collection:
docker run --rm \
  -v "$PWD:/work" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  import postman /work/my-collection.json --output /work/tests

# Generate Markdown docs:
docker run --rm \
  -v "$PWD:/work" \
  ghcr.io/anshulgupta1791/apiwright:1.0.0 \
  docs generate --source /work/tests --output /work/docs/api
```

---

## Image internals (for the curious)

- **Base:** `node:22-alpine` (small + secure).
- **User:** non-root (`UID 1000`); your host user needs read access on
  the mounted directories.
- **Workdir:** `/app`.
- **Entrypoint:** `node /app/dist/cli/entry.js` (= `apiwright`).
- **OCI labels:** `org.opencontainers.image.title=APIWright`,
  `.licenses=Apache-2.0`, `.source` + `.documentation` point at the
  GitHub repo.

Source: [`Dockerfile`](../Dockerfile) at the repo root.

---

## Building from source (development)

For working on APIWright itself or testing a change against the image:

```bash
git clone https://github.com/anshulgupta1791/apiwright.git
cd apiwright
docker build -t apiwright:dev .
docker run --rm apiwright:dev --version
```

The build runs `npm ci` + `npm run build` inside the image; the final
stage copies only `dist/` and the runtime deps.

---

## Troubleshooting

**"`tests/run-*.xml` not found" after the container exits** — your
`reports/` mount isn't writable from inside the container. On Linux,
ensure the host directory is writable by UID 1000.

**"connection refused" on db_verify** — the database isn't reachable
from inside the container. Use the docker-compose service name (not
`localhost`), or `host.docker.internal` for host-resolved access.

**"unknown command 'apiwright'" inside the container** — the
entrypoint is already `apiwright`, so you should pass subcommand
arguments only (`run --env qa`, not `apiwright run --env qa`).

**"permission denied" on the mounted directory** — the in-container
user (UID 1000) lacks read/write on the host directory. Either
change ownership on the host (`chown 1000:1000 reports/`) or run
with `--user $(id -u):$(id -g)` to match the host user.

---

## See also

- [installation.md](./installation.md) — the other install routes (npm,
  from source).
- [ci-cd.md](./ci-cd.md) — wiring this same Docker image into CI
  pipelines.
- [environment-config.md](./environment-config.md) — how `${secret.*}`
  resolves from container env vars.
