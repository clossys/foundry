# Contributing

Thanks for taking the time. This repository is small on purpose; the rules below
are short for the same reason.

## Getting set up

Installing a *current* `@clossys` package from the public npm registry needs
no token and no `.npmrc` override — see [README.md](README.md#installing) and
[docs/FIRST-WAVE.md](docs/FIRST-WAVE.md). The historical predecessor-scope
packages on GitHub Packages still need a classic personal access token with
`read:packages`; that authenticated lane is not current installation
guidance. Working on this repository itself is a plain npm workspace and needs
neither.

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

## Merge queue

`main` is protected by GitHub's native merge queue (ruleset `main-required-checks`),
not by hand-merging or a bespoke merge train. Once your pull request has every
required context green and an APPROVE with no later blocking review at its
exact head, a maintainer adds it to the queue (the "Merge when ready" button,
or `gh pr merge --queue`). From there:

1. GitHub forms a merge group: your pull request's head merged with `main`
   plus whatever else is already queued ahead of it, on a temporary ref
   shaped `gh-readonly-queue/main/pr-<number>-<sha>` — `<sha>` there is your
   pull request's own head commit, not the group's synthetic test commit.
2. Every required context re-runs against that merge group, under the
   `merge_group` event rather than `pull_request`. This is deliberately
   stricter than a plain "branch is up to date" check: it tests the exact
   tree that would land, including every entry ahead of yours, not just your
   branch rebased in your head.
3. `verify-standards`'s review-evidence check does not ask you to re-request
   review for the merge group. It parses the merge group's own ref back into
   your pull request's number and head sha (`scripts/collect-review-evidence.mjs
   --merge-group-head-ref`) and evaluates the review recorded at THAT
   commit — the same APPROVE-with-no-later-blocking-review requirement as an
   ordinary pull request, just read from the right place. A review posted
   against a different sha (a stale replay, or a push that landed in
   between) does not count; a malformed or unrecognizable ref refuses to
   collect evidence at all, rather than guessing.
4. If everything is green, GitHub merges your commit into `main` with a
   merge commit and your pull request is marked merged automatically. If
   anything in the group fails, GitHub identifies which entry caused it,
   drops that one, and re-forms the group from the rest — your own commit is
   never touched or rewritten by this process.

Nothing here changes what you do before the queue: push a head you've
verified locally, post `Ready for independent review at <sha>.`, wait for an
APPROVE, and let CI run. The queue only changes what happens after both of
those are true.

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

A web-side merge also writes that address into the commit's **author header**
— the merge commit's own header for `merge`, or the squash commit's for
`squash` — whenever the merging account is the pull request's author. That is
commit metadata rather than message text, so no gate in this repository reads
it, and it is the bigger surface by an order of magnitude: [Decision
21](docs/DECISIONS.md) measures 465 of 667 commits reachable from `main`
carrying a non-noreply address there, against 102 carrying the predecessor
identity in message text ([Decision 20](docs/DECISIONS.md)). See those entries
for the current counts rather than trusting a number pinned in this file — an
earlier version of this paragraph already went stale once, within hours.
Choosing `merge` over `squash` closes the trailer surface above; it does not
close this one, because a plain merge commit's own author header is composed
from the same public profile data a squash commit's is. The account setting
is the load-bearing fix for the header surface regardless of merge method; the
merge-method choice only ever covered the trailer.

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
  this contract rather than inventing its own exit-code scheme. When a single
  run holds both a confirmed finding and something it could not check at all,
  which of `1` and `2` wins is a per-gate choice, not a repository default —
  `docs/DECISIONS.md` entry 23 records how to make it and why two gates here
  answer it opposite ways.

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
- **A test or README sentence that says "every" or "all" must derive that
  set from the tree or from `package.json#exports` (or other live source),
  never from a hand-written literal array.** This is a smaller sibling of
  the gate-exit-code convention above (#914: a check reaching success over
  ground it never examined) — here the ground it never examined is
  whatever got added to the codebase after the list was last hand-updated.
  A literal array enumerating "every module," "every field," or "every
  value" is accurate on the day it's written and silently goes stale as the
  codebase grows: nothing fails, the claim just quietly stops being true.
  #907 found and fixed two instances of exactly this drift —
  `packages/locksmith/src/no-value-escapes.test.ts`'s `NEW_VERB_MODULES`
  had already missed a real module (`controlled-key-rate.ts`) by the time
  it was caught — and `packages/writer/src/voice/schema.test.ts`'s "accepts
  every `VoiceSeverity` value" test that iterated a repeated literal
  instead of the exported `VOICE_SEVERITIES` constant.

  Derive the set instead: scan the directory (`readdirSync`, filtered to
  real source files), read it from `package.json#exports`, or import the
  live constant/array the codebase already exports for that purpose.
  **Also assert the derived set is non-empty.** A derivation that quietly
  resolves to `[]` — a renamed directory, a typo'd path, an import that
  silently returns nothing — makes every test in the loop vacuously pass
  without checking anything, which is its own silent-success failure mode
  and exactly as dangerous as the hand-written list it replaced.

  `packages/writer/src/voice/field-coverage.test.ts` is the canonical
  example in this repository: it derives the bindable field set from
  `VOICE_FIELDS` (a live source in `src/fields.ts`), asserts
  `bindable.length` is greater than zero before using it, and checks
  coverage in both directions (every bindable field appears in the
  template; the template names no field the package doesn't declare).
  `packages/designer/src/internal/peer-guard-coverage.test.ts` is the same
  idea applied to a directory scan and to `package.json#exports` instead of
  a single constant — read its header comment for the reasoning behind
  each derivation it makes.
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
- **A pull request's issue reference is a judgement call, not a safe
  default — and this repository has now paid for both ways of getting it
  wrong.** A closing keyword (`Closes`, `Fixes`, `Resolves`, …) and a plain
  `Refs:` fail in opposite directions:
  - **A closing keyword auto-closes an issue the pull request did not
    actually resolve — and it does not understand negation.** GitHub
    applies it at merge time from a text pattern alone, with no evidence
    behind it beyond "some text matched" — `docs/LIFECYCLE.md`'s standing
    rule is that state is derived from evidence, never declared, and a
    keyword-driven close is exactly that defect for an issue. #811's own
    "What this does NOT do" section reads, verbatim:

        - Does not close #808. It removes the blocker; the registry still
          carries the retired identity until the packages actually publish.

    That sentence's entire purpose is to say the pull request does not
    close #808. GitHub's keyword parser does not read the sentence; it
    matches `close #808` lexically, wherever it sits in the body, and
    closed #808 anyway: the issue's `closed` event is timestamped
    `2026-09-13T21:51:52Z`, one second after #811's own `merged` timestamp
    (`2026-09-13T21:51:51Z`), attributed to the merging account, with no
    associated commit — the signature of an automatic keyword close, not a
    manual one. The body's last edit was `2026-09-13T18:42:05Z`, over three
    hours before the merge, so the sentence quoted above is the text GitHub
    actually parsed, not a later rewrite. Reproduce with
    `gh pr view 811 --json body` and
    `gh api repos/clossys/foundry/issues/808/events`. Two lines later the
    same body also carries `Refs: #808` — the author used the correct form
    for the reference that mattered and was still defeated by the negating
    sentence above it. The lesson: a closing keyword is matched anywhere in
    the body, with no understanding of negation or surrounding prose.
    Writing "does not close #N", "should not close #N", or "this does not
    fix #N" closes #N regardless of the words around it. The only safe way
    to mention an issue a pull request is NOT closing is a form that
    contains no keyword at all — `Refs: #N`, or rephrasing so the keyword
    and the number are never adjacent. The issue still needed a manual
    reopen with evidence the underlying condition was unmet (#828).
    #797/#819 shows the same mechanism landing correctly only by chance —
    the keyword happened to match the real work, not because anything
    checked it against #797's stated done-condition.
  - **`Refs:` leaves a genuinely resolved issue open, indefinitely and
    silently.** #769 was fixed by #777, merged 2026-09-02T15:00:30Z, but
    #769 itself was not closed until 2026-09-14T11:35:36Z — about 12 days
    later (11d 21h). #782 was fixed by #794, merged 2026-09-10T09:44:55Z
    (it sat open as a pull request for six days first — opened
    2026-09-04T04:36:11Z — which is a separate delay from the one this
    entry is about), and #782 itself was not closed until
    2026-09-14T11:35:45Z — about 4 days later (4d 2h). Two different gaps,
    not one repeated number: reproduce both with
    `gh pr view <PR> --json mergedAt` and
    `gh issue view <issue> --json closedAt`, the same way
    `closedByPullRequestsReferences` is checked below. Both pull requests
    wrote `Refs:` rather than a closing keyword, so neither issue's
    `closedByPullRequestsReferences` ever populated
    (`gh issue view 769 --json closedByPullRequestsReferences` and the same
    for 782 both return `[]`), and both sat open after the fix had already
    landed on `main` — found only because an agent was dispatched to fix
    one of them, set up a worktree, and discovered the work already done.
    A silently stale open-issue list is not a smaller failure than a
    wrongly-closed one; it is a quieter failure that accumulates instead of
    getting caught, and it is the one this repository actually paid for at
    that point.

    *Corrected twice, recorded rather than silently overwritten:* an
    earlier draft of this entry gave both issues the same "ten days,"
    conflating #794's *creation* date (2026-09-04) with its *merge* date
    (2026-09-10) and applying the resulting single interval to both pairs;
    the figures above are the measured ones — #769/#777 (≈12 days) and
    #782/#794 (≈4 days) are not the same figure, and #782's total was
    itself two separate delays, not one. A separate earlier draft of the
    keyword bullet above also hedged its #811/#808 citation as merely
    "consistent with" a keyword close, because it took on faith a review
    finding that #811's body carried no closing keyword anywhere — a
    finding that was itself wrong, as the quoted sentence above shows; the
    review had checked for the presence of a keyword without checking
    whether it sat inside a negation. This section has now been wrong
    twice, in opposite directions — once by trusting an unverified figure,
    once by trusting a review's negative result without reading the text it
    was a claim about — and both are recorded here for the same reason the
    section exists.

  Use a closing keyword when the pull request genuinely resolves the whole
  issue; use `Refs: #N` when it only removes a blocker or lands a partial
  step. Neither choice is safe by default — the part that actually matters
  is checking afterward which one happened: did the issue close on merge, or
  is it still open and does it need a manual close with the evidence that
  justifies it? Neither GitHub nor any gate in this repository will tell you
  if you chose wrong; a merged, genuinely-resolving pull request whose issue
  still shows `closedByPullRequestsReferences: []` (`gh issue view <issue>
  --json closedByPullRequestsReferences`) is the tell.

  This is a convention, not an enforcement mechanism, the same honest
  position `governance/merge-policy.json` takes about its own declaration —
  "a stated policy plus a drift alarm, never an enforcement mechanism."
  Nothing in CI reads this entry; it depends entirely on the author's own
  judgement and a follow-up look, the same as several conventions above.
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

Maintainers only. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md), including
its section on the exact release-qualification runtime pin — separate from
this repository's `engines.node: ">=20"` consumer floor, and what to do when
your own machine isn't it. Before proposing any publish, run:

```bash
npm run preflight -- packages/<name>
```

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
