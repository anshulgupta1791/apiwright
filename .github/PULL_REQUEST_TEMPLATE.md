<!--
Thanks for the PR! A few quick checks make review faster:

- One concern per PR (refactor in its own PR, feature in another).
- Conventional commit prefix in the title:
  feat: / fix: / docs: / chore: / refactor: / test: / build: / ci:
- Close issues with "Closes #N" / "Fixes #N" so they auto-link.
- CI must be green (lint / typecheck / tests / coverage / semgrep / gitleaks).
-->

## Summary

<!--
What does this PR do, in 1-3 bullets? Frame around the *user-visible*
change, not just the code touched.
-->

-
-
-

## Why

<!--
What problem does this solve? Why this approach (vs. alternatives you
considered)? If there's a referenced issue, link it.
-->

## What changed

<!--
A short table or list of the files / areas touched. Helps reviewers
chunk the diff.
-->

## Risk

<!--
What could break? Production-affecting? Breaking change? Behaviour
change that users might notice? "Low — pure docs, no runtime change"
is a fine answer when it's true.
-->

## Test plan

<!--
Concrete steps you took to verify (or that the reviewer should take).
Tick what you've done; the others stay as TODO for the reviewer.
-->

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (`--max-warnings 0`)
- [ ] `npm test` passes
- [ ] `npm run test:coverage` ≥ 95 % on every metric
- [ ] Pre-commit hook ran (gitleaks + npm audit + lint + typecheck + tests-with-coverage)
- [ ] Manually verified the user-visible behaviour
- [ ] Docs updated (if behaviour changed)

## Screenshots / output (if relevant)

<!--
For docs / report changes / CLI output changes — paste a screenshot
or a "before/after" code block.
-->

## Follow-ups (optional)

<!--
Anything intentionally out of scope for this PR that a reviewer might
otherwise ask about.
-->

🤖 Generated with [Claude Code](https://claude.com/claude-code) — *delete this line if not applicable.*
