# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-08-13

### Added

- **`PackRoundTripOptions.tarballPath`.** `packRoundTrip` (`./release`) can
  now be pointed at an already-packed tarball instead of always running its
  own `npm pack` on `packageDir`. A caller that has already packed the exact
  bytes it needs checked — a tarball about to be published, or one fetched
  from a registry — passes it via `tarballPath`, so the round trip checks
  those bytes instead of risking a second, separately-produced pack that
  could silently diverge from them. `packageDir/package.json` still supplies
  the declared `exports` surface to check; only which bytes get installed
  changes.

  This closes a real gap: the publish workflow's post-publish step already
  passed a `tarballPath`-shaped option to `packRoundTrip`, expecting it to
  check the fetched, just-published tarball — but the option did not exist
  on `PackRoundTripOptions`, so it was silently ignored and the function
  always re-packed the current working tree instead. That step never
  actually checked the tarball it claimed to. It does now, and this option
  is also what lets the publish workflow move this proof to *before*
  `npm publish` (see the workflow's own history for the ordering fix this
  enables).

## [0.5.1] - 2026-08-13

### Added

- **`typescript` peer-version guard.** `src/gates/secret-gates.ts` — the
  sole importer of the `typescript` optional peer — now calls
  `assertPeerVersion` (new internal `src/internal/peer-version.ts`) at
  import time, throwing a named, actionable error when `typescript` is
  either not installed or installed outside this package's declared
  `~6.0.0` range — distinct messages for each case. Previously, an absent
  or incompatible `typescript` produced no signal until something inside
  the compiler API itself crashed. See the README's "Requirements"
  section. (#182)

## [0.5.0] - 2026-08-13

### Fixed

- `packRoundTrip` (`./release`) now verifies a **wildcard `exports` subpath**
  instead of resolving it as a literal filesystem path. A manifest declaring
  `"./documents/*": "./documents/*"` previously made the verifier look for a
  file named `documents/*`, never find one, and report a package that shipped
  every promised file as missing its assets — a false
  `round-trip-asset-missing`. Wildcard subpaths are standard Node `exports`
  syntax, and this fired for real on an already-published tarball: the
  publish succeeded and the isolated install proof that runs immediately
  after it failed, which is the worst point in the pipeline to discover a
  verifier defect.

  A wildcard is now **expanded** against the files the installed tarball
  actually shipped, and each expansion is checked exactly like a literal
  subpath — executable matches are imported through Node's own resolver from
  the isolated consumer, static matches are checked for presence, and a
  wildcard declaration target (`"types": "./adapters/*.d.ts"`) expands the
  same way. Expanding a pattern is deliberately not a way to stop checking
  it: a pattern that matches nothing exports nothing to a consumer, and is a
  new `round-trip-pattern-unmatched` error finding. So is a key carrying more
  than one `*`, which Node's resolver can never select for any specifier.

### Changed

- `ImportCheck["mode"]` gained a `"pattern"` member (`./release`), reporting
  the expansion of a wildcard subpath itself; each file it expanded to gets
  its own entry under its concrete subpath and its own mode. Additive, but it
  widens a union a consumer may be switching over exhaustively.
- A package whose wildcard target carries no extension (`"./adapters/*"`)
  now installs declared runtime peers before its exports are checked. The
  expansion could be executable or static and there is no way to know before
  the install, so peers are installed rather than risking a false import
  failure.

## [0.4.0] - 2026-08-13

### Added

- `evaluateRatchet(current, baseline)` (`./gates`): a generic, pure
  "warn-first with a checked-in baseline, ratchet monotonically toward
  zero" primitive. `current <= baseline` passes; `current > baseline` is a
  `"ratchet/regression"` finding; `current < baseline` still passes but is
  reported explicitly via an `improved: true` flag plus a
  `"ratchet/baseline-stale"` warning finding, so real progress is never
  silently dropped. Fails closed — `status: "invalid"` — on a negative or
  non-integer `current`/`baseline`, or a missing (`undefined`/`null`)
  baseline; a missing baseline is "could not run", never "baseline of
  zero". Lowering the baseline is always an explicit, separate action —
  this function never does it automatically.
- `checkOverrideTargetRanges(overrides)` (`./gates`): a package.json
  `overrides` entry's target range must be upper-bounded to the vulnerable
  major, never a bare `>=x.y.z` — an unbounded target lets a resolver hoist
  a dependent across a major version boundary and break it at runtime, a
  class of break a security audit cannot catch (an audit only confirms the
  vulnerable version is gone, never that its replacement stays
  API-compatible). Hand-rolled range parsing, no semver dependency: accepts
  an exact pin, a `~`/`^` range, an explicit space-hyphen-space range, or a
  single/paired `>=`/`>`/`<`/`<=` comparator range; anything it does not
  confidently understand (OR ranges, x-ranges, dist-tags, git/file/workspace
  specifiers, and more) is reported as unparseable rather than assumed safe.
- `checkDependencyScope(catalog, scope, allowlist, options?)` (`./gates`):
  mechanical enforcement of this repository's own contribution policy,
  "Dependencies: the default answer is no" — every `dependencies` entry in
  a workspace's package.json under `packages`
  must be `<scope>/*`-scoped, unless it is named in a small, checked-in
  allowlist entry carrying a non-empty reason and a `reviewBy` date. A
  malformed allowlist document or entry is itself a finding and exempts
  nothing; an entry whose `reviewBy` date has passed stops exempting its
  dependency and is reported as expired. Deliberately scoped small: every
  runtime dependency in this repository was verified by inspection to
  already be first-party, so this is a floor matching that reality, not a
  full admission-and-retirement register.

## [0.3.0] - 2026-08-13

### Changed

- **Breaking:** `typescript` moved from an unconditional `dependencies`
  entry to an optional `peerDependency` (`peerDependenciesMeta` marks it
  optional). It is imported only by `src/gates/secret-gates.ts`, reachable
  only through `./gates`. Issue #152 asked for exactly this; the 0.2.1 fix
  above corrected only the import graph — the root entry stopped
  transitively *loading* TypeScript — and left the manifest unchanged, so
  every consumer, including the five compatibility packages (`catalog`,
  `gates`, `release`, `repository`, `review`) that depend on `governance`,
  still *installed* a full compiler regardless of whether they ever
  imported `./gates`. Under this repo's pre-1.0 semver policy a breaking
  change to a 0.x package is a MINOR bump, not MAJOR.
- **Breaking — action required on upgrade:** the lifecycle schema now
  requires new fields. `forwardsToReplacement` (boolean) is required on
  every `deprecated` entry. A status of `qualified` requires
  `qualifiedEvidence`; a status of `adopted` requires both
  `qualifiedEvidence` and `adoptedEvidence`, each shaped
  `{ reference, date }`. **A consumer validating its own lifecycle file
  against an existing `deprecated` entry will fail validation until it adds
  `forwardsToReplacement`.** Set it to `true` if the deprecated entry's old
  import path still resolves to a working compatibility re-export, `false`
  if it is a hard break.
  - `forwardsToReplacement` exists because a deprecated package that still
    re-exports working code was previously indistinguishable, in the
    machine-readable registry, from one whose source is gone entirely —
    both carried identical `status`/`replacement` fields, and the
    difference existed only in prose one hop away.
  - The evidence fields exist because retiring a package required durable
    evidence while promoting one to "confirmed consumer use" required
    none, and the schema previously rejected any attempt to attach it.
- This repository's own lifecycle registry
  (`docs/contracts/package-lifecycle.json`) now marks `deployment`,
  `domain`, `ledger`, `policy`, and `secrets` as `published` instead of
  `adopted`. No durable public evidence could be cited for the stronger
  `adopted` claim under the new evidence requirement above — an
  unsubstantiated status is worth less than an accurate lower one.

### Added

- `RepositoryProfile`, `ReviewPolicy`, and `ReviewEvidenceBundle` are now
  documented with field tables and worked examples in this package's own
  README. They were previously documented only in the deprecated
  `repository` and `review` compatibility packages, both of which direct
  readers here for the schema — so the two docs pointed at each other and
  neither actually carried it.

## [0.2.1] - 2026-08-13

### Fixed

- The root entry (`import "@vespeneventures/governance"`) no longer
  transitively loads the TypeScript compiler. `governance.ts` and
  `release/preflight.ts` each imported `runFoundationCheck`/
  `computeBuildOrder` from the `./gates/index.js` barrel rather than from
  the specific files those functions live in — and that barrel also
  re-exports `secret-gates.ts`, whose own top-level `import ts from
  "typescript"` rode along with it regardless of which single export a
  caller actually wanted. A plain root import now stays free of the
  compiler itself; a consumer who deliberately imports the public
  `@vespeneventures/governance/gates` subpath still gets everything,
  unchanged, secret-gates included. This is specifically about
  `typescript`: the root already used `node:fs` (workspace discovery) and
  `preflightGovernedPackage` already used `node:child_process` (a real
  tarball pack-and-install check) before this change, for reasons entirely
  unrelated to the barrel-import bug fixed here — see the README's
  "Requirements" section for the precise boundary. Surfaced by a consumer
  integration (#152).

## [0.2.0] - 2026-08-12

### Added

- Explicit lifecycle maturity states for incubating, published, qualified,
  and adopted packages, while retaining legacy `active` records for schema-v1
  compatibility.
- A distinct retired state with dated durable retirement evidence and CLI
  maturity summaries.
- The `catalog`, `gates`, `release`, `repository`, and `review` subpaths,
  including the review GitHub normalizer and established process CLIs.

### Changed

- Governance now owns its package-process implementations and depends only on
  policy plus TypeScript for source-aware gates. The former standalone package
  names are compatibility packages with documented migration paths.

## [0.1.1] - 2026-08-11

### Fixed

- Depend on the publishable `@vespeneventures/release@^0.1.1` closure so an
  isolated consumer can install the governance package.

## [0.1.0] - 2026-08-11

### Added

- A declarative, complete package lifecycle registry with explicit
  deprecation replacements.
- Read-only workspace and package-preflight orchestration over the existing
  catalog, gates, and release packages.
- A deterministic no-write package starter plan. A complete profile is now
  caller-owned and must supply real metadata, tooling, license text, and a
  dated changelog entry; unprofiled plans are private starters, never claimed
  to be publishable.
- Compact CLI reports with JSON and verbose output modes, plus explicit
  lifecycle-file and workspace-root input errors.
- Deprecated-package evidence requirements: either a replacement package and
  semver range or a terminal no-successor reason, plus a date, decision
  reference, and migration reference.
- A shared preflight scope forwarded consistently to both release and
  governance checks.
