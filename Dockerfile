# syntax=docker/dockerfile:1.7
#
# APIWright production Docker image.
#
# Multi-stage build:
#   - Stage 1 (builder): installs all deps, compiles TypeScript
#   - Stage 2 (production): copies only the compiled output and runtime deps
#
# Size: ~248 MB measured, 270 MB CI ceiling (release.yml). The four DB
# drivers (mongodb / mysql2 / neo4j-driver / pg) are `optionalDependencies`
# and omitted from this image; users who run `db_verify` against e.g.
# Postgres add `pg` to their project so it's mounted into /app/node_modules
# at run time, or extend this Dockerfile to bake in the drivers they need.
# The remaining bulk is the `node:22-alpine` base + Docker overhead.
# Non-root execution, fast cold start.
#
# Build:   docker build -t apiwright:1.0.1 .
# Run:     docker run --rm \
#            -v $(pwd)/tests:/app/tests \
#            -v $(pwd)/environments:/app/environments \
#            -v $(pwd)/reports:/app/reports \
#            -e QA_DB_USER -e QA_DB_PASSWORD \
#            apiwright:1.0.1 run --env=qa --markers=smoke

# ─────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Copy manifests first for better layer caching.
COPY package.json package-lock.json* ./

# Copy the prepare-husky bootstrap script alongside the manifests because
# `npm ci` invokes the `prepare` lifecycle script (defined in package.json).
# The bootstrap is a no-op outside a git checkout (see scripts/prepare-husky.mjs)
# but the file must exist on disk or npm errors out before guarding can run.
COPY scripts ./scripts

# CI=true hints the husky bootstrap to no-op (no .git here anyway).
# `--omit=optional` skips the four DB drivers (mongodb, mysql2, neo4j-driver,
# pg) — they are in `optionalDependencies` and users opt in by adding
# their needed driver to their own project. Image size drops from
# ~287 MB to ~248 MB as a result.
ENV CI=true
RUN npm ci --no-audit --no-fund --omit=optional

# Copy source and TypeScript config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to ./dist
RUN npm run build

# Prune to production-only dependencies for copying to the next stage.
# `--omit=optional` (combined with the install step above) keeps the
# optional DB drivers out of the runtime layer.
RUN npm prune --omit=dev --omit=optional

# ─────────────────────────────────────────────────────────────────
# Stage 2: Production
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Install minimal OS-level dependencies needed at runtime
# (tini for proper signal handling, ca-certificates for HTTPS)
RUN apk add --no-cache tini ca-certificates && \
    update-ca-certificates

# Create a non-root user; never run as root
RUN addgroup -g 1001 -S apiwright && \
    adduser -u 1001 -S apiwright -G apiwright -h /home/apiwright

WORKDIR /app

# Copy built artifacts and pruned node_modules from the builder
COPY --from=builder --chown=apiwright:apiwright /build/dist ./dist
COPY --from=builder --chown=apiwright:apiwright /build/node_modules ./node_modules
COPY --from=builder --chown=apiwright:apiwright /build/package.json ./package.json

# Standard mount points (declared, not created with content):
#   /app/tests         - user's endpoint definitions
#   /app/environments  - user's environment YAML configs
#   /app/reports       - where output reports are written
RUN mkdir -p /app/tests /app/environments /app/reports && \
    chown -R apiwright:apiwright /app

# Drop privileges
USER apiwright

# Environment defaults; override at runtime as needed
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    APIWRIGHT_LOG_LEVEL=warn

# Healthcheck: the CLI must respond to --version. Absolute path so the
# check works regardless of the working directory the user mounts into.
HEALTHCHECK --interval=30s --timeout=5s --start-period=3s --retries=3 \
    CMD node /app/dist/cli/entry.js --version || exit 1

# tini handles SIGTERM properly and reaps zombies.
# ABSOLUTE path: a relative `dist/cli/entry.js` would resolve against
# the runtime working directory, so any user who mounts their project
# at a different path (`docker run -v $PWD:/work -w /work ...`) would
# hit a MODULE_NOT_FOUND error. The CI workflow templates in
# docs/cookbook/quickstart.md use that `-w` pattern, so this matters.
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/dist/cli/entry.js"]
CMD ["--help"]

# OCI image metadata
LABEL org.opencontainers.image.title="APIWright" \
      org.opencontainers.image.description="Self-hosted, declarative API testing framework" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/anshulgupta1791/apiwright" \
      org.opencontainers.image.documentation="https://github.com/anshulgupta1791/apiwright#readme" \
      org.opencontainers.image.vendor="Anshul Gupta"
