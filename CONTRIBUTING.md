# Contributing

Thanks for taking the time. This repository is small on purpose; the rules below
are short for the same reason.

## Getting set up

Installing a package from here needs a `.npmrc` with a GitHub `read:packages`
token — see [README.md](README.md#using-a-package). Working on the repository
itself does not; it's a plain npm workspace.

```bash
npm install
npm test
```

Requires Node 20 or newer. Packages ship ESM only and emit their own type
declarations.

## Making a change

1. Fork and branch from `main`.
2. Keep the change focused — one concern per pull request.
3. Add or update tests. Every package uses [Vitest](https://vitest.dev); run
   `npm test` from the repository root.
4. Run the checks below before pushing.

```bash
npm run typecheck
npm test
npm run check:safety
npm run check:scope
npm run check:gates
npm run check:readme
npm run check:contamination
```

## What CI enforces

| Check | What it means |
| --- | --- |
| `typecheck` / `test` | The usual. |
| `check-public-safety` (tree + artifact) | Refuses credential-shaped strings, committed build output, agent-instruction files, and private identity — in both the git tree and the actual packed tarball. See [SECURITY.md](SECURITY.md). |
| `check-scope` | Every first-party package name matches the scope declared in `package-scope.json`. |
| `check-gates` | Regression tests proving the safety gates still catch planted contamination. |
| `check:readme` / `check:contamination` | Catch README/export drift and internal-convention leakage that no denylist string-match can see. Run unconditionally in CI, including on fork pull requests, since they read only the tree itself. |
| `gitleaks` | Scans full git history, not just your diff. |

On a pull request from a fork, the safety checks run in PARTIAL mode —
repository secrets are unavailable to forks by design. This is expected and is
not something you need to fix. A maintainer re-runs FULL mode before merge.

## Conventions

- **Dependencies:** the default answer is no. A package here should be usable
  without dragging in a tree. Adding a runtime dependency needs a reason in the
  pull request description.
- **No `workspace:*` or `catalog:` protocols.** They are unresolvable for anyone
  outside the workspace that defines them, and the safety gate rejects them.
- **Changelogs** follow [Keep a Changelog](https://keepachangelog.com); packages
  are versioned with [semver](https://semver.org).
- **Public API changes** need the README updated in the same pull request —
  `check-readme-parity.mjs` checks this mechanically for undocumented or
  stale exports.

## Releasing

Maintainers only. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md). Before
proposing any publish, run:

```bash
npm run preflight -- packages/<name>
```

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
