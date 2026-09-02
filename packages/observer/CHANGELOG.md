# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.4] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.2.3] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.2.2] - 2026-08-29

### Fixed

- Hardened Observer's command-line Markdown table renderer so untrusted cell
  text escapes existing backslashes before pipe characters and normalizes all
  line endings without allowing a crafted value to create extra table cells or
  rows.

## [0.2.1] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.2.0] - 2026-08-20

### Added

- **Fleet package coverage grading (#395)**, closing the observability gap
  that made this fleet's own coverage matrix ungradeable: 26 of 60
  package-repository cells had no way to distinguish "this repository
  decided it needs no such lane" from "nobody has swept it yet."
  - `coverage-declaration.ts`: the `CoverageDeclaration` contract a
    repository writes, once, to state out loud (with a **required
    reason**) that it has decided not to install one of this fleet's
    packages. `validateCoverageDeclarationShape` / `parseCoverageDeclaration`
    validate an untrusted, already-fetched payload without throwing;
    `writeCoverageDeclaration` builds and serializes a well-formed one. The
    module's own header records why the declaration format is designed to
    be committed at a fixed path and read via a plain, unauthenticated
    raw-content GET — the "no credential per account" constraint #395
    requires — rather than through this fleet's own npm registry (GitHub
    Packages requires a token even for a public package) or the GitHub
    contents API (rate-limited without one).
  - `coverage.ts`: `gradeFleetCoverage`, which grades a fleet's package
    catalog against every repository's raw declaration and
    caller-supplied installed inventory into exactly three cell states —
    `installed` / `declared-absent` / `unclassified` — plus one aggregate
    `satisfied` / `violated` / `indeterminate` verdict.
    **`unclassified` fails closed**: never counted as covered, never
    dropped from the denominator, and always drives the aggregate to
    `indeterminate` — the opposite of `assertPeerVersion`'s deliberate
    warn-and-proceed for an unparseable *runtime* value elsewhere in this
    fleet, which is a different kind of check (an import guard) answering
    a different question. A repository both installed and
    declared-absent for the same package resolves to `installed` (ground
    truth wins) and is reported separately as a `FleetCoverageContradiction`,
    driving the aggregate to `violated` when nothing is unclassified. An
    empty matrix (`packages.length * repositories.length === 0`) resolves
    to `indeterminate`, never `satisfied` — issue #338's own failure mode
    ("a run that evaluated nothing reports satisfied"), refused here by
    construction.
  - The installed inventory is a **caller-supplied** input, never fetched:
    `FleetInstalledInventory` is a structural match for
    `@vespeneventures/integrator`'s own `InstalledInventory`, named here
    rather than imported, so this package adds **no runtime dependency**
    to grade coverage. It remains at zero.
  - Deliberately a NEW module, not an extension of the existing
    `computeUnobservedSurface` (`unobserved-surface.ts`), despite #395
    pointing at it first: the mandated vocabulary
    (`installed`/`declared-absent`/`unclassified`) doesn't match
    `Observation<T>`'s hard-coded `observed`/`unobserved`/`could-not-read`
    states, `declared-absent`'s mandatory `reason` has no home in
    `unobserved`'s payload-free branch, and this package's own rule
    against blending `EscapeRateMetric` and `UnobservedSurfaceMetric`
    into one score applies here too — coverage-by-installation and
    telemetry-presence are a different question. See `coverage.ts`'s own
    header and the README's "Fleet package coverage" section for the full
    reasoning.
- **`observer-coverage-check`, this package's FIRST bin** (#377: "gates
  shipped as library exports with no CLI path are decorative" — until now,
  `observer` shipped zero bins, exactly the case that issue names).
  `cli.ts` exports a port-injected `main(argv, port)` (testable with an
  in-memory `CliPort`, no real filesystem needed), mirroring
  `@vespeneventures/builder`'s `ci/cli.ts` + `ci/bin.ts` split; `bin.ts` is
  the thin installed executable wiring the real `node:fs`/`process` port.
  Reads one caller-assembled JSON input document (the package catalog,
  plus each repository's already-fetched declaration and already-computed
  installed inventory — this CLI performs no fetching or manifest parsing
  of its own) and exits `0` satisfied / `1` violated / `2` indeterminate,
  this package's one gate ternary. A direct-path reachability test spawns
  the real compiled `dist/bin.js` via `execFileSync` and asserts real exit
  codes for all three states plus the empty-matrix case, per #377's own
  requirement that every CLI fix prove the shipped artifact is reachable,
  not merely the function it wraps.
