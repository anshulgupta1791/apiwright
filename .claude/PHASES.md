# APIWright Development Phases

This file is the **source of truth** for how work flows through the agent pipeline. The conductor agent (`.claude/agents/00-conductor.md`) reads this file and invokes the listed agents in order, pausing for human approval at every gate marked **REVIEW GATE**.

**Nothing is committed, pushed, or released without your explicit approval at each gate.**

---

## How to Use This File

1. In Claude Code, invoke the conductor: **"Activate conductor. Run the phases for `<your goal>`."**
2. The conductor reads this file, starts at Phase 1, and invokes the first agent listed.
3. After each agent's output, the conductor pauses at a REVIEW GATE. It shows you what was produced and asks for your decision: **approve** (proceed), **reject** (re-run agent with notes), or **halt** (stop the pipeline).
4. You stay in control at every gate. No commits, pushes, or releases happen autonomously.

---

## Phase 1 — Plan the Work

**When to run this phase:** You're starting work on a new feature, a module, or a section of `V1_BUILD_SPEC.md`.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 1.1 | Decompose the target scope into atomic tasks | `task-decomposer` | One YAML file per task in `.tasks/pending/` |

### REVIEW GATE 1.A — Approve the task list

**The conductor shows you:** the full list of generated tasks with their IDs, titles, dependencies, and complexity estimates.

**You decide:**
- **Approve all** → proceed to Phase 2 with this task list.
- **Approve some** → tell the conductor which tasks to keep; discard the rest.
- **Re-decompose** → tell the conductor what was wrong (too coarse, missing scope, etc.) and it re-invokes `task-decomposer` with your guidance.
- **Halt** → stop the pipeline.

---

## Phase 2 — Design One Task

**When to run this phase:** Phase 1 approved. You pick ONE task from the approved list to work on next.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 2.1 | Design the chosen task's solution | `solution-architect` | Design document at `.tasks/design/<task-id>.md` |

### REVIEW GATE 2.A — Approve the design

**The conductor shows you:** the full design document — type definitions, public API, internal structure, error handling, edge cases, integration points.

**You decide:**
- **Approve** → proceed to Phase 3.
- **Revise** → describe what's missing or wrong; conductor re-invokes `solution-architect`.
- **Halt** → stop, return to Phase 1 if the task needs re-decomposition.

---

## Phase 3 — Write the Tests (TDD Red Phase)

