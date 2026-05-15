# Quickstart

**APIWright** is a self-hosted, declarative API testing framework. Author endpoints in JSON or import from Postman/OpenAPI; APIWright auto-generates and runs a comprehensive test catalog covering HTTP semantics, schema validation, auth boundaries, input validation, and database state verification.

This file gets you from cloning the repo to your first contribution. For the full story, see `V1_BUILD_SPEC.md` (what APIWright is) and `.claude/README.md` (how the development pipeline works).

---

## Prerequisites

- **Node.js 22 LTS** — verify with `node --version` (should be v22.x).
- **Docker** — required for running E2E tests and building the production image.
- **Claude Code** — required for working with the agent pipeline. A Claude Pro or Max plan covers it.
- **Git** — obviously.

Optional but recommended:

- **`gh` CLI** — for opening PRs from the terminal instead of the browser.
- **`semgrep`** — for running security checks locally before commit (`pip install semgrep`). CI will run it regardless; local installation just gives you faster feedback.

---

## First-Time Setup

```bash
git clone <repo-url>
cd apiwright
npm install
npx husky install              # activates the pre-commit hook
```

That's it. The pre-commit hook now runs `security-auditor` and `code-quality-enforcer` checks before every commit, blocking the commit if anything fails.

---

## Start Working

Open the repo in Claude Code and type:

```
Activate conductor. Run the phases for <your goal>.
```

The conductor reads `.claude/PHASES.md` and walks you through each of the ten phases of work, **pausing at every review gate for your explicit approval**. Nothing — no agent invocation, no commit, no push, no release — happens without your say-so. You approve, revise, or halt at every gate.

---

## Daily Loop (Reference)

| You're about to... | Say to the conductor |
|---|---|
| Start a new feature or section of the spec | `Activate conductor. Run the phases for <goal>.` |
| Resume earlier work | `Activate conductor. Resume at Phase <N> for task <task-id>.` |
| Don't remember where you left off | `Activate conductor. Continue from the current state.` |
| Just want a code review on the current diff | `Activate conductor. Run Phase 7 against the current diff.` |
| Cut a release | `Activate conductor. Run Phase 10 for release v<X.Y.Z>.` |

You will never need to invoke individual agents directly. The conductor handles that.

---

## What to Read Next

In rough order of usefulness for a new contributor:

1. **`.claude/PHASES.md`** — the canonical playbook. Ten phases, ten review gates. Read this once and you'll understand the entire workflow.
2. **`.claude/README.md`** — how the nine specialized agents fit together, what each one does, and when the conductor invokes which.
3. **`V1_BUILD_SPEC.md`** — the technical specification. What APIWright is, what it tests, what it doesn't, and what ships in v1.0.

For deeper reference once you're working:

- **`.claude/agents/*.md`** — one file per agent, describing exactly what that agent does and how it produces output.
- **`docs/`** — user-facing documentation for the framework itself (separate from agent docs).
- **`configs/`** — ESLint, Prettier, Vitest, and Semgrep configurations enforced by the pipeline.

---

## Getting Help

| Stuck on... | Read this |
|---|---|
| The agent pipeline workflow | `.claude/README.md` and `.claude/PHASES.md` |
| What a specific agent does | `.claude/agents/<agent-name>.md` |
| The framework's design and architecture | `V1_BUILD_SPEC.md` |
| Why a check is failing | The check's output usually tells you; if not, the relevant agent file lists what it enforces |
| Anything else | Open an issue with the `question` label |

---

## A Note on Control

You are always in the loop. **The pipeline is human-gated, not autonomous.** The conductor proposes, you decide. Every commit, every push, every release requires your explicit approval — and for state-changing actions, two confirmations: once at the review gate (approving the content) and once before execution (approving the command). This is by design.

If at any point you want to stop, type `halt` at any review gate. The pipeline stops cleanly; your working state is preserved; the conductor tells you exactly how to resume later.
