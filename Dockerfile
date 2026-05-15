# syntax=docker/dockerfile:1.7
#
# APIWright production Docker image.
#
# Multi-stage build:
#   - Stage 1 (builder): installs all deps, compiles TypeScript
#   - Stage 2 (production): copies only the compiled output and runtime deps
#
# Target: < 200MB final image size, non-root execution, fast cold start.
#
# Build:   docker build -t apiwright:0.1.0 .
# Run:     docker run --rm \
#            -v $(pwd)/tests:/app/tests \
#            -v $(pwd)/environments:/app/environments \
#            -v $(pwd)/reports:/app/reports \
#            -e QA_DB_USER -e QA_DB_PASSWORD \
#            apiwright:0.1.0 run --env=qa --markers=smoke

# ─────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./

# Install ALL dependencies (dev included for the build step)
RUN npm ci --no-audit --no-fund

# Copy source and TypeScript config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to ./dist
RUN npm run build

# Prune to production-only dependencies for copying to the next stage
RUN npm prune --production

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

# Healthcheck: the CLI must respond to --version
HEALTHCHECK --interval=30s --timeout=5s --start-period=3s --retries=3 \
    CMD node dist/cli/entry.js --version || exit 1

# tini handles SIGTERM properly and reaps zombies
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/cli/entry.js"]
CMD ["--help"]

# OCI image metadata
LABEL org.opencontainers.image.title="APIWright" \
      org.opencontainers.image.description="Self-hosted, declarative API testing framework" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/CHANGE-ME/apiwright" \
      org.opencontainers.image.documentation="https://github.com/CHANGE-ME/apiwright#readme" \
      org.opencontainers.image.vendor="CHANGE-ME"
