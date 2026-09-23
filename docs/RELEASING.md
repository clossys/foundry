# The weekly release calendar

Owner decision, 2026-09-23, building on the cadence rule at
[#1187 (comment)](https://github.com/clossys/foundry/issues/1187#issuecomment-5799002037):

> All weekly merges wrap up on a Friday, all releases happen on Saturday,
> all consumer adoptions happen on Sunday, so every Monday starts fresh.
> Version labeling aligns by week number, with a minor version for any
> finer bumps.

`governance/release-calendar.json` is the single source of truth for the
cadence and the version scheme below. `scripts/lib/release-calendar.mjs` is
the pure logic every script and workflow reads it through; nothing else in
this repository computes a day type or a version independently.

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
`.github/workflows/release-calendar.yml` (`scripts/check-release-calendar.mjs`,
`node --test scripts/lib/release-calendar.test.mjs` for its own coverage,
including DST boundaries) fails any pull request that tries to merge on
Saturday or Sunday unless it is either the release PR itself (by its head
branch — see `.github/workflows/release-pr.yml`) or carries the
`release:out-of-band` label. **This check is deliberately not a required
status check yet** — see [Owner steps](#owner-steps) below.

## The version scheme: `YY.WW.N` (calver-isoweek)

Every package versions as three dot-separated integers:

- **`YY`** — the two-digit **ISO week-year** (`%G`, not the calendar year).
  A date's ISO week-year is the year of the Thursday in that date's
  Monday–Sunday week, which is why it can differ from the calendar year at
  the very start or end of a year: `2027-01-02` is ISO week 53 of
  **week-year 2026**, not week 1 of 2027, so a release cut that day is
  `26.53.x`, not `27.1.x`.
- **`WW`** — the ISO week number (`%V`), `1`–`53`, printed **without
  zero-padding**: semver's numeric identifiers forbid a leading zero on
  anything but a bare `0`, so week 3 is `3`, not `03`.
- **`N`** — `0` for the regular Saturday release. Incremented only for an
  [out-of-band release](#out-of-band-releases) later in the *same* ISO
  week.

A package is bumped only when it has a pending changeset — an unrelated
package sits still that week, same as before this scheme existed
(issue #1255). The changeset's `patch`/`minor`/`major` **level no longer
selects the version** — CalVer already fixes `YY.WW.N` from the release
date. It is kept as a purely **informational** signal: a changeset (or any
of a group of changesets consumed together) marked `major` means a breaking
change, and drives a mandatory **"Breaking changes"** subsection in that
release's `CHANGELOG.md` entry and in the release PR's own description —
`scripts/apply-release-changesets.mjs` writes it,
`scripts/check-release-pr-shape.mjs` requires it.

### Examples

| Event                                                             | Version    |
| ------------------------------------------------------------------ | ---------- |
| First release under this scheme, ISO week 39 of week-year 2026     | `26.39.0`  |
| Same package, an out-of-band fix later that same ISO week          | `26.39.1`  |
| Ordinary release the following ISO week                            | `26.40.0`  |
| Release cut in ISO week 53 of week-year 2026 (spans into January)  | `26.53.0`  |
| The next release, now in ISO week 1 of week-year 2027              | `27.1.0`   |

### The one-time transition off `0.x.y`

Every package in this repository ships a pre-1.0 semver today (for example
`controller@0.9.12`). The **first** release a package takes under this
scheme moves it straight from `0.x.y` to `YY.WW.0` in one step — e.g.
`0.9.12 → 26.39.0` — which is a valid forward semver move (`26 > 0`) even
though it is a large jump. This is deliberately a **one-way door**: nothing
in this repository ever produces a `0.x.y` version again once a package has
crossed it. `scripts/lib/release-calendar.mjs`'s `computeNextReleaseVersion()`
and `classifyCalverBump()` are what recognize and validate this crossing;
see that module's own header for the exact rule.

### Why not `0.YYWW.N`, and why not stay on plain semver

Two alternatives were considered and rejected:

- **`0.YYWW.N`** (e.g. `0.2639.0`) keeps every release formally "pre-1.0,"
  avoiding the one-way major-version jump above. Rejected: it reads as
  "still unstable" forever, which is not true of packages that already have
  real consumers, and it does not scale past `0.9999.x` levels of
  legibility (a four-digit minor is not obviously a week number to a human
  reader the way `26.39` is).
- **Keep plain semver** (patch/minor/major driven by the changeset level,
  as before this decision) avoids inventing a new scheme at all. Rejected:
  it does not encode *when* a release happened, which the weekly cadence
  above depends on for reasoning about "what shipped this week" and for
  the out-of-band counter's own meaning (a same-week re-release is
  meaningless without a week to be "the same" as).

The trade-off accepted with `YY.WW.N`: **the version number no longer
signals breakage** the way semver's major position used to — that
information moved to the changeset's informational `level` and the
CHANGELOG's "Breaking changes" section instead. There is also a **yearly
major-version rollover** (`26.x` → `27.x` every January-ish, at the ISO
week-year boundary) that is cosmetic but real — tooling that treats a major
bump as "something broke" will misread it, which is exactly why the
Breaking changes section exists as the actual signal now. And the
transition off `0.x.y` above is, again, one-way.

### What this transition does not touch

`docs/contracts/package-lifecycle.json` records, for each **retired**
package, the semver `range` of its replacement that was correct **at the
time of that retirement** (e.g. `^0.9.0`) — a historical fact about a
decision already made, not a live "install this range today" pointer nothing
re-derives it against the replacement's current version, and no gate in this
repository checks that it still resolves to something installable. Nothing
here rewrites those existing entries: doing so would edit the historical
record of what was true when each retirement happened, for no consumer this
repository can identify (every retirement on file predates this scheme, and
every replacement it names is still pre-transition `0.x.y` as of this pull
request). Any **future** retirement decided after a package has crossed into
`YY.WW.N` should record a calver-shaped range (e.g. `^26.0.0`) — the schema
does not enforce this either way, so it is a matter of writing the correct
range when that day comes, not a mechanism this pull request adds.

## Out-of-band releases

Reserved for a **security fix**, or a fix for **a release that already
shipped broken** — never for ordinary content that simply missed Friday's
merge window (that just waits for next Saturday). An out-of-band release:

1. Needs a changeset carrying `release: out-of-band` in its frontmatter,
   alongside the package(s) it names, e.g.:

   ```
   ---
   controller: patch
   release: out-of-band
   ---

   Fix a crash introduced by 26.39.0's config loader.
   ```

2. Needs **explicit owner approval** before the release PR consuming it
   merges (`governance/release-calendar.json`'s `outOfBandPolicy`).
3. Produces `N + 1` on a package already at `YY.WW.x` for the current ISO
   week — never on a package from a different week (nothing to patch) and
   never on a package with no calver release yet (there is no same-week
   release to be "out of band" relative to). Both are refused by
   `computeNextReleaseVersion()`, not silently resolved some other way.
4. May land any day, including a merge/release/adoption day, and is exactly
   what the `release:out-of-band` label admits past
   `.github/workflows/release-calendar.yml`'s otherwise-closed Saturday/
   Sunday gate.

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
   changeset (`scripts/apply-release-changesets.mjs`), computing each named
   package's `YY.WW.N` from the calendar, writing its `CHANGELOG.md` entry,
   and opening a pull request. `scripts/check-release-pr-shape.mjs` verifies,
   on that very pull request, that every version it touched is shaped
   exactly this way.
4. **Owner step**: review and merge the release PR. This is the *only*
   manually-gated step in the sequence above the level of an ordinary code
   review — see [Owner steps](#owner-steps).
5. **Sunday**: downstream consumers adopt what shipped Saturday.
6. **Monday**: fresh merge window.

Qualification (`governance/release-qualifications/`, one retained record
per released *version*) and publication (`publish.yml`) remain separate,
manually-gated steps after the release PR merges, unaffected by this
scheme — a release PR bumping several packages at once still needs one
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
