# Comparisons — APIWright vs. other API testing tools

The "should we adopt APIWright" question almost always becomes "vs. *X*".
This page treats each comparison honestly: what each tool is great at,
where APIWright is a better fit, where it isn't, and whether they're
substitutes or complements.

Short version: **APIWright is the per-endpoint commodity-coverage layer
that sits next to your existing tools, not a replacement for any of
them.** Different tools solve different parts of the problem.

---

## vs. hand-written integration tests (Jest / pytest / Mocha / Vitest)

**What integration tests are great at:** business flows (login → create
order → pay → check), domain-specific invariants, race conditions,
custom interaction patterns. The work that's *irreplaceable* — only
your team can author it because only your team knows the domain.

**What APIWright adds:** the *systematic* per-endpoint coverage your
integration tests usually don't reach because it's not worth the labor —
every status code conforms, every schema validates, every required
field has a missing-field test, every typed field has a wrong-type
test, every numeric field has boundary tests, every auth-protected
endpoint has 401-without-token tests, every endpoint has malformed-JSON
returning 400 (not 500), every endpoint has SLA conformance, every
write has DB verification. Per 100 endpoints that's ~1,500–2,000
tests — multiplied across every project.

**Verdict: complementary.** Integration tests stay focused on the
bespoke 15–25 % of API correctness that requires domain knowledge;
APIWright covers the systematic 75–85 % from one declaration per
endpoint. A typical layout: ~1,500 commodity tests generated from
declarations + a handful of hand-written flow tests (pytest / Jest)
for the bespoke scenarios that integration tests do best.

---

## vs. Postman + Newman

**What Postman is great at:** interactive API exploration. Collection
sharing. "Send this request and see what comes back." Manual QA
workflows. Onboarding a new dev to an unfamiliar API.

**What Newman is great at:** running Postman collections in CI. The
ergonomics of "I already have a collection, I just want it in CI" — one
binary, one collection file, done.

**What APIWright adds:** systematic generation of negative / boundary /
auth / schema / DB cases the Postman author didn't write. Postman
collections cover happy paths the author cared enough to capture;
APIWright covers the whole §3 catalog per endpoint from one declaration.

**Migration path:** `apiwright import postman <collection.json>` reads
your existing Postman v2.1 collection and emits one
`*.endpoint.json` per request. Hand-author the parts the importer
can't infer (request body schemas, response schemas, db_verify) and
you're running the full catalog on top of the same endpoints you
already had captured. See [postman-import.md](./postman-import.md).

**Verdict:** if your Postman collections are the source-of-truth for
"these are our endpoints," import them into APIWright and gain the
catalog for free; keep Postman for interactive exploration.

---

## vs. Karate

**What Karate is great at:** flow-based BDD with a clean DSL. The
test-as-script-with-natural-language style. Great when your tests are
mostly multi-step scenarios and the test code itself is the
documentation.

**What APIWright is different at:** declaration-driven, not
script-driven. You don't write the test cases — you write the endpoint
and APIWright generates the cases. For per-endpoint commodity coverage
this scales differently: 100 endpoints in APIWright is ~100
declarations (one per endpoint); 100 endpoints in Karate is ~hundreds
of `.feature` files (one per scenario).

**Where Karate wins:** multi-step flows. v1.0 of APIWright is
single-call; Karate is built for sequences. If most of your tests are
flow-shaped, Karate is the better fit until APIWright v1.5 adds flows.

**Verdict:** different philosophies. Karate is great for flow-heavy
suites; APIWright is great for per-endpoint commodity coverage at
scale. The two can coexist (Karate for the flows; APIWright for the
catalog on each endpoint along the way).

---

## vs. REST Assured (Java) / Rest-Sharp (.NET) / requests-mock (Python)

**What these libraries are great at:** giving programmers an ergonomic
HTTP client + assertion API in their host language. Tight integration
with the rest of the language's test ecosystem.

