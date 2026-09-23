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
Saturday or Sunday unless it is either the release PR itself (by its head
branch — see `.github/workflows/release-pr.yml`) or carries the
`release:out-of-band` label. **This check is deliberately not a required
status check yet** — see [Owner steps](#owner-steps) below.

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

Reserved for a **security fix**, or a fix for **a release that already
shipped broken** — never for ordinary content that simply missed Friday's
merge window (that just waits for next Saturday). An out-of-band release:

1. Needs a changeset carrying `release: out-of-band` in its frontmatter,
   and must bump **every** package it names at `patch`
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

2. Needs **explicit owner approval** before the release PR consuming it
   merges (`governance/release-calendar.json`'s `outOfBandPolicy`).
3. May be applied via `.github/workflows/release-pr.yml`'s
   `workflow_dispatch` trigger at any time, not only Saturday — that
   trigger is explicitly exempt from the Saturday DST guard that gates the
   scheduled runs.
4. Gets its resulting pull request labelled `release:out-of-band`
   automatically (the same workflow), which is exactly what
   `.github/workflows/release-calendar.yml`'s otherwise-closed Saturday/
   Sunday gate admits past itself, should the PR need to land on a
   merge-window-closed day.

## How a release actually happens

1. **Monday–Friday**: contributors merge ordinary content changes. A change
   to an already-published package's packed content adds a
   `.changesets/<slug>.md` file (`scripts/collect-changesets.mjs`) instead
   of touching that package's `version` directly — see
   [docs/PUBLISHING.md, section 4](PUBLISHING.md#4-write-the-furniture).
2. **Friday**: the merge window closes. Nothing new lands until the release
   PR merges and Monday reopens it — `release:out-of-band` is the only
   exception.
3. **Saturday, the start of the day (`America/Los_Angeles`)**:
   `.github/workflows/release-pr.yml`'s scheduled run applies every pending
   changeset (`scripts/apply-release-changesets.mjs`), bumping each named
   package by the highest level its changesets named, writing its
   `CHANGELOG.md` entry, and opening a pull request — or opens nothing at
   all if nothing was pending (see [above](#a-quiet-week-releases-nothing)).
   `scripts/check-release-pr-shape.mjs` verifies, on that very pull
   request, that every version it touched is shaped exactly this way.
4. **Owner step**: review and merge the release PR, on the weeks one
   opened. This is the *only* manually-gated step in the sequence above the
   level of an ordinary code review — see [Owner steps](#owner-steps).
5. **Sunday**: downstream consumers adopt whatever shipped Saturday, on
   weeks something did.
6. **Monday**: fresh merge window.

Qualification (`governance/release-qualifications/`, one retained record
per released *version*) and publication (`publish.yml`) remain separate,
manually-gated steps after the release PR merges, unaffected by this
calendar — a release PR bumping several packages at once still needs one
qualification per package version it produced, exactly as before
(docs/PUBLISHING.md, section 4).

## Owner steps

Two actions only the owner can take, neither of which this repository's
automation grants itself (see `AGENTS.md`'s "Autonomous review and
shipping" section):

1. **Sign off on this design** (this pull request) before it merges into
   `claude/release-batching` and, from there, into the batch that includes
   changesets (#1265) and auto-qualify (#1266).
2. **Make `release-calendar` a required status check**, once satisfied it
   behaves correctly: this repository's branch protection ruleset, not a
   workflow file, is what turns a reporting-only check into an enforced
   one — see `.github/workflows/release-calendar.yml`'s own header for why
   it does not attempt this itself.
3. **Approve each out-of-band release** before its release PR merges
   (see [Out-of-band releases](#out-of-band-releases) above) — the
   `npm-publish` gate is where that approval is exercised in practice, at
   the same point every other qualified publish already requires an
   owner-present step (docs/PUBLISHING.md).

Refs: #1187, #1265, #1266, #1255.
