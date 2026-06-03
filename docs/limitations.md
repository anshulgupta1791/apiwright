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

The published `ghcr.io/anshulgupta1791/apiwright` image is **~248 MB**
on v1.0 (CI ceiling 270 MB). The `node:22-alpine` base alone is
~160 MB plus Docker manifest / attestation overhead; the application
layer itself (compiled `dist/` + non-driver runtime deps) is ~15 MB.

The four DB drivers (`mongodb`, `mysql2`, `neo4j-driver`, `pg`) are
shipped as `optionalDependencies` and **omitted from this image** —
users who need `db_verify` install the relevant driver into their
own project (or bake it into a thin downstream image, see
[`docs/db-verify.md`](./db-verify.md)). The `npm install
apiwright` path still auto-installs drivers by default; only the
published Docker image strips them.

Getting below 200 MB requires switching the base image to a
distroless / scratch variant — losing the shell + complicating
the `tini` SIGTERM-handling story. That's a v1.1+ exploration,
not blocked by anything specifically.

### `apiwright capture <url>` — scaffold a stub from one live response

When you have only a URL and want to test it, the v1.0 path is:
hand-write a 8-line minimal `.endpoint.json` stub, run it, open the
HTML report, copy the response into a schema, re-run. See the
[quickstart](./cookbook/quickstart.md) progressive flow.

A future `apiwright capture <url>` subcommand could collapse those
steps into one: make one live call, auto-infer a JSON Schema from the
response, write the stub `.endpoint.json` ready to commit. Same idea
for `apiwright import curl '<paste curl>'` for one-off curl→endpoint
conversion.

Both deferred to v1.1 so the CLI surface lands with real user input
on shape (one capture per call? session-mode? where to write? auto-
infer assertions or schema-only?) rather than a v1.0 guess that
becomes a SemVer commitment forever (see [compatibility.md](./compatibility.md)).

Track the design at:

