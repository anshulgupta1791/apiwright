# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x   | ✅        |
| < 1.0   | ❌ (pre-release) |

## Reporting an issue

If you believe you have found a security-relevant issue in APIWright, please
**do not file a public GitHub issue**. Public issues are visible immediately
and that visibility can put downstream users at risk before a fix is available.

Instead, report it through GitHub's **Private Vulnerability Reporting** at:

**https://github.com/anshulgupta1791/apiwright/security/advisories/new**

Only the project maintainers can see the advisory — it is not visible to
other GitHub users or to search engines until you and the maintainers
publish it together when a fix is ready. No email exchange or other
out-of-band contact is needed.

Helpful details to include in the advisory:

- A description of the issue and the impact you observed.
- The version of APIWright (and Node.js, if relevant) where you reproduced it.
- Steps to reproduce — ideally as a minimal `.endpoint.json` or CLI invocation.
- Any relevant logs or stack traces.

You will receive an acknowledgement on the advisory within **five business
days**.

## Disclosure flow

Once a fix is ready, we coordinate disclosure with the reporter:

1. The reporter is credited in the release notes (unless they request anonymity).
2. A patched release is tagged and an advisory is published via GitHub
   Security Advisories.
3. Users are notified through the release channel.

We aim to land a fix within **30 days** of a confirmed report; complex cases
may take longer, in which case we keep the reporter informed of progress.

## Scope

**In scope**

- The APIWright CLI and its bundled modules (everything under `src/`).
- The published Docker image.
- The published npm package (when one exists).

**Out of scope**

- Issues in third-party dependencies — please report to the upstream project
  first. If APIWright *misuses* a dependency in a way that introduces a
  problem, that's in scope.
- Issues that require attacker control of the user's local machine (e.g.
  "the user can read their own secrets" — APIWright runs as the local user
  by design and trusts that boundary).

## Hardening already in place

- Secret values referenced via `${secret.*}` are redacted in every report
  artifact (JSON, HTML, JUnit, partial-JSONL sidecar) and on the console,
  at every log level.
- Endpoint and environment files are validated against meta-schemas before
  any request is sent.
- The pre-commit hook runs `gitleaks` and `npm audit` to keep accidental
  secret commits and known-issue dependencies out of the tree.
- `prod_safe` defaults gate destructive (write/delete) cases out of
  production runs unless explicitly opted in.
