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
npm run check:typechecked-assertions
```

## What CI enforces

| Check | What it means |
| --- | --- |
| `typecheck` / `test` | The usual. |
| `check-public-safety` (tree + artifact) | Refuses credential-shaped strings, committed build output, agent-instruction files, and private identity — in both the git tree and the actual packed tarball. See [SECURITY.md](SECURITY.md). |
| `check-scope` | Every first-party package name matches the scope declared in `package-scope.json`. |
| `check-gates` | Regression tests proving the safety gates still catch planted contamination. |
| `check:readme` / `check:contamination` | Catch README/export drift and internal-convention leakage that no denylist string-match can see. Run unconditionally in CI, including on fork pull requests, since they read only the tree itself. |
| `check:typechecked-assertions` | Fails if a `@ts-expect-error`, `@ts-ignore`, `expectTypeOf(...)`, or `assertType(...)` lives in a file `tsc` doesn't actually compile — see "Type-level assertions live in `.check.ts(x)` files" below. |
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
- **Type-level assertions live in `.check.ts(x)` files, never in
  `.test.ts(x)` files.** Every package's `tsconfig.json` excludes
  `**/*.test.ts(x)` from `include`, so `npm run typecheck` never compiles a
  test file — `vitest` only transpiles one (strips the types, doesn't check
  them). A `@ts-expect-error`, `@ts-ignore`, `expectTypeOf(...)`, or
  `assertType(...)` written inside a `*.test.ts(x)` file therefore asserts
  nothing: it can never fail, and it never produces the "unused directive"
  error that would normally flag the guarded contract as having changed
  underneath it. If you need a real compile-time contract test, put it in a
  sibling file named `*.check.ts` or `*.check.tsx` instead — that extension
  falls outside the test-file exclude, so it's part of the real `tsc` run,
  the same as any other source file, while staying invisible to `vitest`
  (whose own `include` globs are scoped to `*.test.ts(x)`, not `*.check.*`).
  It should never be imported by `index.ts` or any runtime code — its only
  job is to make `tsc` fail if the contract it encodes regresses. See
  `packages/ui/src/atoms/internal/icon-contract.check.tsx` and
  `packages/ui/src/shell/internal/shell-contract.check.tsx` for the pattern,
  and `scripts/check-typechecked-assertions.mjs` (run as
  `check:typechecked-assertions`) for the gate that fails CI if a directive
  like this ends up in a `.test.ts(x)` file anyway.

## Releasing

Maintainers only. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md). Before
proposing any publish, run:

```bash
npm run preflight -- packages/<name>
```

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
