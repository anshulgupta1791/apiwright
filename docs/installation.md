# Installation

APIWright ships in three forms: **Docker** (recommended for CI and one-off
runs), **npm** (recommended for local development on a project that already
has Node tooling), and **from source** (for contributors and people who want
to pin to a specific commit).

Pick whichever fits your environment. The CLI surface is identical across
all three.

---

## Prerequisites

| What | Why | How to check |
|---|---|---|
| **Node.js 22 LTS** (or newer) | APIWright runs on the Node runtime. v22 is the supported baseline; v23+ also works. | `node --version` → `v22.x` or higher |
| **Docker** *(optional)* | Required only if you want to run APIWright in a container, or if your db_verify endpoints connect to databases you'd like to bring up locally via docker-compose. | `docker --version` |
| **Git** *(optional)* | Required only for the from-source install. | `git --version` |

APIWright bundles its own database drivers (`pg`, `mysql2`, `mongodb`,
`neo4j-driver`), so you don't need to install any of those separately for
db_verify to work — they ship with the package.

---

## Option 1 — Docker (recommended for CI)

The published image is the simplest, most reproducible way to run APIWright
on any machine that has Docker. No Node install needed locally.

```bash
docker run --rm \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/environments:/app/environments:ro" \
  -v "$PWD/reports:/app/reports" \
  -e QA_DB_USER -e QA_DB_PASSWORD \
  ghcr.io/anshulgupta1791/apiwright:latest \
  run --env qa --markers smoke
```

What's happening:

- `-v $PWD/tests:/app/tests:ro` — mount your endpoint declarations
  read-only.
- `-v $PWD/environments:/app/environments:ro` — mount your environment
  YAMLs read-only.
- `-v $PWD/reports:/app/reports` — mount the directory APIWright will
  write JSON / JUnit / HTML reports into. Must be writable.
- `-e QA_DB_USER -e QA_DB_PASSWORD` — forward secrets from your shell into
  the container's `process.env`, where `${secret.QA_DB_USER}` references in
  the environment YAML resolve from.
- `run --env qa --markers smoke` — the APIWright command, identical to a
  local invocation.

Pinning to a specific version is recommended for CI — replace `:latest`
with `:1.0.0` (or the tag you've tested against).

See [docs/docker.md](./docker.md) for the full Docker guide, including
docker-compose integration and database-network linking.

---

## Option 2 — npm

For local development on a project where you already have Node tooling.

```bash
# Install globally (provides the `apiwright` command on $PATH):
npm install -g apiwright

# OR install as a project dependency (run with npx):
npm install --save-dev apiwright
npx apiwright --version
```

Verify the install:

```bash
apiwright --version
# 1.0.0

apiwright --help
# Usage: apiwright [options] [command]
# ...
```

> **Note:** at the time of writing the package is not yet published to the
> public npm registry. If `npm install apiwright` returns *"not found"*,
> use Option 3 (from source) or Option 1 (Docker) until the v1.0.0 tag is
> published.

---

## Option 3 — From source

For contributors, anyone who wants to pin to a specific commit, or anyone
who needs to patch APIWright locally.

```bash
git clone https://github.com/anshulgupta1791/apiwright.git
cd apiwright
npm install
npm run build      # produces dist/

# Make the local binary runnable:
npm link            # symlinks `apiwright` onto $PATH
# OR run via the produced binary directly:
node dist/cli/entry.js --version
```

To use this local copy from another project on the same machine
(useful for hacking on apiwright while iterating against a real
test suite):

```bash
# In the consuming project:
npm install --save-dev file:/path/to/apiwright
npx apiwright --version
```

---

## Verifying the install

Whatever route you took, this command should succeed:

```bash
apiwright --version
# 1.0.0

apiwright --help
# (prints subcommand help)
```

To smoke-test against a real public API (no credentials needed), create
one declaration and run validate + run:

```bash
mkdir -p smoketest/tests smoketest/environments smoketest/reports
cat > smoketest/environments/httpbin.yaml <<'YAML'
name: httpbin
prod: false
base_url: https://httpbin.org
default_sla_ms: 5000
YAML
cat > smoketest/tests/get.endpoint.json <<'JSON'
{
  "id": "httpbin.get",
  "name": "GET /get",
  "method": "GET",
  "url": "/get",
  "markers": ["smoke"],
  "request": {},
  "response": { "expected_status": 200, "schema": { "type": "object" } }
}
JSON
cat > smoketest/apiwright.config.json <<'JSON'
{
  "tests_dir": "./smoketest/tests",
  "environments_dir": "./smoketest/environments",
  "reports_dir": "./smoketest/reports",
  "default_env": "httpbin",
  "default_markers": ["smoke"],
  "report": { "html": true, "json": true, "junit_xml": true, "output_dir": "./smoketest/reports" }
}
JSON

apiwright validate ./smoketest/tests
apiwright run --config ./smoketest/apiwright.config.json --env httpbin
```

If validate and run both exit 0 and `smoketest/reports/run-*.json` is
written, the install is good.

---

## Common install issues

**`Cannot find module 'apiwright'`** — you installed locally but are not
running via `npx apiwright`. Either use `npx`, add `./node_modules/.bin`
to your PATH, or install globally.

**`Node.js version too old`** — APIWright requires Node 22 LTS. Upgrade
via `nvm install 22` (recommended) or your platform's Node installer.

**`docker: command not found`** — Docker is only needed for Option 1.
Switch to npm or from-source if you don't want Docker.

**`permission denied` on `npm install -g`** — your global npm prefix is
owned by root. Either use a Node version manager (`nvm` / `fnm` /
`asdf` — recommended; sets up a user-owned prefix automatically) or
`sudo npm install -g apiwright`.

**Database driver "not found" at run time** — APIWright bundles the
drivers, so this should never happen with a fresh install. If you see it
after `npm install`, run `rm -rf node_modules && npm install` to repair
the dependency tree.

---

## Next steps

- [Quickstart](./cookbook/quickstart.md) — your first endpoint, end-to-end, in five minutes.
- [Concepts](./concepts.md) — the mental model: declarations, environments, markers, runs, reports.
- [CLI reference](./cli.md) — every command and flag.
