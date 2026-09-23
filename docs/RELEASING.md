# The weekly release calendar

Owner decision, 2026-09-23, building on the cadence rule at
[#1187 (comment)](https://github.com/clossys/foundry/issues/1187#issuecomment-5799002037):

> All weekly merges wrap up on a Friday, all releases happen on Saturday,
> all consumer adoptions happen on Sunday, so every Monday starts fresh.

`governance/release-calendar.json` is the single source of truth for the
cadence below. `scripts/lib/release-calendar.mjs` is the pure logic every
script and workflow reads it through; nothing else in this repository
computes a day type independently.

**Versioning itself is unchanged.** An earlier draft of this design also
proposed a week-numbered CalVer scheme; the owner rejected it and kept
plain semver. See [Version numbers stay plain semver](#version-numbers-stay-plain-semver)
below for the decision and why.

This design also carries a documented second-opinion review
([#1316](https://github.com/clossys/foundry/pull/1316#issuecomment-5800188207))
and a follow-up owner decision widening the out-of-band policy
([#1187 comment 5800369031](https://github.com/clossys/foundry/issues/1187)),
both folded into the sections below rather than kept separate — in
particular the release-PR exemption
([How the release PR is exempted](#how-the-release-pr-is-exempted-from-the-merge-window)),
the out-of-band scope and level
([Out-of-band releases](#out-of-band-releases)), the idempotent Saturday
guard ([How a release actually happens](#how-a-release-actually-happens)),
and [Opening the release PR](#opening-the-release-pr), which documents a
real defect in the original design and is not yet fully resolved.

## The cadence

| Day(s)         | What it is                                                     |
| -------------- | --------------------------------------------------------------- |
| Monday–Friday  | The merge window. Ordinary pull requests merge here.            |
| Saturday       | Release day. The release PR (below) opens and merges here.      |
| Sunday         | Consumer-adoption day. Packages released Saturday get adopted.  |
| Monday         | Fresh start — the next merge window opens.                      |

Every boundary is evaluated in `governance/release-calendar.json`'s own
timezone, `America/Los_Angeles` (the owner's local zone) — not UTC, and not
whatever timezone a given CI runner happens to be in.
`.github/workflows/release-calendar.yml` (`scripts/check-release-calendar.mjs`;
`node --test scripts/lib/release-calendar.test.mjs` for its own coverage,
including DST boundaries) fails any pull request that tries to merge on
Saturday or Sunday unless it is either the release PR itself or carries the
`release:out-of-band` label. **This check is deliberately not a required
status check yet** — see [Rollout](#rollout) below.

### How the release PR is exempted from the merge window

The release PR's exemption is **not**, and was never meant to be, "a branch
named the right way", and **not** merely "the right file paths changed" —
a branch name is just a string, and a path list says nothing about what
actually changed inside those files. The exemption requires **both** of
two things an ordinary contributor cannot produce merely by naming a
branch or shaping a file list:

1. **The `release:weekly` label** (`governance/release-calendar.json`'s
   `releasePrPolicy.label`), applied only by `.github/workflows/release-pr.yml`'s
   own automation.
2. **A STRUCTURALLY VERIFIED release-PR-shaped diff** — content, not just
   paths (`scripts/check-release-calendar.mjs`, using `scripts/lib/release-pr-footprint.mjs`'s
   `evaluateReleasePrFootprint()`): for every changed
   `packages/<dir>/package.json`, the ONLY difference from its base
   version is the `version` field itself — parsed and deep-compared, so a
   smuggled dependency, script, `bin`, or `exports` change fails
   immediately, whatever it's called. Every changed `CHANGELOG.md` must be
   the base text with one contiguous block of new text inserted — nothing
   existing removed or altered — and that inserted block must open with a
   new `## ` version heading. A changed `package-lock.json` must be
   byte-identical to what `npm install --package-lock-only --ignore-scripts`
   regenerates from the PR's own manifests. A `.changesets/*.md` file may
   only be *deleted*, never added — a new changeset cannot be smuggled in
   alongside a legitimate one being consumed. ANY other file in the diff,
   or a `--changed-files` read that could not be completed in full (see
   "Fail closed on pagination" in `.github/workflows/release-calendar.yml`'s
   own header), fails the whole check. This is a structural check only;
   `scripts/check-release-pr-shape.mjs` (a separate, pre-existing gate that
   runs on every pull request) is what validates that the version bumps
   *inside* that shape are themselves legitimate (backed by a consumed
   changeset or a matching `CHANGELOG.md` entry).

**Residual risk, documented rather than solved:** both of the above are
properties of this repository's *state* (files changed, labels applied),
not of *who* can cause that state. Anyone acting through the workflow's own
credential, or through an owner-authenticated session (see
[Opening the release PR](#opening-the-release-pr) below), could in
principle produce a pull request that passes both checks. That is a trust
boundary around who holds the workflow's and the owner's credentials, not
something a structural diff/label check can further narrow — the same
boundary every other owner-gated step in this repository already rests on
(docs/PUBLISHING.md's qualification and publication steps, for instance).

## A quiet week releases nothing

This is a structural property, not a policy that happens to hold today:

- `scripts/apply-release-changesets.mjs` only ever bumps a package that
  `.changesets/` names. A package with no pending changeset is untouched,
  even when a sibling package is bumped the same run
  (`scripts/apply-release-changesets.test.mjs` covers this directly).
- When `.changesets/` has nothing pending at all, that script returns
  `{ applied: [] }` without writing a single file, without regenerating
  `package-lock.json`, and without invoking `npm` — and, notably, without
  even needing `governance/release-calendar.json` to exist, since there is
  nothing left for the calendar to date.
- `.github/workflows/release-pr.yml`'s "Apply pending changesets" step
  reads that empty `applied` array and its "Push branch and open pull
  request" step's own `if:` skips entirely. **A week with no changesets
  opens no release pull request at all** — not an empty one, not a no-op
  commit, nothing.

There is deliberately no "release anyway, on schedule" fallback: the
calendar decides *when* a release PR is allowed to open, never *whether*
there is anything to put in it.

## Version numbers stay plain semver

Every package keeps ordinary semver (`patch`/`minor`/`major`), computed the
same way issue #1255 already established: each `.changesets/<slug>.md` file
names a package and a bump level; a release PR bumps each named package
once, by the **highest** level any of its pending changesets named.
`scripts/check-release-pr-shape.mjs` is the gate that keeps this the only
legitimate way a version moves — see
[docs/PUBLISHING.md, section 4](PUBLISHING.md#4-write-the-furniture) for
the day-to-day mechanics of adding a changeset.

One addition on top of the pre-existing #1255 behavior: a `major`-level
changeset now also requires the release's `CHANGELOG.md` entry to carry a
"### Breaking changes" subsection (`scripts/apply-release-changesets.mjs`
writes it; `scripts/check-release-pr-shape.mjs` requires it, alongside the
version already fully encoding the breakage the way semver always has).

### Options considered, and why CalVer was rejected

Three options were on the table for how a version relates to the weekly
calendar:

- **`YY.WW.N`** (ISO week-year, ISO week, a same-week counter) — a
  calendar-driven version, so "what shipped this week" would be legible
  from the version number itself.
- **`0.YYWW.N`** — the same idea, kept formally pre-1.0.
- **Plain semver, unchanged** — the version continues to say nothing about
  *when* a release happened, only *what* changed.

**The owner chose plain semver, unchanged.** The reason: there is no
guarantee of a real content change every week, and a version number that
moves on a clock rather than on a change is not a useful signal — it would
either force a release PR to open (and a version to bump) on weeks with
nothing to say, or require a separate "did anything actually change" check
duplicating what changesets already answer. Semver's existing meaning
(patch/minor/major = the size and shape of the change) stays exactly what
it was before this calendar existed; the calendar only decides *when* a
release PR is allowed to open, never what version anything gets.

## Out-of-band releases

Reserved for a **security fix**, a fix for **a release that already shipped
broken**, or **an owner-approved urgent update** (owner decision,
2026-09-23, [#1187 comment 5800369031](https://github.com/clossys/foundry/issues/1187))
— never for ordinary content that simply missed Friday's merge window (that
just waits for next Saturday). An out-of-band release:

1. Needs a changeset carrying `release: out-of-band` in its frontmatter,
   and must bump every package it names at `patch` **by default**
   (`scripts/collect-changesets.mjs` enforces this structurally — a
   security fix or a broken-release fix is, by definition, not the kind of
   change that also earns a minor or major bump), e.g.:

   ```
   ---
   controller: patch
   release: out-of-band
   ---

   Fix a crash introduced by controller's last release.
   ```

2. **A `minor` bump needs explicit, per-changeset owner approval; `major`
   is never allowed out of band, no matter what.** Add `owner-approved: minor`
   alongside `release: out-of-band` in the same changeset to allow a
   `minor` bump instead of `patch` — this is how the owner clears an
   urgent update that is not a security fix or a broken-release fix, on any
   day, without waiting for Saturday:

   ```
   ---
   controller: minor
   release: out-of-band
   owner-approved: minor
   ---

   Ship the urgent config-loader change the owner approved out of band.
   ```

   There is no equivalent flag for `major` — `scripts/collect-changesets.mjs`
   refuses a `major` bump in an out-of-band changeset unconditionally, and
   `owner-approved` accepts no value other than `"minor"`. This widening
   (owner decision 2026-09-23, same thread as above) sits on top of, and
   does not relax, item 4 below: `owner-approved: minor` in a changeset's
   frontmatter is not itself the owner's approval — the owner applying
   `release:out-of-band` to the resulting pull request is.
3. **Consumes ONLY out-of-band-flagged changesets, never a mix.**
   `.github/workflows/release-pr.yml`'s `workflow_dispatch` trigger has an
   `out_of_band` input that runs `scripts/apply-release-changesets.mjs --out-of-band`
   instead of the ordinary full-batch invocation: that mode filters
   `.changesets/` down to only `release: out-of-band` entries *before*
   grouping by package, so an ordinary pending `minor` or `major`
   changeset for the same package is left untouched — it stays pending for
   the next regular Saturday release, exactly as if the out-of-band run had
   never happened. `scripts/apply-release-changesets.test.mjs` covers this
   directly: one out-of-band `patch` changeset plus one ordinary pending
   `minor` changeset for the same package produces only the patch bump,
   leaving the minor changeset in place; a separate test covers the
   `owner-approved: minor` path producing the minor bump.
4. Needs **explicit owner approval** before the release PR consuming it
   merges (`governance/release-calendar.json`'s `outOfBandPolicy`).
5. **`release:out-of-band` is applied by the owner only — standing rule.**
   Neither the `workflow_dispatch` `out_of_band` input, nor
   `owner-approved: minor` in a changeset, nor the resulting pull request's
   `release:out-of-band` label, is ever triggered or applied by an agent
   acting on its own initiative. An agent may be *asked* by the owner to
   carry out an out-of-band release the owner has already decided on and
   approved, but the decision to dispatch one, and the label that admits
   its pull request past the merge-window gate, are owner actions. This
   mirrors `governance/release-calendar.json`'s own
   `outOfBandPolicy.requiresOwnerApproval` and `ownerOnlyLabel` fields —
   the same gate stated once as workflow input and once as PR label.
6. May be dispatched at any time, not only Saturday — `workflow_dispatch`
   is explicitly exempt from the Saturday guard that gates the scheduled
   runs (see [How a release actually happens](#how-a-release-actually-happens)).
7. **Its resulting pull request is exempted from the merge-window gate on
   ANY day, not only Saturday/Sunday** — `governance/release-calendar.json`'s
   `outOfBandPolicy.exemptFromCalendarOnAnyDay`, mechanized by
   `scripts/lib/release-calendar.mjs`'s `evaluateReleaseCalendarGate()`,
   which checks the `release:out-of-band` label before it checks what day
   it is at all. On an ordinary Monday–Friday this is moot (the merge
   window is already open to everyone); the label's actual effect is
   admitting the PR on Saturday or Sunday, when an ordinary pull request
   cannot land. `.github/workflows/release-pr.yml` applies the label
   automatically once such a run is dispatched.

## How a release actually happens

1. **Monday–Friday**: contributors merge ordinary content changes. A change
   to an already-published package's packed content adds a
   `.changesets/<slug>.md` file (`scripts/collect-changesets.mjs`) instead
   of touching that package's `version` directly — see
   [docs/PUBLISHING.md, section 4](PUBLISHING.md#4-write-the-furniture).
2. **Friday**: the merge window closes. Nothing new lands until the release
   PR merges and Monday reopens it — `release:out-of-band` is the only
   exception.
3. **Saturday (`America/Los_Angeles`)**: `.github/workflows/release-pr.yml`'s
   daily scheduled run checks two things — is it release day, and is a
   release PR (labelled `release:weekly`) already open? — via
   `scripts/lib/release-calendar.mjs`'s `shouldOpenReleasePr()`. This is a
   deliberately **idempotent** check, not an exact-hour window: a delayed
   run (a busy runner queue, a temporary Actions outage) still opens that
   week's release PR as long as it is still Saturday when it finally runs,
   and a repeated or double-triggered run is a safe no-op once the first
   run's PR is already open. When it proceeds, it applies every pending
   changeset (`scripts/apply-release-changesets.mjs`), bumping each named
   package by the highest level its changesets named, writing its
   `CHANGELOG.md` entry, and preparing a pull request — or nothing at all
   if nothing was pending (see [above](#a-quiet-week-releases-nothing)).
   `scripts/check-release-pr-shape.mjs` verifies, on that very pull
   request, that every version it touched is shaped exactly this way. See
   [Opening the release PR](#opening-the-release-pr) for who actually
   creates the pull request and why that is not simply this same automated
   step.
4. **Owner step**: review and merge the release PR, on the weeks one
   opened. This is the *only* manually-gated step in the sequence above the
   level of an ordinary code review — see [Rollout](#rollout) below.
5. **Sunday**: downstream consumers adopt whatever shipped Saturday, on
   weeks something did.
6. **Monday**: fresh merge window.

Qualification (`governance/release-qualifications/`, one retained record
per released *version*) and publication (`publish.yml`) remain separate,
manually-gated steps after the release PR merges, unaffected by this
calendar — a release PR bumping several packages at once still needs one
qualification per package version it produced, exactly as before
(docs/PUBLISHING.md, section 4).

## Opening the release PR

**Known defect, not yet fully resolved (second-opinion review,
[#1316](https://github.com/clossys/foundry/pull/1316#issuecomment-5800188207)):**
`.github/workflows/release-pr.yml` authenticates as the ambient
`GITHUB_TOKEN` to push the release branch and, in the design this section
describes, was originally also going to use it to call `gh pr create`.
GitHub's own loop-prevention rule means a pull request *opened* using
`GITHUB_TOKEN` does not trigger `pull_request`-scoped workflow runs in this
repository — including `release-pr-shape` and, once
[required](#rollout), `release calendar (merge window)` itself. A release
PR that never triggers its own required checks is a real defect: the
push (branch creation) is unaffected by this rule and stays automated, but
opening the pull request needs an **owner-authenticated actor** — in
practice, the orchestrator's agent using the owner's own `gh` session, not
this workflow's `GITHUB_TOKEN` — so the resulting `pull_request: opened`
event is a normal one. The pull request's shape (title, body, base, head,
labels) is unaffected by who calls `gh pr create` for it.

Two automatable alternatives exist and are **deliberately not implemented
here**, because both need owner setup this pull request cannot perform on
its own:

- **A GitHub App installation token.** The owner would register (or reuse)
  a GitHub App with `pull_requests: write` on this repository, install it,
  and wire its private key into a repository secret this workflow exchanges
  for a short-lived token before calling `gh pr create`. App-authenticated
  events are not subject to the same loop-prevention rule.
- **A fine-grained personal access token, stored as a repository secret.**
  Scoped narrowly to this repository and to pull-request creation, used in
  place of `GITHUB_TOKEN` for the `gh pr create` call only. Simpler to set
  up than a GitHub App, at the cost of being tied to whichever account's
  token it is and needing manual rotation.

Either would let this workflow open the PR itself again, with the checks
firing normally. Until the owner sets one up, opening the release PR
remains an owner-authenticated, agent-assisted step following the
automated push.

## Rollout

`release calendar (merge window)` — that exact string is this check's job
name, and the exact context a branch protection ruleset's required-checks
list will show; the workflow's own name ("Release calendar") is not what
appears there — is **not** a required status check today. The intended
sequence:

1. This design (#1316) merges into `claude/release-batching`, alongside
   changesets (#1265) and auto-qualify (#1266).
2. The merge queue (#1263) is in place, since `release calendar (merge
   window)` runs on `merge_group` as well as `pull_request` and depends on
   that queue existing to be exercised realistically. **Until #1263 lands,
   only the `pull_request` path is actually exercised** — `merge_group`
   never fires with no queue enabled, so this check's own history so far
   is entirely a `pull_request` history. This is expected, not a gap: the
   workflow already declares both triggers so nothing needs to change here
   once the queue exists.
3. **One report-only week**: the check runs and reports on every pull
   request, but is not required — an observation window to confirm it
   behaves correctly (in particular, that the release PR itself passes
   its own exemption) before anything can block a merge because of it.
4. The owner makes `release calendar (merge window)` a required status
   check on this repository's branch protection ruleset. This is an owner
   action; see `.github/workflows/release-calendar.yml`'s own header for
   why the workflow does not attempt it itself.

## Owner steps

Actions only the owner can take, neither of which this repository's
automation grants itself (see `AGENTS.md`'s "Autonomous review and
shipping" section):

1. **Sign off on this design** (this pull request) before it merges into
   `claude/release-batching` and, from there, into the batch that includes
   changesets (#1265) and auto-qualify (#1266).
2. **Carry out the rollout** in [Rollout](#rollout) above, in order.
3. **Approve, and dispatch or ask for, each out-of-band release**
   (see [Out-of-band releases](#out-of-band-releases) above) — the
   `npm-publish` gate is where that approval is exercised in practice, at
   the same point every other qualified publish already requires an
   owner-present step (docs/PUBLISHING.md).
4. **Open each release PR** (or delegate that single step to an
   owner-authenticated agent session) until [Opening the release
   PR](#opening-the-release-pr)'s automation gap is closed.

Refs: #1187, #1265, #1266, #1255, #1263.
