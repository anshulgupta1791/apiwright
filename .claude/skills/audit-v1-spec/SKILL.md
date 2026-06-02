---
name: audit-v1-spec
description: >-
  Audit the APIWright codebase against V1_BUILD_SPEC.md AND grill every
  design/interpretation/deferral decision from a user POV. Produces a
  structured report: ✅ matches spec, ❌ required-but-missing, ⚠️ extra
  (in code, not in spec), 🕐 legitimately deferred to v1.5+, 🔎 ambiguous,
  PLUS 🔥 pointed user-POV questions challenging every judgment call the
  build process made (spec interpretation, defaults, agent improvisation,
  defensive ignores, memory drift, UX). Use when the user asks "audit the
  codebase", "what's left for v1.0?", "are we shipping anything not in spec?",
  "is X actually built?", "grill every decision", or any spec-vs-source +
  decision-vs-user-expectation consistency check. Mandatory before tagging
  a release.
---

# Audit Codebase vs V1_BUILD_SPEC.md

This skill performs an exhaustive walk over `V1_BUILD_SPEC.md` and checks
every documented v1.0 deliverable against the actual `src/` and `tests/`
trees. It produces a single Markdown audit report classifying every spec
item into one of four buckets.

## When to invoke

- After a task PR merges (sanity check the merge actually closes spec gaps).
- Before tagging a release (gate: zero `🚨 required-but-missing` items).
- When a user asks "where are we vs V1?" / "what's left?" / "did Task N
  actually ship X?".
