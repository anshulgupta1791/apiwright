# Limitations — what APIWright v1.0 does NOT do

APIWright is opinionated about scope. v1.0 ships a tight, well-tested
core for **per-endpoint commodity coverage** of REST/HTTP-JSON APIs.
Several patterns common in API testing are explicitly out of scope —
either by design (better served by other tools) or deferred to a future
version. This page lists them honestly so you can plan around them.

---

## Out of scope by design (not on the roadmap)

These are things APIWright will likely never do, because other tools
already do them well and APIWright isn't trying to replace them.

| Pattern | Use instead |
|---|---|
| Load / performance testing (RPS, latency at scale) | [k6](https://k6.io), [Gatling](https://gatling.io), [Locust](https://locust.io) |
| Consumer-driven contract testing (Pact-style) | [Pact](https://pact.io) — and run APIWright on the provider side alongside |
| Browser end-to-end testing (UI flows) | [Playwright](https://playwright.dev), [Cypress](https://cypress.io) |
| Manual / exploratory API testing | [Postman](https://www.postman.com), [Insomnia](https://insomnia.rest), [Bruno](https://www.usebruno.com) |
| Mocking / virtualisation of upstream services | [WireMock](https://wiremock.org), [Mockoon](https://mockoon.com), [Prism](https://stoplight.io/open-source/prism) |
| Static API spec linting / quality | [Spectral](https://stoplight.io/open-source/spectral), [Redocly CLI](https://redocly.com/redocly-cli) |

APIWright is the **functional correctness + commodity coverage** layer
that sits next to these — not a replacement for any of them.

---

## Deferred to v1.5

Features designed but not in v1.0. Planned for the next minor.

### Multi-step business flows

v1.0 runs one HTTP call per generated case. You cannot author a
declaration that says "POST /login → extract token → POST /orders →
verify status".

**Workaround for v1.0:** write the multi-step scenario as a hand-rolled
integration test in your existing stack (Jest / pytest / etc.) and let
APIWright cover the per-endpoint commodity battery alongside.

### Vector database connectors

`db_verify` supports PostgreSQL, MySQL, MongoDB, and Neo4j. Pinecone /
Weaviate / Qdrant / Chroma are not on the v1.0 driver list. Their REST
APIs can still be hit through the regular HTTP path; only the
`db_verify` connector path is gated.

### Custom reporter plugins

The three built-in reporters (JSON, HTML, JUnit XML) cannot be
augmented with project-specific reporters yet. The structured JSON
report is stable, so a post-processing script can produce any custom
output downstream.

### Per-endpoint timeout override

`apiwright.config.json` does not accept a per-endpoint
`timeout_ms` — the runner uses a fixed 30s default. Use `sla_ms` to
fail fast on latency.

### Docker image under 200 MB

The published `ghcr.io/anshulgupta1791/apiwright` image is ~290 MB
on v1.0 (CI ceiling 320 MB). The `node:22-alpine` base alone is
~160 MB and the four DB drivers (`mongodb`, `mysql2`, `neo4j-driver`,
`pg`) plus their transitive deps account for roughly ~25 MB even
after pruning dev dependencies.

**v1.1 path to ~200 MB:** move the four DB drivers behind
`optionalDependencies` so users who don't declare `db_verify` against
that database type don't pay for the driver in the image, and surface
a clear "install <driver> to use <db> db_verify" error when a missing
driver is referenced. Estimated savings: 15-25 MB plus the
trade-off of users opt-installing their needed driver.

**v1.0 trade-off accepted:** the all-batteries-included experience
(one image, every supported DB works out of the box) was preferred
over the smaller image for the first release. The CI gate at 320 MB
prevents accidental growth past this baseline.

---

## Deferred to v2.0

Larger feature areas that require more design or breaking changes.

### OAuth user flows (browser redirect, PKCE)

The `token_endpoint` auth strategy works for client-credentials /
service-token flows. Interactive user flows (`authorization_code` with a
browser redirect) need separate machinery.

### Request signing (HMAC, AWS SigV4)

For APIs that require signed requests (AWS-style, Stripe webhook
signing, etc.). Workaround for v1.0: inject pre-signed test tokens via
`static_token` and run against fixtures that accept them.

### Mutual TLS (mTLS)

Certificate-based client authentication. The HTTP layer doesn't surface
the TLS client-cert configuration.

### GraphQL importer

`apiwright import graphql <schema.graphql>` to generate per-operation
declarations. v1.0 supports GraphQL endpoints generically (POST to one
URL with a `query`/`variables` body), just without auto-import.

### gRPC importer

`apiwright import grpc <proto>` for protobuf-defined services. v1.0 is
JSON-only on the wire.

### SOAP / XML

v1.0 assumes JSON request and response bodies. SOAP envelopes / XML
schemas are not parsed.

### WebSocket / Server-Sent Events

v1.0 makes one HTTP request and reads one HTTP response per case.
Stream-based protocols are not modeled.

---

## Things the runtime can do but the docs don't yet show

These work but aren't covered in v1.0 docs:

- The `assertions` engine's `db.<connection>.<query_id>.*` target path
  lets you assert on `db_verify` query results inline. Brief mention in
  [assertions.md](./assertions.md); a full guide is pending.
- Sharding (`--shard k/n`) for splitting plans across parallel CI jobs.
  See [performance-and-scale.md](./performance-and-scale.md).
- The partial JSONL sidecar (`reports/run-<ts>.partial.jsonl`) is
  written incrementally and removed on graceful exit. Survives crashes
  for forensics.

---

## If you need one of the above

Open a [GitHub Issue](https://github.com/anshulgupta1791/apiwright/issues)
with the `feature` label and describe your use case. Roadmap is
informed by what people actually ask for.