- [#101 — `apiwright capture <url>`](https://github.com/anshulgupta1791/apiwright/issues/101)
- [#102 — `apiwright import curl '<command>'`](https://github.com/anshulgupta1791/apiwright/issues/102)

Both issues carry a design-questions checklist for adopter input.

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

## Per-method coverage caveats

Limitations specific to individual HTTP method generators.

### `put_idempotency` — timestamp-bearing response bodies

The `put_idempotency` generator's default compare mode (`body_equality`)
deep-compares the two PUT response bodies. If the PUT response includes a
server-generated field — `lastModified`, `updatedAt`, an ETag, a
sequence counter — the second response will differ from the first even
though the resource state IS idempotent. The test will fail.

Two options:

1. Declare `db_verify` on the endpoint. The generator auto-selects
   `db_state` mode, which re-runs `db_verify` after both PUTs rather
   than comparing response bodies.
2. Opt out of the case entirely:
   `"skip_cases": ["put_idempotency"]` on the endpoint, then add a
   hand-rolled `assertions` entry that checks idempotency in a way
   suited to the specific response shape.

### `put_idempotency` — read-after-write timing in `db_state` mode

When `db_state` compare mode is active, the runner executes
`db_verify` immediately after the second PUT returns. If the system
under test defers write commits — async flush queues, eventual
consistency, write-behind caches — the DB read may not yet reflect
the second PUT's effect, causing a false failure.

Ensure the SUT has flushed all writes to durable storage before
`db_verify` reads, or accept the timing risk and monitor for flaky
results. This limitation was flagged during the v1.0.2 security audit.

### HEAD/GET parity — auth strategy not mirrored from the paired GET

The `head_get_parity` generator applies the HEAD endpoint's
`auth_strategy` to BOTH the HEAD request and the paired GET request.
If the GET endpoint declares a different `auth_strategy`, that
difference is NOT honoured: the parity test will authenticate both
calls using the HEAD endpoint's strategy.

If your HEAD and GET endpoints require different auth strategies, opt
out of the generated case and write a hand-rolled assertion pair instead:

```json
{
  "id": "users.head",
  "skip_cases": ["head_get_parity"]
}
```

### `conditional_get_304` — weak ETags and mid-test resource mutation

The `conditional_get_304` generator issues a GET, records the ETag, then
issues a second GET with `If-None-Match: <etag>`. It asserts the server
responds 304.

Weak ETags (`W/"..."`) are echoed verbatim in `If-None-Match`. RFC 7232
permits servers to respond with a fresh 200 when the ETag is weak and the
resource may have changed — this is not a violation. If the resource is
mutated by a concurrent request between the two GETs (common in shared
test environments under write load), the server may legitimately return 200
instead of 304, causing the `expected 304` failure to trigger. This is a
real environmental condition, not a bug in the server or in APIWright.

To suppress flakes caused by concurrent mutation, opt out of
`conditional_get_304` for endpoints under active write load during the test
run, and verify ETag behaviour with a hand-rolled assertion instead:

```json
{
  "id": "users.get",
  "etag_supported": true,
  "skip_cases": ["conditional_get_304"]
}
```

### `pagination_boundary` — three styles only; cursor does not probe numeric overflow

The `pagination_boundary` generator supports three pagination styles:
`page`, `offset`, and `cursor`. Other styles (link-header, token-based
with non-standard parameters, GraphQL-style connection cursors) are not
recognised and will not produce any cases. Declare those endpoints without
a `pagination` block and add hand-rolled `assertions` entries instead.

For `cursor` style, the `size_max_plus_one` and `page_negative` probes are
not emitted. Cursor tokens are opaque strings; the generator cannot
construct a meaningful "one-past-maximum" or "negative page" cursor value.
The two probes that do apply (`size_zero` and `size_max`) still run.

### `cors_preflight` — wildcard origin accepts echoed origin

When `allow_origins` is `["*"]`, the generator sends `Origin: *` and accepts
either `*` or the request origin in `Access-Control-Allow-Origin`. Some servers
reflect the request origin rather than returning a literal `*` (often because
they need to set `Vary: Origin` alongside). Both behaviours pass the wildcard
check.

When `allow_origins` contains multiple specific origins, the generator sends
the first one and requires the server to echo it exactly — `*` is not accepted
in this case.

### `response_variants` — applies only to STATUS_EQ_KINDS (9 kinds)

The `response_variants` enrichment only annotates failure reasons for
the nine STATUS_EQ_KINDS: `status_code_conformance`,
`no_auth_returns_401`, `garbage_token_returns_401`,
`method_not_allowed`, `malformed_json_returns_400`,
`required_field_omission_returns_400`, `type_violation_returns_400`,
`boundary_battery`, and `pagination_boundary`.

Multi-property verdict kinds (`put_idempotency`, `head_get_parity`,
`conditional_get_304`, `cors_preflight`) compute their own verdict
logic and are NOT affected by `response_variants`. If these kinds fail,
the failure reason comes from their own comparison logic, regardless of
what `response_variants` declares.

### `cors_preflight` — methods and headers compared as case-insensitive set superset

`Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` are checked
as case-folded set supersets of the declared values. The server may return
additional methods or headers beyond what was requested; the case only fails
if a declared value is absent. Comparison ignores case (`content-type` matches
`Content-Type`). This matches the CORS specification (RFC 7230 §3.2) and
avoids false failures on servers that normalise header and method names
differently.

### HEAD/GET parity — `etag` header excluded from parity check

The `head_get_parity` generator ignores the `etag` header when comparing
HEAD and GET response headers. RFC 7232 §2.1 requires that an ETag
returned on a HEAD response be identical to the ETag that would be
returned on the corresponding GET, but certain middleware and
reverse-proxy layers violate this in practice. APIWright ignores `etag`
by default to avoid widespread false failures.

If your infrastructure reliably returns consistent ETags and you want to
enforce the RFC requirement, opt out of `head_get_parity` and add a
hand-rolled assertion that compares both responses directly.

The full ignored-header set (`IGNORED_PARITY_HEADERS`) is documented in
[docs/test-catalog.md](./test-catalog.md) under `head_get_parity`.

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
