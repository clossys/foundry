# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not through a public issue.

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That opens a private thread visible only
to the maintainers.

Expect an acknowledgement within 7 days. If a report is confirmed, a fix and an
advisory are published together; you will be credited unless you ask otherwise.

Please do not open a public issue, pull request, or discussion describing an
unpatched vulnerability.

## Supported versions

The latest published minor of each package is supported. Fixes are released
forward; there are no long-term support branches.

## Repository security controls

| Control | Status |
| --- | --- |
| Secret scanning | Enabled |
| Secret scanning push protection | Enabled — a push containing a recognised credential is rejected at the remote, not reported after it lands |
| `gitleaks` over full history | Runs in CI on every pull request and push |
| `check-public-safety` | Required check on every pull request |
| `check-name-collision` | Required before every publish — see below |

## The publish-safety gate

`scripts/check-public-safety.mjs` exists because this repository intends
every package it ships to be safe for a public, external audience. It
refuses a tree that contains:

- **Forbidden files** — agent instruction files (`CLAUDE.md`, `AGENTS.md`,
  `.claude/`, `.codex/`), changelogs carrying internal references, `.npmrc`,
  `.env*`, private keys, and committed build output (`dist/`, `build/`,
  `.next/`, `coverage/`). One deliberate exception: this repository's own
  root `AGENTS.md` — the file governing contributions here — and root
  `CLAUDE.md` compatibility loader are exempt by exact path. They are
  purpose-written for this public repository and content-scanned like
  everything else; only their filenames are excused from the forbidden-file
  rule. A package-level or otherwise-nested `AGENTS.md` or `CLAUDE.md` is
  still refused outright. Build output is the subtle one:
  it can embed resolved local paths and other detail from wherever it was
  compiled.
- **Credential-shaped strings** — provider API keys, tokens, private keys,
  database URLs, JWTs. Matching lines are reported by file and line number but
  never echoed, so the gate cannot leak a secret into a CI log.
- **Private identity** — names, domains, handles and internal paths that
  must never become public.

A separate gate, `scripts/check-artifact-safety.mjs`, runs the same scan
against the actual packed tarball rather than the git tree — `dist/` is
gitignored (so the tree scan never sees it) but ships to every consumer, and
compiled output can carry a leak the source never did.

### Why the denylist is not in this repository

A denylist is a list of exactly the strings that must never be public. Committed
here, it would publish them — readable by anyone and indexed by code search. So
the terms live outside the repository and are loaded at run time, from exactly
one of:

1. `--denylist <file>`
2. `$PUBLIC_SAFETY_DENYLIST` — CI writes a repository secret to a temp file

There is no generic on-disk default (there used to be one, at
`~/.config/public-safety/denylist.json`; it was removed because a machine that
also works with another repository's denylist would silently load that file —
same name, wrong terms — and report a confident FULL-mode pass that never
actually checked this repository's real identity terms). Neither source
present is treated exactly like a denylist that fails to parse: PARTIAL mode,
below.

### FULL and PARTIAL mode

Pull requests from forks cannot read repository secrets, so the gate runs
without a denylist there. That is **PARTIAL** mode: forbidden files, structural
rules and secret detection still apply, but identity checks are skipped. Partial
mode prints a banner and never claims a tree is cleared for publication.

`--require-denylist` turns a missing denylist into a hard failure (exit 2). The
publish workflow uses that flag, so a release can never pass on a degraded scan.

Both modes are advisory in one direction only: the gate can prove a tree dirty,
never prove it clean. Human review before a first publish is still required.

## The name-collision gate

`scripts/check-name-collision.mjs` guards a different failure mode entirely:
GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name this org already owns under a different
repository does not fail — it silently appends a version to that package and
moves its `latest` dist-tag, with no error to signal the mistake. See
`docs/DECISIONS.md` for the full reasoning.

Because this org (`vespeneventures`) was created specifically to own this
repository and nothing else, this gate should never legitimately fire here —
but a gate that only runs when someone remembers a check is "probably
unnecessary" isn't a gate, so it runs before every publish regardless.
