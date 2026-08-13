# Contributing

Thanks for taking the time. This repository is small on purpose; the rules below
are short for the same reason.

## Getting set up

Installing a package from here needs a `.npmrc` with a GitHub `read:packages`
token — see [README.md](README.md#installing). Working on the repository
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
npm run check:workspace-links
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
| `check:workspace-links` (`workspace link integrity` in CI) | Every first-party `dependencies` range still covers its sibling's real on-disk version, and `package-lock.json` resolves every first-party package as a local workspace link, never a remote registry URL. See "0.x dependency ranges are minor-locked" below for the defect this exists to catch. |
| `gitleaks` | Scans full git history, not just your diff. |

On a pull request from a fork, the safety checks run in PARTIAL mode —
repository secrets are unavailable to forks by design. This is expected and is
not something you need to fix. A maintainer re-runs FULL mode before merge.

## Conversation surface

Everything above runs against files. None of it runs against an issue, a
pull request description, or a comment — those aren't in the git tree, so
`check-public-safety` and `gitleaks` never see them, no matter how careful
the diff itself is. This repository learned that the hard way: a
conversation-history audit found private-identity findings sitting in
issues and comments while every commit stayed clean.

Treat what you type into an issue, a PR description, or a comment as public
and permanent from the moment you hit submit — more permanent, in one way,
than a commit: GitHub emails the full text to every watcher immediately,
before anything has had a chance to check it. If you edit or delete it
afterward, the email already went out, and GitHub keeps the prior revision
visible in that issue or comment's own edit-history dropdown. Fixing it
after the fact reduces exposure; it does not undo it.

Practically:

- Open issues and pull requests through the templates in
  `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md`. Each
  leads with a short "never post this" list (private sibling repo/product
  names, private npm scopes, cross-repository references to private repos,
  absolute local filesystem paths, credentials, client/personal names) —
  read it before you write anything, not after.
- `.github/workflows/conversation-safety.yml` re-checks issue, comment, and
  PR-description text after it posts and applies the `public-safety` label
  to a finding. It posts no comment — on a public repository that reply
  would itself advertise that this text holds something private, and point
  at the edit history where the original still is. If your issue or PR gets
  that label, the redacted category and count are in the workflow run log. It
  is a tripwire, not a gate — by the time it runs, the text has already been
  emailed to everyone watching. Do not rely on it instead of checking your
  own draft; if you want to check before posting, run
  `PUBLIC_SAFETY_DENYLIST=~/.config/public-safety/denylist-foundry.json node scripts/check-conversation-safety.mjs --file <draft.txt>` yourself first.
- Found a security vulnerability instead of a bug? Don't put it in a public
  issue or PR at all — see SECURITY.md's private vulnerability reporting.

## Conventions

- **Dependencies:** the default answer is no. A package here should be usable
  without dragging in a tree. Adding a runtime dependency needs a reason in the
  pull request description.
- **Supported configurations: the default answer is also no — be opinionated
  about the foundation instead.** Where a package does depend on something,
  it picks one and requires it, rather than supporting every environment an
  adopter might have. `@vespeneventures/ui` requires Tailwind v4; that is a
  deliberate choice, not a gap waiting to be closed.

  This is a cost argument, not a taste argument. A second supported path is
  never one feature: it is a second test matrix, a second override-precedence
  story, and a second thing to keep in sync on every future change — paid
  forever, by everyone, on work unrelated to why it was added. Two paths that
  each get half the attention are worse than one that gets all of it.

  So a proposal to "also support X" needs the same evidence a new package
  needs: a real consumer that needs it, not a hypothetical adopter who might.
  Speculative compatibility is cheap to add and expensive to keep. A proposal
  to ship a second, non-Tailwind styling path for `ui` was declined on exactly
  these grounds (#174).

  The obligation this creates: **if you require something, say so loudly when
  it is missing.** Requiring a prerequisite is legitimate; failing silently
  when it is unmet is not — that turns a setup error into a debugging session
  in someone else's codebase, and it is the same
  absence-of-signal-looks-like-a-passing-signal failure described in the
  entry below. Loudly means a thrown error or console output, never something
  rendered into the page: a startup banner injected into every page load was
  itself a defect, removed in #148.
- **Gate CLIs exit `0` clean / `1` findings / `2` could not run — `2` is not a
  variant of failure.** Every gate CLI in this repo follows this three-state
  contract: `packages/ui/src/cli.ts` and `packages/ui/src/token-gate.ts`
  (returns `2` when zero files were scanned, before findings are even
  possible), `packages/copy/src/cli.ts`, `packages/strategy/src/cli.ts`, and
  `scripts/check-release-readiness.mjs` all agree on it. `2` means the gate
  never formed an opinion — a git or npm failure, a directory it couldn't
  read, a scan that matched nothing — and is the only thing that
  distinguishes "I checked and it's fine" from "I never checked." Collapsing
  `2` into `0` reports a clean pass for work that never happened; collapsing
  it into `1` reports a finding that doesn't exist. A new gate should reuse
  this contract rather than inventing its own exit-code scheme.

  This is what makes the contract load-bearing, not decorative: **a check
  that cannot run must fail (`2`), never pass (`0`).**
  `scripts/check-release-readiness.mjs` shipped exactly the opposite — discovering zero packages to
  check exited `0`, and an existing test asserted that as intended, so the
  defect was encoded as correct. A renamed `packages/` directory or a glob
  broken by a refactor would have reported every package release-ready on
  the strength of having examined none. Fixed in `01bd520`. The reasons
  generalize past this one script:
  - Absence of signal is indistinguishable from a passing signal. A gate
    that reports success by never executing looks exactly like a gate that
    executed and found nothing.
  - A gate never observed failing is indistinguishable from a gate that
    cannot fail. If you've never seen a check go red, you don't know it
    works.
  - A guard must state where control goes when it declines. "Nothing,"
    "skip," and an implicit fall-through are never acceptable outcomes for
    a decline path.
  - The decline path gets written last, with the least attention, by
    someone who already believes the hard part is done. That's why this is
    a written rule and not a matter of care.

  Reuse the existing mechanism rather than reinventing this per gate:
  `packages/governance/src/gates/types.ts`'s `FoundationReport.complete` is
  `true` only when `catalog.skipped` is empty, and
  `packages/governance/src/catalog/build.ts` pushes every unreadable or
  unparseable path onto `skipped` instead of dropping it — the decline case
  is data, not silence.
- **No `workspace:*` or `catalog:` protocols.** They are unresolvable for anyone
  outside the workspace that defines them, and the safety gate rejects them.
- **0.x dependency ranges are minor-locked — both `^` and `~`.** Packages
  here depend on each other with plain semver ranges against 0.x versions
  (e.g. `"@vespeneventures/governance": "^0.3.0"`). Past `1.0.0`, `^` locks
  the major and `~` locks the minor; below `1.0.0` there is no such split —
  `^0.3.0` and `~0.3.0` both mean `>=0.3.0 <0.4.0`. Bumping a package's minor
  (e.g. `governance` from `0.3.0` to `0.4.0`) therefore breaks every sibling
  that still declares the old range, silently: npm stops linking the local
  workspace copy and resolves the sibling from the registry instead, and the
  tokenless CI job 401s trying to fetch it. If you bump a package's minor,
  update every dependent's declared range to cover the new version AND bump
  those dependents' own versions too — their `package.json` is packed
  content, so `check:release-readiness` will demand it regardless.
  `check:workspace-links` (`workspace link integrity` in CI) is the gate
  that catches a missed range or a lockfile a range fix forgot to
  regenerate — see `scripts/check-workspace-links.mjs`'s own header for the
  full failure mode.
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
