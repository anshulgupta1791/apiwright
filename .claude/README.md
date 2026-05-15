# APIWright Agentic Development Pipeline

This directory configures a strict, sequential agent pipeline for developing APIWright, orchestrated by a **conductor agent** that pauses at every review gate for explicit human approval.

**Three documents form the system:**

1. **`PHASES.md`** — the canonical playbook. Lists every phase, sub-task, agent assignment, and review gate. This is the source of truth for how work flows.
2. **`agents/00-conductor.md`** — the conductor agent. Reads `PHASES.md` and invokes other agents one at a time. Pauses at every review gate. Never commits, pushes, or releases autonomously.
3. **`agents/01-`...`09-`*.md** — the nine worker agents. Each does one thing well. The conductor invokes them; they don't invoke each other.

**Nothing happens without your explicit approval. You are in control at every gate.**

---

## Quick Start

Open Claude Code in your APIWright repo and type one of these:

| Situation | Invocation |
|---|---|
| Starting new work | "Activate conductor. Run the phases for `<your goal>`." |
| Resuming earlier work | "Activate conductor. Resume at Phase `<N>` for task `<task-id>`." |
| Lost context | "Activate conductor. Continue from the current state." |

The conductor will read `PHASES.md`, inspect repo state, and walk you through each phase. At every review gate, you approve, revise, or halt.

## Pipeline Stages