**What APIWright is different at:** zero code. Authors don't need to
know Java / C# / Python to add a new endpoint to the suite — they
write a JSON declaration. Same engine drives the suite regardless of
what language your application is in.

**Verdict:** these libraries are the *building blocks* you'd use to
hand-roll your integration tests; APIWright is the *batteries-included*
alternative for the part of the test surface where you don't want to
write code. Many projects use both.

---

## vs. Pact (consumer-driven contract testing)

**What Pact is great at:** the *contract* between a consumer service
and the provider it calls. Catches breaking changes when the provider
modifies a response shape the consumer depends on. Run on the consumer
side; the contracts are then verified on the provider side.

**What APIWright is different at:** *provider-side functional
verification*. APIWright doesn't care which consumer uses an endpoint;
it asserts the endpoint behaves the way its declaration says it does.
Catches a different class of bug — implementation drift from the
declared contract, not consumer-provider contract drift.

**Verdict: complementary.** Run Pact for consumer-driven contracts
between services; run APIWright on each provider for functional
correctness of its endpoints. The two cover orthogonal failure modes.

---

## vs. k6 / Gatling / Locust (load testing)

**What load testing tools are great at:** throughput, p99 latency, RPS
ceilings, soak tests, sustained-load behaviour. Pushing the system
until it falls over and finding where.

**What APIWright is different at:** functional correctness of every
endpoint at low concurrency. APIWright will catch "endpoint returns 500
on malformed JSON"; k6 will catch "endpoint's p99 latency degrades 4x
at 500 RPS". Different questions, different tools.

**Verdict: complementary.** APIWright in CI for every PR ("does the
endpoint still work?"); k6 in a separate perf pipeline ("does it still
meet SLA at scale?"). They never compete for the same job.

---

## vs. Spectral / Redocly CLI (spec linting)

**What spec linters are great at:** static analysis of your OpenAPI /
Swagger spec — naming conventions, required-field consistency,
description completeness, security-scheme presence, etc. Catches
problems in the *spec*, before any code runs.

**What APIWright is different at:** runtime verification that the
deployed endpoint matches the spec. A linter says "your spec is
internally consistent"; APIWright says "your live API actually behaves
the way the spec says it does."

**Verdict: complementary.** Lint your spec with Spectral / Redocly;
run APIWright against the deployed API to verify the implementation
matches.

---

## vs. WireMock / Mockoon / Prism (API mocking)

**What mocking tools are great at:** simulating an upstream API your
service depends on so you can run integration tests without that
upstream being available. Faster, cheaper, deterministic. Essential
for testing the *consumer* side.

**What APIWright is different at:** running against the *real* API.
APIWright is a provider-side tester; it doesn't mock anything. Its
target is the actual deployed API.

**Verdict:** orthogonal use cases. Mock upstream services in your
integration tests; run APIWright against your own deployed services.

---

## The "should I adopt APIWright" decision tree

```
Do you have an HTTP/REST API your team owns?
├─ No  → APIWright isn't for you (v1.0 is HTTP/REST/JSON only).
└─ Yes
   │
   Do you currently test it systematically per endpoint
   (status / schema / auth / input validation / DB state)?
   ├─ Yes, exhaustively, across all endpoints
   │  → You're getting most of APIWright's value already. Compare the
   │    declaration-vs-test-code line count for one of your endpoints
   │    to see if the DRY win still matters to you.
   │
   └─ No (covering happy paths + maybe a few error cases)
      → APIWright will give you a step-change in coverage with
        roughly the same authoring labor as a handful of integration
        tests per endpoint. This is the typical case.
```

---

## One-liner pitch

> APIWright is to your integration suite what an HTTP client library is
> to your application code: it doesn't replace what you write — it
> removes the 80 % you shouldn't have to.

See [concepts.md](./concepts.md) for the mental model and
[faq.md](./faq.md) for the question-and-answer version of these
comparisons.