- When investigating a stale-feeling memory note ("the spec says Y; do we
  actually have Y?").

## Authoritative inputs

1. **`V1_BUILD_SPEC.md`** — the primary source of truth. The spec sections (§1–§14) and
   their "What ships in v1.0" + "Deferred to v1.5" sub-blocks are the
   source of truth. Always read the latest version on `main`.
2. **`.claude/projects/<project>/memory/MEMORY.md`** and the
  `project_task10_obligations.md` memo — track known cross-task
  deferrals. Use these to distinguish "intentionally deferred" from
  "accidentally missed".
3. **`CLAUDE.md`** — project conventions (file size, lint, coverage,
   silencing-comment ban, etc.). The spec doesn't enforce these directly
   but they bound what counts as "shipped".
4. **`src/` + `tests/`** — the actual code. Use `find`, `grep`, and file
  reads to verify.

## Output: one Markdown report

Produce ONE Markdown file (don't write it to disk unless the user asks)
with this structure:

```markdown
# APIWright V1.0 Spec Audit — <YYYY-MM-DD>

## Summary
- ✅ Implemented & matches spec: N items
- ❌ Required for v1.0 but missing / partial: N items
- ⚠️ Extra (in code, not in spec): N items
- 🕐 Legitimately deferred to v1.5+: N items
- 🔎 Ambiguous (needs spec clarification): N items
- 🔥 User-POV grilling findings (judgment calls to ratify): N items

## Per-section findings

### §1 Internal Canonical Model
- ✅ `CanonicalEndpoint` shape — `src/core/canonical-model.ts:116`
- ❌ …

### §2 Environment & Secrets Manager
- …

(…through §14)

## Per-task obligation discharge
Cross-reference with `project_task10_obligations.md` (13 items).
Each item: discharged ✅ / open ❌ / out-of-scope 🚫.

## 🔥 User-POV grilling
For each judgment call the build process made, pose a sharp
yes/no question the user must answer. Default stance: BAD until
ratified.

### Spec interpretation calls
1. 🔥 §9 line 638 says "Playwright's worker model" — we shipped
   single-worker sequential. Was that "as per V1 Spec, nothing less"?
   (Decision recorded where? Who approved? Is the deferral memo updated?)
2. …

### Defaults chosen
3. 🔥 Retry default = `count:2, delay:1000, backoff:linear`. Spec line
   657 says exactly this — ✅ match. But `--retries=N` overrides
   `count` only — does it reset `delay`/`backoff`? Spec is silent;
   user expects what?
4. …

### Agent improvisation surface
5. 🔥 `wrapForMarker(strategy, marker, spec?)` 3rd-arg optional
   (Task 9 impl-engineer change) + GarbageTokenMangle "specless mode"
   (+82 LOC scan-secrets path). Spec mentions neither. Acceptable
   convenience or scope creep?
6. …

### Defensive istanbul-ignores
7. 🔥 N istanbul-ignores across src/. List each with file:line and
   the user-facing question: "If this branch fires in prod, what
   happens, and is the justification still valid?"

### Memory drift
8. 🔥 Memory file claims X — is X still true on `main` HEAD? Quote
   the claim, quote the current code, flag any divergence.

### User-facing UX
9. 🔥 CLI flag vs config key naming alignment (--workers ⇄ workers,
   --retries ⇄ retry.count). Surprising? Documented?
10. 🔥 Error messages a confused QA will hit: do they name the
    offending file/field/line, or just throw "PARSE_FAILED"?

## Open questions for the user
1. …
```

## Audit procedure

Work through these phases in order. Don't skip phases — every item is
load-bearing.

### Phase 1 — Read the spec end-to-end

```bash
wc -l V1_BUILD_SPEC.md  # know the size
grep -n "^### " V1_BUILD_SPEC.md  # list section headers
```

Read the file fully via the `Read` tool. Don't rely on memory. Pay
attention to:
- `**What ships in v1.0:**` bullets — these are MANDATORY for v1.0
- `**Deferred to v1.5:**` lines — these MUST NOT appear in v1.0 (so a
  presence is a `⚠️ extra` finding, not a `❌ missing`)
- Inline code blocks showing example endpoint JSON, env YAML,
  `apiwright.config.json` — these define the expected DATA shapes
- Phrases like "MUST", "fail-fast", "exactly once", "deterministic",
  "single source of truth" — these are testable invariants

### Phase 2 — Inventory the code

Build a map of source modules and what they claim to deliver:

```bash
find src -type d
find src -name "index.ts" -exec grep -l "^export" {} \;
```

For each top-level module (`src/core`, `src/env`, `src/importers/postman`,
`src/importers/openapi`, `src/cli`, `src/test-catalog`, `src/assertions`,
`src/db`, `src/auth`, `src/runner`, `src/reporting`), open its `index.ts`
barrel and list every exported symbol. The barrels are the public surface.

### Phase 3 — Walk the spec section by section

For EVERY `**What ships in v1.0:**` bullet, find the matching code:

| Spec item | How to verify |
|---|---|
| "X module/strategy/format exists" | `grep -r "export.*X" src/` |
| "X has a Y method" | Read the file; verify the method signature |
| "X fails fast on Z" | Find the throw site; verify the error code |
| "X is deterministic" | Read tests; verify they assert byte-equality across runs |
| "X is configurable via apiwright.config.json" | Check `src/cli/config/types.ts` for the config field |
| "X is overridable via --flag" | Check `src/cli/entry.ts` commander options |

For ambiguous items, flag `🔎` and ask the user — don't guess.

### Phase 4 — Cross-check obligations

Open `project_task10_obligations.md` (13 items as of the post-Task-#11
state). For each:
- Find the discharging code in `src/runner/` or `src/reporting/`.
- If the obligation says "Task #10/§9 must wire X" and the relevant
  runner module DOES wire X, mark ✅.
- If the obligation is open, mark ❌ and note which spec section it
  belongs to.

### Phase 5 — Inventory the "extra" surface

For each `src/*/index.ts` barrel symbol, ask: does the spec actually
mention this? If yes → 🟢 fine. If no:
- Is it a legitimate internal infrastructure (parser helpers, type
  guards) used by the spec-mandated public surface? → 🟢 fine.
- Is it a NEW feature outside the spec? → ⚠️ flag.

Common ⚠️ patterns to watch for:
- Speculative interfaces "for v1.5" that ship live.
- "Helpful" extras a developer added (e.g., a third CLI command not in
  §12).
- Configuration knobs not in `apiwright.config.json` example.
- Error codes / failure classes beyond what spec implies.

### Phase 6 — Inventory the v1.5 deferrals

For every "**Deferred to v1.5:**" line in the spec, verify the codebase
does NOT implement it. Examples:
- §3 line about `e2e` marker reserved — `CanonicalFlow` MUST exist as a
  reserved type only, with NO runtime executor.
- §6 deferred items (session cookies, OAuth flows, HMAC, SigV4, mTLS) —
  these should be absent from `src/auth/`.
- §10 line 699 (management-style report + AI failure triage) — must NOT
  appear in `src/reporting/`.

A v1.5-reserved feature that has runtime code is `⚠️ extra` (scope creep
risk for v1.0).

### Phase 7 — Surface the report

Output the report inline in the response. If the user asks for it as a
file, write it to `./AUDIT_<YYYY-MM-DD>.md`. Do NOT auto-commit.

### Phase 8 — Grill every decision from a user POV (🔥 mandatory)

This phase is what separates a mechanical spec-vs-code diff from an
audit that actually catches scope creep, agent improvisation, stale
assumptions, and bad-default UX. **Default stance: every judgment call
is BAD until the user explicitly ratifies it.** Use 🔥 emoji.

Read the user as a composite of three personas:
- **The QA / SDET** who writes endpoint JSON and runs `apiwright run`.
  Cares about: clear errors, sensible defaults, no surprises, CI
  integration, deterministic output.
- **The Platform / DevEx maintainer** who depends on the framework's
  public API to ship features. Cares about: stable types, no breaking
  changes, predictable extension points, clear deprecation contracts.
- **The Security / Compliance auditor** who signs off the release.
  Cares about: secret-free logs, no eval, no hidden network calls,
  every dependency vendored & scanned, every gate enforced.

For EACH bucket below, emit one 🔥 question per finding. The user must
respond `ratify` / `revert` / `defer` / `escalate` per item.

#### Bucket A — Spec-interpretation calls
For every spec phrase that admits multiple readings, find which
reading we shipped. Examples to grill:
- "Playwright's worker model" (§9 line 638) — pattern or literal dep?
- "HTML rendered locally; opens in browser" (§10 line 675) — auto-
  launch or "user opens file"?
- "JSON sidecar" (§10 line 680) — same filename basename as HTML, or
  separate timestamped names?
- "Default log level is `warn`" (§10 line 684) — applied at runner
  start, or only at CLI bootstrap?
- "Single-instance per name per run" (§5 / §6 registries) — per-
  worker or per-process?
- Any spec example that uses `${secret.*}` — did our shipped resolver
  match the example byte-for-byte?

#### Bucket B — Defaults & magic numbers
Every numeric / string default the framework picks unilaterally is a
contract with the user. Grill:
- Retry: `count:2`, `delay_ms:1000`, `backoff:linear` (spec line 657).
- Workers: default = CPU count (spec line 638). Did we honor this or
  default to 1?
- Log level: `warn` (spec line 684).
- Walk depth cap, regex length cap, JSON depth cap, redactor depth
  cap — any constant > 1 that affects user-visible behavior.
- HTTP timeout (spec is silent — what did we pick?). Connection-
  pool size (silent). DB-query timeout (silent).

For every "spec is silent" default, the question is: **is the default
documented somewhere the user will find?** If not, that's a 🔥
finding.

#### Bucket C — Agent improvisation surface
Walk the merged commits and the `.claude/projects/.../memory/` files.
Find every place an agent made a judgment the user wasn't explicitly
asked about. Examples we already know about:
- `wrapForMarker(strategy, marker, spec?)` 3rd arg optional (Task #9
  PR #15 review).
- `GarbageTokenMangle` specless-mode secrets-scan path (+82 LOC).
- `skipBuiltInEmit` flag on `runOnce` (Task #11 PR #17, to support
  Reporting orchestration).
- Auto-istanbul-ignore additions to silence coverage failures (Task
  #8 remediation; Task #10 + #11 added more).
- "wrong_type" representative value picks (`-1` for number, `false`
  for boolean) — chosen by the runner author, not the catalog.

For each, ask: did the user approve this? Find the conversation point
where they did. If absent → 🔥.

#### Bucket D — Defensive istanbul-ignores
List EVERY `/* istanbul ignore next */` in `src/` (`grep -rn "istanbul
ignore"`). For each, grill:
1. What user-facing behavior happens if this branch fires in prod?
2. Is the justification still accurate, or has the upstream contract
   changed since the comment was written?
3. Is there a real test that could exercise this branch via test seam
   injection? If yes, the ignore is laziness, not justified.

Compare counts vs the recorded baselines:
- Pre-Task-7: ~6 ignores (mostly safe-json + ajv interop).
- Post-Task-7 audit: ~17 ignores in `src/assertions/` (audited + ratified).
- Task #8: ~33 ignores in `src/db/` (audited + ratified by user).
- Task #10/#11: count delta — was it audited?

A growing ignore count is a 🔥 finding unless every new ignore was
ratified.

#### Bucket E — Memory drift
The auto-memory system stores claims about the codebase that can go
stale. For each memory file under
`/Users/ag/.claude/projects/-Users-ag-Projects-apiwright/memory/*.md`:
1. Read the claim.
2. Verify it against current `main` HEAD via `git log` / `Read`.
3. If divergent → 🔥 (memory says X, code says Y).

Especially watch for:
- "Task N COMMITTED as <sha>" claims where the commit was later
  superseded (e.g., rebased, force-pushed, squash-merged).
- "X is open / awaiting merge" claims after the PR was merged or
  closed.
- "Y is deferred to Task N" claims after the deferral was discharged.

#### Bucket F — User-facing UX
For every CLI flag, config key, environment variable, error message,
and report column the user sees, grill:
1. **Discoverability.** Can a confused QA find this via `--help`, the
   README, or the spec? If hidden in source-only docs, 🔥.
2. **Naming consistency.** CLI flag (`--workers`) vs config key
   (`workers`) vs env var (`APIWRIGHT_WORKERS`?) — do they all match?
3. **Error message quality.** Does it name the offending file, field,
   and line? Or is it a bare code like `PARSE_FAILED`?
4. **Default safety.** Is the default a happy-path or a foot-gun?
   (E.g., `retry.strict: false` is the spec default — is that the
   right default? Or does it hide flakiness?)

#### Bucket G — Cross-task deferral honesty
For every item in `project_task10_obligations.md` marked "discharged
in Task N":
1. Read the discharging code.
2. Verify the discharge ACTUALLY satisfies the obligation (not just
   "the file exists").
3. Specifically check the spec wording vs the implementation:
   - Obligation #3 says "every log/report output passes through a
     redactor". Did we wire it for EVERY format (HTML, JUnit, JSON,
     console)? Or only some?
   - Obligation #8 says "verify-then-cleanup ordering". Did we test
     that cleanup runs even when assertions fail?
   - Obligation #10 says "params↔Ref.index encoding contract". Is
     there an end-to-end test exercising this with all 4 engines?

If the discharge is paper-thin (file exists but doesn't actually
discharge), 🔥.

#### Bucket H — Skipped tests / `.todo` / `.skip`
Run: `grep -rn "\.todo\|\.skip\|it\.skip\|describe\.skip" tests/`.
For each match, grill: why? When will it be enabled? Is there a
tracking issue? If "documents a cross-task obligation" (Task #10
pattern), 🟢 fine. Otherwise 🔥.

### Phase 9 — Final synthesis

Always finish with a concrete recommendation:
- **"Ship as-is"** — zero `❌` / `🚨` AND zero unanswered `🔥`.
- **"Block ship until X resolved"** — list `❌` / `🚨` in priority order.
- **"Block ship pending user ratification of Y"** — list `🔥` items
  the user must answer (`ratify` / `revert` / `defer` / `escalate`).
- **"Spec needs clarification on Z"** — list `🔎` ambiguities.

Then ask the user to ratify each 🔥 item explicitly. Don't move on
until they do. Default behavior on no response = `escalate`, NOT
silent `ratify`.

## Hard rules

- **Never speculate**. If a spec phrase is ambiguous, mark `🔎` and ask.
  Don't paper over with "probably means …".
- **Never accept code-without-spec as fine by default**. Every `src/`
  feature gets a yes/no spec-coverage check.
- **Never accept memory as truth without verifying**. A memory line that
  says "X was done in Task N" is a HINT — verify by reading the actual
  code. Memory can be stale.
- **Default-bad on judgment calls**. Every choice that wasn't an
  explicit user-ratified MCQ answer is BAD until ratified now. Don't
  assume "if it was merged, it was approved". Merges happen under
  time pressure; this audit is the second chance to catch silent
  decisions.
- **The user is the customer, not the implementor.** Frame every 🔥
  question from the user's POV ("if I'm a QA hitting this for the
  first time, what would I expect?"), not the implementor's ("we did
  this because it was clean to implement").
- **No grades, only findings.** Don't say "the framework looks great";
  list facts. The user grades.
- **One source of truth, one report**. Don't fragment findings across
  multiple files or messages.
- **Keep the report scannable**. Group by spec section + 🔥 bucket,
  link to file:line where claims are verifiable.

## Things to avoid

- Don't try to "fix" issues during the audit — produce the report
  first, ratify with the user, fix in a follow-up commit.
- Don't add new conventions or rules to the codebase as part of the
  audit. The audit checks adherence to existing rules, doesn't invent
  new ones.
- Don't grade the codebase ("looks great!" / "needs improvement"). Just
  report the gaps factually.
- **Don't soft-pedal 🔥 findings.** If three agents made three
  independent improvisations and merged them, that's three 🔥 items,
  not one. Be sharp. The user asked to be grilled.
- **Don't accept "it works" as a defense.** A working feature that
  contradicts spec or contradicts an MCQ answer is a 🔥. The audit
  exists to catch silently-shipped decisions, not to celebrate green
  CI.

## Related skills

- `e2e-strategy-sdet` — once the audit shows v1.0 is ready, an SDET
  uses APIWright per that skill's guidance.