**When to run this phase:** Phase 2 design approved.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 3.1 | Write failing unit and integration tests against the design | `test-engineer` | Test files under `tests/unit/` and `tests/integration/` |
| 3.2 | Run the new tests and confirm they fail for the right reason (the code doesn't exist yet) | conductor runs `npm test -- <module>` and shows you the output | Test failure output |

### REVIEW GATE 3.A — Approve the test suite

**The conductor shows you:** the test files written, the test failure output, and a coverage projection.

**You decide:**
- **Approve** → proceed to Phase 4.
- **Add tests** → describe missing scenarios; conductor re-invokes `test-engineer`.
- **Halt** → stop, return to Phase 2 if the design has gaps the tests reveal.

---

## Phase 4 — Implement Until Tests Pass (TDD Green Phase)

**When to run this phase:** Phase 3 tests approved.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 4.1 | Write minimum code to pass the failing tests | `implementation-engineer` | Source files under `src/` |
| 4.2 | Run the test suite and confirm all tests now pass | conductor runs `npm test -- <module> --coverage` and shows the output | Test pass output + coverage report |
| 4.3 | Verify coverage hits 95% on the changed files | conductor checks the coverage report | Coverage delta |

### REVIEW GATE 4.A — Approve the implementation

**The conductor shows you:** files changed, tests passing, coverage at or above 95%.

**You decide:**
- **Approve** → proceed to Phase 5.
- **Coverage below 95%** → return to Phase 3 (test suite is incomplete, not the code).
- **Halt** → stop, return to Phase 2 if the design is wrong.

---

## Phase 5 — Quality Gate

**When to run this phase:** Phase 4 implementation approved.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 5.1 | Run static quality checks (TSDoc, imports, line length, file size, DRY, OOP, TypeScript strictness) | `code-quality-enforcer` | Pass/fail report |
| 5.2 | If any check fails, return to Phase 4 with the violation report; the conductor loops back automatically | n/a | Violation report (if applicable) |

### REVIEW GATE 5.A — Approve quality gate passed

**The conductor shows you:** the quality report. If it passed, the conductor confirms before proceeding. If it failed, the conductor automatically returns to Phase 4 — but informs you and asks before re-invoking the implementation-engineer.

**You decide:**
- **Approve (pass)** → proceed to Phase 6.
- **Approve auto-fix loop** → conductor returns to Phase 4 with the violation report.
- **Halt** → stop the pipeline.

**Phases 2–5 repeat for each task in the approved task list from Phase 1 before moving to Phase 6.**

---

## Phase 6 — Pre-Commit Verification

**When to run this phase:** All tasks in scope have completed Phase 5.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 6.1 | Show the full diff of staged changes | conductor runs `git diff --staged` | Diff output |
| 6.2 | Dry-run the security-auditor checks (so you see what the pre-commit hook will see) | `security-auditor` | Pass/fail report |
| 6.3 | If any security check fails, stop and surface the findings to you for resolution | n/a | Findings (if applicable) |

### REVIEW GATE 6.A — Approve the commit

**The conductor shows you:** the staged diff, the security audit report, and the proposed commit message (Conventional Commits format).

**You decide:**
- **Approve** → conductor runs `git commit` with the proposed message. Pre-commit hook runs (re-runs the same checks). On success, commit lands.
- **Edit message** → you provide a different commit message; conductor commits with that.
- **Halt** → stop. Nothing is committed.

**The conductor does NOT commit autonomously. You explicitly approve every commit.**

---

## Phase 7 — Code Review (Local)

**When to run this phase:** All commits for the PR scope are made; you're preparing to open the PR.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 7.1 | Compute the diff against `main` | conductor runs `git diff main...HEAD` | Diff output |
| 7.2 | Run semantic code review against the diff | `code-reviewer` | Review report (blocking issues, concerns, suggestions) |

### REVIEW GATE 7.A — Approve the review

**The conductor shows you:** the full review report.

**You decide:**
- **Address blocking issues** → return to Phase 2 (likely) or Phase 4 (if minor) to fix.
- **Approve with concerns acknowledged** → conductor proceeds to Phase 8.
- **Halt** → stop.

---

## Phase 8 — Open the Pull Request

**When to run this phase:** Phase 7 review passed.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 8.1 | Generate a PR description from the commit history and review output | conductor synthesizes | PR description draft |
| 8.2 | Stage the branch for push | conductor runs `git status` to confirm what will be pushed | Branch status |

### REVIEW GATE 8.A — Approve the PR push

**The conductor shows you:** the PR description draft, the branch name, the target branch.

**You decide:**
- **Approve** → conductor runs `git push -u origin <branch>`. **The conductor does NOT open the PR via the GitHub API.** You open the PR yourself in the GitHub UI (or via `gh pr create`) using the prepared description. This is intentional — opening the PR is the last "this is going public" gate and stays a human action.
- **Edit description** → you provide changes; conductor updates the draft.
- **Halt** → nothing is pushed.

---

## Phase 9 — Documentation Sync

**When to run this phase:** PR has been opened (or you're preparing to). Documentation must be updated to reflect what shipped.

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 9.1 | Update `V1_BUILD_SPEC.md`, `README.md`, `docs/`, `examples/`, `CHANGELOG.md` to match what shipped | `docs-and-examples-writer` | Doc changes in the same branch |

### REVIEW GATE 9.A — Approve the doc updates

**The conductor shows you:** the doc diff.

**You decide:**
- **Approve** → conductor returns to Phase 6 (commit), Phase 7 (review of docs changes), Phase 8 (push) for the documentation commit.
- **Revise** → describe changes; conductor re-invokes `docs-and-examples-writer`.
- **Skip** → tell the conductor docs don't need updating for this PR (rare, usually only for internal refactors).
- **Halt** → stop.

---

## Phase 10 — Release (Only When Cutting a Version)

**When to run this phase:** Not on every PR. Only when you're tagging a version (e.g., v1.0.0).

### Tasks

| # | Sub-task | Agent | What gets produced |
|---|---|---|---|
| 10.1 | Run full E2E test suite, Docker image build with vulnerability scan, E2E scenario against Docker Compose, CI example validation, backward-compatibility check | `integration-and-release-engineer` | Release checklist results |
| 10.2 | Generate release notes from CHANGELOG entries since last release | `integration-and-release-engineer` | Release notes draft |

### REVIEW GATE 10.A — Approve the release

**The conductor shows you:** the full release checklist results, the proposed version number, and the release notes draft.

**You decide:**
- **Approve** → the conductor walks you through each release command (one at a time, each with its own micro-confirmation): `git tag v1.0.0`, `git push --tags`, `docker build`, `docker push`. You execute each yourself or approve the conductor to execute it. Conductor does NOT publish autonomously.
- **Revise notes** → describe changes; conductor updates.
- **Halt** → nothing is released.

---

## Halting and Recovery

At any REVIEW GATE you can **halt**. When you halt:

- The conductor stops invoking agents.
- No commits are made.
- No pushes happen.
- Your local changes remain staged or unstaged as they were.
- You can resume later by re-invoking the conductor and telling it where to pick up.

To resume mid-pipeline: invoke the conductor and say **"Resume at Phase X for task `<task-id>`."** The conductor reads `.tasks/pending/`, `.tasks/design/`, the test files, and the source to determine current state, then picks up at the requested phase.

---

## Phase Summary at a Glance

```
Phase 1  →  task-decomposer                    →  REVIEW GATE 1.A
                       (per task)
Phase 2  →  solution-architect                  →  REVIEW GATE 2.A
Phase 3  →  test-engineer                       →  REVIEW GATE 3.A
Phase 4  →  implementation-engineer             →  REVIEW GATE 4.A
Phase 5  →  code-quality-enforcer               →  REVIEW GATE 5.A
                       (per commit)
Phase 6  →  security-auditor (dry-run) + commit →  REVIEW GATE 6.A
                       (per PR)
Phase 7  →  code-reviewer                       →  REVIEW GATE 7.A
Phase 8  →  push                                →  REVIEW GATE 8.A
Phase 9  →  docs-and-examples-writer            →  REVIEW GATE 9.A
                       (per release)
Phase 10 →  integration-and-release-engineer    →  REVIEW GATE 10.A
```

**Ten phases. Ten review gates. Nothing happens between gates without your approval.**
