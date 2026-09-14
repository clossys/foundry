# Contributing

Thanks for taking the time. This repository is small on purpose; the rules below
are short for the same reason.

## Getting set up

Installing a package from here needs a `.npmrc` with a GitHub **classic**
personal access token carrying `read:packages` — see
[README.md](README.md#installing). Working on the repository
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
npm run check:registry
npm run check:workspace-links
npm run check:gates
npm run check:foreign-references
npm run check:readme
npm run check:contamination
npm run check:typechecked-assertions
```

## Contribution authority

Contributions are accepted under this repository's MIT licence: the licence
for a contribution is the same licence under which the repository distributes
it. This repository currently requires neither a contributor licence agreement
nor Developer Certificate of Origin sign-off.

The provider's authenticated authorship, review, and merge records retain
contribution provenance. Do not add a `Signed-off-by` trailer containing a
personal identity: the public-safety policy deliberately rejects personal
identity in commit messages, just as it does elsewhere in this public tree.
Repository-owned automation and dependency bots retain their provider identity
and pass the same review and safety checks; they do not fabricate a human
certification.

A repository transfer does not retroactively change the licence of earlier
contributions, create a new certification for them, or transfer their
copyright. A later decision to adopt a DCO, a CLA, or another contribution
grant requires a separate reviewed change that reconciles this contribution
guide, the identity-safety boundary, and any enforcement before the new policy
is treated as active.

## Project names and marks

The MIT licence covers the software and documentation. It does not grant a
separate licence to names, logos, or other marks, and this repository does not
declare or assign ownership of any such mark.

A repository or package-namespace transfer moves the approved source and its
administration only. It does not by itself assign copyright or trademark rights,
and it does not imply endorsement by a previous or successor maintainer. Any
later assignment, licence, or project-specific marks policy must be an explicit,
separately reviewed owner action; it is not inferred from a repository transfer,
scope change, registry change, or package publication.

## What CI enforces

| Check | What it means |
| --- | --- |
| `typecheck` / `test` | The usual. |
| `check-public-safety` (tree + artifact) | Refuses credential-shaped strings, committed build output, agent-instruction files, and private identity — in both the git tree and the actual packed tarball. See [SECURITY.md](SECURITY.md). |
| `check-scope` | Every first-party package name matches the scope declared in `package-scope.json`. |
| `check-registry` (`registry drift` in CI) | Every non-private package's `publishConfig.registry` matches the single registry declared in `package-scope.json`. Same single-source-of-truth pattern as `check-scope`, extended to the registry — see `scripts/set-registry.mjs` and [docs/PUBLISHING.md](docs/PUBLISHING.md#current-cutover-constraint). |
| `check-gates` | Regression tests proving the safety gates still catch planted contamination. |
| `check-commit-messages` | Scans commit message text — not file content — against the same identity denylist. A commit message is as public and as permanent as any file it changes, and no tree scan has ever read one. See "Merging without publishing a private address" below for the surface it cannot reach. |
| `check:foreign-references` | The inverse of `check-public-safety`. That gate is a denylist and can only refuse names someone already listed; this one admits only this repository's own account and scope — derived from `package-scope.json` and the manifests' own `repository.url` — and fails every other account-shaped reference (`@scope/name`, and `owner/repo` in a GitHub URL, a workflow `uses:`, or a `gh --repo` argument) by shape. Foundry supplies planes that do not govern each other, so it must never name a consumer, a sibling repository, or any other account. Public infrastructure and fictional placeholders are admitted explicitly, and third-party npm scopes are derived from `package-lock.json` at run time. Runs on fork pull requests too — it needs no denylist. |
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

## Merging without publishing a private address

Maintainers, not contributors: this section is about the merge button, not
about anything a pull request contains.

`scripts/check-commit-messages.mjs` is the one gate here that reads commit
message text rather than file content — the same structural gap the section
above describes, one surface over. It cannot close this one. When GitHub
squash-merges a pull request it composes the squash commit's message
server-side and appends a `Co-authored-by:` trailer per contributor to the
squashed branch, and it builds that trailer from each account's **public
profile email**, not from the address configured on the commits being
squashed. Every local and global git identity in this repository was already
the privacy-preserving forge noreply form the whole time. The profile address
was published anyway, on eight squash merges, because the trailer never reads
the commit's own identity at all. There is no commit for the gate to scan
until the merge has already happened, so this is not a check that was missed —
it is a check that cannot exist at that point.

A squash merge also writes that address into the commit's **author header**
when the merging account is the pull request's author. That is commit metadata
rather than message text, so no gate in this repository reads it — and it is
the bigger surface by an order of magnitude: of the 630 commits reachable from
`main`, 447 carry a non-noreply address there, against 8 in message text. 436
of those 447 were written by GitHub's own web-side merge rather than by a local
`git commit`, which is exactly the operation the account setting governs — so
the setting is the load-bearing fix here and the merge method is the narrower
one.

Two things follow, and the order matters:

- **Enable "Keep my email addresses private" on your own GitHub account.** It
  is the only control that covers both surfaces, it is one setting, and this
  repository cannot check it for you — verifying it would mean naming a
  personal account in a committed file, which is exactly what the identity
  denylist refuses.
- **Merge with a merge commit or a rebase, not a squash.** Neither composes a
  new message, so neither has a trailer-synthesis step for profile data to
  reach. `governance/merge-policy.json` declares this, and
  `npm run check:merge-policy` fails when the forge's settings disagree — but
  the declaration is a stated policy and a drift alarm, never an enforcement
  mechanism: merge methods live in GitHub's settings store, not in this tree.

Do all of this *before* clicking merge. A commit message is exactly as public
and exactly as permanent as any file it changes; editing the pull request
afterwards changes nothing, and only a history rewrite removes it. There is no
equivalent fix after.

## Conventions

- **Dependencies:** the default answer is no. A package here should be usable
  without dragging in a tree. Adding a runtime dependency needs a reason in the
  pull request description.
- **Supported configurations: the default answer is also no — be opinionated
  about the foundation instead.** `@clossys/designer` is the current
  styling authority. Consumers choose one documented Designer entry point:
  `tokens.css` works without Tailwind, while `theme.css` is the optional
  Tailwind v4 wiring for a consumer-owned pipeline. Those explicit surfaces,
  rather than a retired UI package, define the supported styling choices.

  This is a cost argument, not a taste argument. A second supported path is
  never one feature: it is a second test matrix, a second override-precedence
  story, and a second thing to keep in sync on every future change — paid
  forever, by everyone, on work unrelated to why it was added. Two paths that
  each get half the attention are worse than one that gets all of it.

  So a proposal to "also support X" needs the same evidence a new package
  needs: a real consumer that needs it, not a hypothetical adopter who might.
  Speculative compatibility is cheap to add and expensive to keep. The bar is
  evidence, not a permanent no: a proposal to ship a second, non-Tailwind
  styling path for Designer was declined while it was speculative — no real
  consumer needed it (#174) — then reopened once a real external consumer
  requirement existed, and shipped as a narrow, evidence-gated exception
  rather than the original open-ended sketch: `@clossys/designer/
  compiled.css`, a generated stylesheet scoped to `atoms` only (see
  `packages/designer/README.md`'s "Framework-portable components, without
  Tailwind"). Declined, then reopened, then shipped narrowly — that arc, not
  the bare decline alone, is what this convention is actually asking for.

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
  contract: `packages/designer/src/cli.ts` returns `2` when zero files were
  scanned, before findings are even possible; `packages/writer/src/cli.ts`,
  `packages/strategist/src/cli.ts`, and
  `scripts/check-release-readiness.mjs` use the same contract. `2` means the gate
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
  `packages/controller/src/gates/types.ts`'s `FoundationReport.complete` is
  `true` only when `catalog.skipped` is empty, and
  `packages/controller/src/catalog/build.ts` pushes every unreadable or
  unparseable path onto `skipped` instead of dropping it — the decline case
  is data, not silence.
- **No `workspace:*` or `catalog:` protocols.** They are unresolvable for anyone
  outside the workspace that defines them, and the safety gate rejects them.
- **0.x dependency ranges are minor-locked — both `^` and `~`.** Packages
  here depend on each other with plain semver ranges against 0.x versions
  (e.g. `"@clossys/controller": "~0.8.0"`). Past `1.0.0`, `^` locks
  the major and `~` locks the minor; below `1.0.0` there is no such split —
  `^0.3.0` and `~0.3.0` both mean `>=0.3.0 <0.4.0`. Bumping a package's minor
  (e.g. `controller` from `0.8.0` to `0.9.0`) therefore breaks every sibling
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
- **A pull request that only unblocks an issue uses `Refs:`, never a closing
  keyword.** GitHub auto-closes an issue when a merged pull request's title or
  description carries a closing keyword (`Closes`, `Fixes`, `Resolves`, …)
  referencing it — a text pattern the forge applies at merge time, with no
  evidence behind it beyond "some text matched." `docs/LIFECYCLE.md`'s
  standing rule is that state is derived from evidence, never declared, and a
  keyword-driven close is exactly that defect for an issue. This happened
  twice in one day: #811 said, in its own "What this does NOT do" section,
  "Does not close #808," but also carried a closing keyword for #808
  elsewhere in its text — the merge auto-closed #808 anyway, and it had to be
  manually reopened with evidence the underlying condition was still unmet
  (#828). #797/#819 shows the same mechanism landing correctly only by
  chance — the keyword happened to match the real work, not because anything
  checked it against #797's stated done-condition. No gate can enforce this:
  GitHub's keyword-to-closure behavior is a platform feature outside every
  script in this repository, so it depends on the author's own judgement, the
  same as several conventions above. Reserve a closing keyword for a pull
  request whose merge is itself sufficient evidence the referenced issue's
  condition is met; use `Refs: #N` for one that only removes a blocker or
  lands a partial step.
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
  `packages/designer/src/atoms/internal/icon-contract.check.tsx` and
  `packages/designer/src/shell/internal/shell-contract.check.tsx` for the pattern,
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
