# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.5] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.4.0`
  to `~0.5.0` to cover controller's new repository-profile runner
  (`runRepositoryProfileCheck` / `repository-profile-check`, #321). This
  package does not use `@vespeneventures/controller/repository`, so nothing
  here changes behaviorally.

## [0.2.4] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.3.0`
  to `~0.4.0` to cover controller's settled canonical declaration location
  and requirement-id grammar (#315, #316). This package does not use
  `@vespeneventures/controller/repository`, so nothing here changes
  behaviorally.

## [0.2.3] - Unreleased

### Documentation

- The "Requirements" section named the exported `./policy` subpath
  (`@vespeneventures/controller/policy`) as though it were itself the
  installable runtime dependency (#313). The actual runtime dependency, per
  `package.json`, is `@vespeneventures/controller`; `./policy` is a subpath
  this package imports from it. Both are now named, distinctly.

## [0.2.2] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.2.0`
  to `~0.3.0` to track controller's own minor bump (a new canonical
  `liveStateSurface` export under `./conventions`; see
  `@vespeneventures/controller`'s own changelog). No API change here.

## [0.2.1] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.1.0`
  to `~0.2.0` to track controller's own minor bump (its skill-registry
  `scope` enum is now closed to `account`/`repo`/`third-party`; see
  `@vespeneventures/controller`'s own changelog). No API change here.

## [0.2.0] - 2026-08-18

### Changed

- The content-addressed `PolicyBinding` this package reuses now resolves
  through `@vespeneventures/controller/policy` instead of
  `@vespeneventures/policy`. The recut recorded in the producing repository's
  decision 9 merged `governance`, `conventions` and `policy` into one rules
  package; `policy` was a pure zero-I/O function with no lifecycle of its own,
  sitting one level below the package whose rules it binds.
- This is a rename, not a rewrite. No export, argument shape, or return type
  changed here or upstream — `checkLedgerDrift`, `appendEntry` and
  `checkAppendOnly` behave exactly as before, and this package still never
  imports `@vespeneventures/strategy`.
- One first-party dependency instead of one: `@vespeneventures/policy` is
  replaced by `@vespeneventures/controller`, not added to.

### Note for installed consumers

`@vespeneventures/policy`'s published versions remain resolvable and carry a
deprecation record naming their replacement, so a consumer pinned to `0.1.1`
of this package keeps working unchanged. It will not receive further fixes.

## [0.1.1] - 2026-08-13

### Fixed

- Doc comments in `src/index.ts` and `src/types.ts`, and the README's
  rationale and export-table sections, cited two package names
  that no longer exist: `@vespeneventures/voice` (consolidated into
  `@vespeneventures/copy`, whose contract now lives at
  `@vespeneventures/copy/voice`) and `@vespeneventures/compose`
  (consolidated into `@vespeneventures/surface`, whose `Channel` vocabulary
  now lives at `@vespeneventures/surface/core`). These comments explain the
  `factRef`/`channel` seams this package deliberately keeps as opaque
  strings, so a reader following them to a package that cannot be installed
  loses exactly the explanation they were reaching for. `src/` ships in the
  published tarball, so the stale names were consumer-visible. No runtime
  behavior changes.

## [0.1.0] - 2026-08-11

### Added

- Initial release. `PublicationEntry`/`FactCitation`/`Ledger` (`types.ts`):
  the return-path entity — what was published, to which channel, when,
  derived from which revision of strategy, citing which facts, each fact
  bound to its value at publication time via a
  `@vespeneventures/controller/policy` `PolicyBinding` reused directly, not
  reimplemented. No score, threshold, or verdict field anywhere — this
  package records outcomes and makes them attributable; it carries no
  opinion about whether an outcome is good.
- `validateEntry`/`validateLedger` (`schema.ts`): hand-rolled shape
  validation, the same style every other package in this foundation uses
  (plain type guards over `unknown`, an accumulated `LedgerFinding[]`,
  never throws), including a `PolicyBinding`-shape check delegated
  straight to `@vespeneventures/controller/policy`'s own `validateBindingShape` and a
  `"citation-policy-id-mismatch"` rule enforcing that a citation's
  `valueBinding.policyId` always equals its `factRef`.
- `canonicalizeValue`/`citeFact` (`fact.ts`): deterministic
  (key-order-independent) serialization of a JSON-serializable fact value,
  plus the one sanctioned way to build a `FactCitation` — computes a
  digest of a fact's canonicalized value via `@vespeneventures/controller/policy`'s
  own `computeDigest`. This package's first real use of `policy` outside
  `policy` itself.
- `appendEntry` (`append.ts`): the one sanctioned, in-process way to grow
  a `Ledger`. Throws on a malformed entry or a reused id rather than
  overwriting; returns a new, deep-frozen array, leaving the input
  ledger and every existing entry in it untouched. No `updateEntry` or
  `removeEntry` export exists anywhere in this package — that omission is
  the point, not a gap.
- `checkAppendOnly` (`append-only-gate.ts`): the at-rest complement to
  `appendEntry` — a pure diff between two serialized ledger snapshots
  (e.g. a checked-in JSON file's contents before/after a pull request)
  that fails closed on any entry removed, reordered, or mutated, using
  `canonicalizeValue` so a harmless JSON-key-order round-trip is never
  mistaken for a real change.
- `checkLedgerDrift` (`drift.ts`): the drift checker — for each fact a
  ledger cites, compares its recorded value-digest against a
  caller-supplied current value via `@vespeneventures/controller/policy`'s own
  `verifyBinding`, all without this package ever importing
  `@vespeneventures/strategy`. Fails closed in three distinct, separately
  tested ways: an invalid ledger, an empty ledger, and a non-empty ledger
  where zero citations could actually be compared to a current value —
  each reports `ok: false` with its own named finding, and
  `entriesChecked`/`citationsChecked`/`citationsUnchecked`/
  `citationsDrifted` are always present so "checked nothing" can never be
  mistaken for "checked everything, found nothing wrong."
- `ledger-check` CLI (`bin`), wired to this repository's usual
  three-state exit-code contract: `0` clean (something was checked,
  nothing drifted), `1` at least one cited fact has drifted, `2` could
  not run (bad input, invalid JSON, an invalid or empty ledger, or
  nothing could be checked) — explicitly distinguishing "found a real
  problem" from "could not check" at the exit-code level, not just in the
  printed report.

Zero runtime dependencies beyond `@vespeneventures/controller/policy`, pinned with a
tilde range (`~0.1.0`), never a caret — a caret range on a `0.x` package is
patch-only under semver and has broken this repository's CI twice before.