```
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ 1. task-decomposer   │───▶│ 2. solution-         │───▶│ 3. test-engineer     │
│ (Opus)               │    │    architect (Opus)  │    │ (Sonnet)             │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
                                                                   │
                                                                   ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ 6. code-reviewer     │◀───│ 5. code-quality-     │◀───│ 4. implementation-   │
│ (Opus, local-invoke) │    │    enforcer (Sonnet) │    │    engineer (Sonnet) │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
           │
           ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ 7. security-auditor  │───▶│ 8. docs-and-examples-│───▶│ 9. integration-and-  │
│ (Opus, blocking      │    │    writer (Sonnet)   │    │    release-engineer  │
│ pre-commit + CI)     │    │                      │    │  (Opus, local-invoke)│
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

**Agents 1–5, 7, 8 run automatically** (via Claude Code routing or pre-commit hook).
**Agents 6 and 9 are invoked manually in v1.0** from your local Claude Code session — the Max plan covers them there. Autonomous CI activation for these two agents is a future iteration that requires Anthropic Console API credentials.

## Automation Touchpoints

| Trigger | Action |
|---|---|
| Working in Claude Code on a task | Pipeline agents 1→5 activate automatically based on YAML frontmatter routing. |
| `git commit` | `.husky/pre-commit` runs security-auditor + code-quality-enforcer locally; blocks commit on failure. |
| Pull request opened | `.github/workflows/security-gate.yml` runs security checks; merge blocked until they pass. |
| Comment `/review` on PR (v1.0) | Manual: run the **code-reviewer** agent inside your local Claude Code session against the PR diff. Post the agent's output as a PR comment yourself. A GitHub Actions automation for `/review` is planned for a later iteration once API credentials are wired up. |
| Git tag `v*` pushed (v1.0) | Manual: run the **integration-and-release-engineer** agent inside your local Claude Code session to perform the release checklist. The agent walks you through each step (full test suite, Docker build, E2E scenario, etc.) and you execute the commands. |

### Why some triggers are manual in v1.0

The code-reviewer and integration-and-release-engineer agents are the most expensive in the pipeline — they require Claude API access for autonomous CI execution. Running them autonomously in GitHub Actions would require an Anthropic Console API account with per-token billing ($10–30/month at moderate PR traffic), separate from the Claude Max plan used for interactive development.

For v1.0, both agents are invoked from inside Claude Code sessions on the developer's machine, where the Max plan's included usage covers them. This trades a small amount of automation convenience for zero additional infrastructure cost. The agent files themselves are designed to work in either context; switching to autonomous CI invocation later is a configuration change, not a redesign.

## Pipeline Invariants

These rules apply to **every** agent in the pipeline. Violations halt the pipeline.

- **Strict 95% coverage minimum** for unit tests on business logic. No file may drop below 95% branch coverage. CLI entry points and platform-specific error handlers may be marked `/* istanbul ignore next */` only with explicit justification in the comment.
- **No monolithic files.** Soft limit 300 lines per source file; hard limit 500 lines. Classes live in their own files. Shared utilities extracted to dedicated modules.
- **DRY enforced.** Duplicate logic detected by code-quality-enforcer triggers refactor before the pipeline proceeds.
- **OOP where appropriate.** Pluggable interfaces (auth strategies, DB connectors, importers, reporters) use classes implementing TypeScript interfaces. Composition over inheritance.
- **TSDoc on every exported class and method.** Description, per-param description, return description. Enforced by `eslint-plugin-jsdoc`.
- **Imports at top of file.** No inline `require()` or dynamic `import()` except where strictly necessary (lazy loading documented in a comment).
- **100-character line length.** Enforced by Prettier + ESLint.
- **Integration tests use locally-served fixtures**, not live web APIs. Real API responses are recorded once and replayed via MSW (Mock Service Worker). A nightly job re-records to detect upstream drift.

## Agent Files

| # | File | Role |
|---|---|---|
| 0 | `agents/00-conductor.md` | **Orchestrator.** Reads PHASES.md, invokes others, pauses at every gate. |
| 1 | `agents/01-task-decomposer.md` | Atomic task breakdown |
| 2 | `agents/02-solution-architect.md` | Interface and type design |
| 3 | `agents/03-test-engineer.md` | Tests before code |
| 4 | `agents/04-implementation-engineer.md` | Code that satisfies tests |
| 5 | `agents/05-code-quality-enforcer.md` | Style, docstrings, structure |
| 6 | `agents/06-code-reviewer.md` | Semantic review (local invocation) |
| 7 | `agents/07-security-auditor.md` | Security gate, blocks commit |
| 8 | `agents/08-docs-and-examples-writer.md` | User-facing docs |
| 9 | `agents/09-integration-and-release-engineer.md` | E2E tests + release (local invocation) |

## How to Use

**The simple answer: always start by activating the conductor.**

```
"Activate conductor. Run the phases for <goal>."
```

The conductor reads `PHASES.md` and walks you through every phase. You approve, revise, or halt at every gate. No agent runs without your explicit permission.

**You never need to know which agent to invoke when** — the conductor handles that. You only need to know:

1. **What you want done** (a feature, a section of the spec, a bug fix).
2. **When to approve vs revise vs halt** at each gate (the conductor explains each gate's options).

### Triggers that work automatically (no conductor needed)

| Trigger | What runs | Why no conductor |
|---|---|---|
| `git commit` | `.husky/pre-commit` runs security-auditor + code-quality-enforcer locally; blocks commit on failure. | These are deterministic checks, not Claude agents. The pre-commit hook IS the gate. |
| Pull request opened | `.github/workflows/security-gate.yml` runs security checks; merge blocked until they pass. | Same — deterministic CI checks. |

### Triggers that require local agent invocation via the conductor

| Situation | What you ask the conductor for |
|---|---|
| Pre-PR code review | "Activate conductor. Run Phase 7 against the current diff." |
| Cutting a release | "Activate conductor. Run Phase 10 for release v1.0.0." |
| Updating docs | "Activate conductor. Run Phase 9 against the current branch." |

## Failure Handling

When any agent or check fails:

- Inside Claude Code: the active agent reports the failure and halts. The previous-stage agent is re-invoked if the failure indicates upstream input was insufficient.
- At commit time: the commit is rejected with a clear error message naming the failed check.
- In CI: the workflow fails; the PR is blocked from merge. Logs and check outputs are surfaced in the PR conversation.

No agent has authority to bypass the pipeline. Skipping a stage requires explicit human override via commit message tag (`[skip-checks: reason]`), which is logged and surfaces in PR review.