- New exports from `./index.ts`: `COVERAGE_DECLARATION_SCHEMA_VERSION`,
  `DeclaredPackageAbsence`, `CoverageDeclaration`,
  `CoverageDeclarationFinding`, `ParsedCoverageDeclaration`,
  `InvalidCoverageDeclaration`, `WriteCoverageDeclarationInput`,
  `validateCoverageDeclarationShape`, `parseCoverageDeclaration`,
  `writeCoverageDeclaration`, `CoverageCellState`, `FleetInstalledPackage`,
  `FleetInstalledInventory`, `UNCLASSIFIED_REASONS`, `UnclassifiedReason`,
  `InstalledCoverageCell`, `DeclaredAbsentCoverageCell`,
  `UnclassifiedCoverageCell`, `CoverageCell`, `FleetCoverageContradiction`,
  `FleetRepositoryCoverageInput`, `FleetCoverageInput`,
  `CoverageCellCounts`, `FleetCoverageVerdict`, `FleetCoverageReport`,
  `gradeFleetCoverage`, `fleetCoverageVerdictToExitCode`.

### Changed

- The package description and keywords now mention fleet coverage grading
  and its CLI. The library (everything except `cli.ts`/`bin.ts`) remains
  zero I/O; the CLI is this package's only I/O, and only through an
  injected port.
- `tsconfig.json` now declares `"types": ["node"]`, required for `bin.ts`'s
  and `cli.ts`'s use of `node:fs` and `process` — this package's first use
  of either.

### Out of scope, on purpose

- Driving this fleet's 26 currently-unclassified cells to a real state
  across ten repositories is per-repository adoption work, not a
  mechanism change, and is not part of this release. See issue #395 for
  the tracking.

## [0.1.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.1.1] - Unreleased

### Changed

- **`live-state.ts`'s header comment now names
  `@vespeneventures/controller/conventions` as the canonical home for the
  `liveStateSurface` shape and states explicitly why this package keeps its
  own copy instead of depending on it (#255): `observer`'s own contract is
  zero runtime dependencies, and adding one to dedupe five frozen strings
  and one small interface would spend that property for less than it costs.
  No behavioural or API change — `LiveStateSurface`, `liveStateFindingKinds`,
  `validateLiveStateSurface`, and `OBSERVER_TELEMETRY_LOG_SURFACE` are
  unchanged.

## [0.1.0] - Unreleased

### Added

- Initial release. `observer` measures what actually happened: telemetry
  contracts, retention, redaction, and gate efficacy — never the gate
  package it measures.
- **Telemetry contract** (`telemetry.ts`): `TelemetryEvent` shape, a
  declared 90-day retention window (`TELEMETRY_RETENTION_WINDOW_DAYS`,
  `isWithinRetentionWindow`), and `validateTelemetryEvent`.
- **`liveStateSurface`** (`live-state.ts`), adopted from issue #255:
  `LiveStateSurface`, `validateLiveStateSurface`, the generalized
  `liveStateFindingKinds` vocabulary including `declared-but-not-verifiable`,
  and this package's own honest declaration,
  `OBSERVER_TELEMETRY_LOG_SURFACE`, stating that it owns no telemetry store
  of its own.
- **Redaction as a tested contract** (`redaction.ts`): `redactEvent` and
  three serialization forms (`serializeEventAsJSON`,
  `serializeEventAsLogLine`, `serializeEventAsCsvRow`) that redact
  internally before producing any output, plus `redaction.test.ts` — a test
  that constructs an event with a secret-shaped value in a redacted field,
  serializes it every way this package can, and asserts the value is not a
  substring of any output.
- **Gate efficacy over caller-supplied run history** (`gate-efficacy.ts`):
  the `RunHistoryReader` port (no implementation shipped — this package
  performs no I/O and calls no API), and `computeGateEfficacy`, which tallies
  whether a gate ran and what it concluded, purely from what the injected
  reader returns.
- **Escape rate** (`escape-rate.ts`): `computeEscapeRate`, the number that
  closes a gate's loop — changes that reached the default branch and
  violated a rule, divided by changes that landed — computed from
  independently caller-sourced `LandedChangeOutcome` ground truth, never
  from a gate's own verdict.
- **Unobserved surface** (`unobserved-surface.ts`): `computeUnobservedSurface`,
  which sorts declared subjects into observed / unobserved / could-not-read,
  treating a subject with no read supplied at all as `could-not-read` —
  never silently as `unobserved`.
- **Three-state read result enforced in the types**
  (`observation.ts`): every read in this package returns an
  `Observation<T>` discriminated union — `"could-not-read"` requires a
  `note` and cannot carry the observed payload; `"observed"` cannot omit
  it. A narrower or looser result does not type-check.
- **The two metrics reported separately, provably** (`metrics.check.ts`,
  `metrics-non-combination.test.ts`): `EscapeRateMetric` and
  `UnobservedSurfaceMetric` share no field name beside their `kind`
  discriminant, checked at compile time; no exported function accepts both,
  checked at runtime.
- Zero runtime dependencies. Zero I/O.
