# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.1] - 2026-09-23

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.4.0
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a
  new version.

## [0.4.0] - 2026-09-22

### Added

- **`FleetInstalledPackage.manifestPaths` and `InstalledCoverageCell.manifestPaths`
  (#395)**, settling the definition #395's own 2026-08-21 comment left
  unsettled: does "installed" mean a root-manifest pin, or any manifest?
  Decided by the owner (2026-09-21): a pin in ANY manifest in the repository
  counts as installed, because a monorepo consumer legitimately pins a role
  inside a workspace package rather than at the repository root. The new,
  optional `manifestPaths` field records which manifest path(s) actually
  carry the pin, so that placement — hub-level infrastructure versus a
  single product package, or a pin that landed in the wrong bucket entirely
  — stays visible to a reviewer and to Advisor's own placement evidence
  instead of collapsing into a bare `installed` boolean. Purely additive:
  a caller that omits the field, or an already-serialized report from
  before this change, still parses and grades exactly as before.
  `observer-coverage-check`'s rendered text report now shows
  `via <path>, <path>` alongside an installed cell's version when the
  caller supplied it.

### Notes

- The declaration a consuming repository writes lives at `clossys/coverage.json`
  (a single visible `clossys/` folder, one file per repository) -- per #1171
  (owner-approved 2026-09-22), not the hidden `.clossys/` this location
  briefly used before that decision. Nothing shipped at the earlier path.
- The collector that actually walks a real checkout's manifests and
  populates `manifestPaths` (#395) lives in this repository outside this
  package, on purpose: this package stays zero I/O and grades whatever it
  is handed. See that collector's own documentation for the collection
  rules (every dependency block, including `overrides` and `resolutions`;
  never learns or names a competing package).
- Qualification of `0.4.0` is deferred under #948 (this machine is not the
  pinned release runtime). This is a merge acknowledgement, never a
  publication claim.

## [0.3.2] - 2026-09-21

### Fixed

- `observer-coverage-check` writes CLI output with `writeSync` on the stdio
  file descriptors so piped consumers see stdout before the process exits
  on Node 20.

## [0.3.1] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.3.0] - 2026-09-19

### Added

- `mapBundleToPlacementCells()` (`placement-cells.ts`), the bundle-to-cells
  adapter issue #997 names: converts one caller-supplied observation bundle
  into advisor's `HubPlacementEvidence` cell shapes — an installed
  `@clossys` package absent from the read `devDependencies` is an
  `over-install` cell, a declared-but-unreadable package is a `missing`
  cell, and an installed version strictly below its declared range's floor
  is a `stale` cell.
- `HubPlacementCellKind`, `HubPlacementCellInput`,
  `RepositoryPackageObservation`, and `HubPlacementObservationBundle` —
  the adapter's exported shapes. The cell shape mirrors
  `@clossys/advisor`'s `HubPlacementCell` structurally, not by import: this
  package adds no dependency on advisor, the same move
  `FleetInstalledInventory` already makes for integrator's inventory.
- A README section documenting the adapter, its three mappings, and what it
  deliberately does not do (fetch, clock-read, assemble a
  `placementEvidence` document, or judge non-`@clossys` placements).

## [0.2.9] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `unobserved outcome rate`, computed by
  `assessUnobservedOutcomeRate()`. An empty evaluated set is indeterminate,
  never a perfect rate of 0. This package does not measure consumer evidence
  and does not close the loop.
- Declared `foundry.assessment` against the mapped `observer-check` bin with
  `invocation: "single-json-input"`, so first-day onboarding discovers this
  role's assessment surface from the installed manifest instead of inferring
  one. Advisor remains the only required first-day role.
- `observer-check assessment.json`: prints the `unobserved outcome rate`
  report and exits on the `0` / `1` / `2` ternary.
- `assessUnobservedOutcomeRate()` computes that charter metric from
  consumer-supplied independent observations, reusing `computeUnobservedSurface`
  for the three-state sort. It does not combine this rate with escape rate.

### Notes

- This does not claim the position is closed. Qualification of `0.2.9` is
  deferred under #833.

## [0.2.8] - 2026-09-16

### Fixed

- **`gradeFleetCoverage` no longer returns a confident `satisfied` on a
  malformed coverage declaration (issue #897 audit finding A).**
  `coverage.ts` computed a `declarationIsInvalid` flag but the
  `installedPackage !== undefined` branch `continue`d before ever
  consulting it, so the flag was reachable only on the not-installed path.
  A repository whose declaration failed validation but that had every
  package genuinely installed graded every cell `installed`, zero
  unclassified, zero contradictions -- a clean `satisfied`, exit `0` --
  with no trace anywhere that its declaration could not be read. This
  matters beyond one bad exit code: a **stale `declared-absent` entry**
  hiding inside a malformed declaration is the one contradiction this
  module exists to surface (see `FleetCoverageContradiction`), and it
  became undetectable exactly when the declaration was unreadable. As this
  fleet's packages move toward "installed everywhere," the affected case
  -- every package installed, one bad declaration -- stops being an edge
  case and becomes the steady state, so the signal was heading toward
  disappearing entirely.
  - The fix consults `declarationIsInvalid` on the installed path too.
    Ground truth still wins for the cell's own `state` (it stays
    `"installed"`, matching this module's existing contradiction handling
    and its own test at `coverage.test.ts`'s "a package confirmed
    installed still resolves to installed even when the declaration is
    unreadable") -- hiding a real install because a stale or merely
    unreadable declaration disagrees would be worse than the problem this
    contract exists to solve. What changed is the *aggregate*: such a cell
    is now recorded in a new `FleetCoverageReport.unverifiedInstalledCells`
    list and forces the verdict to `indeterminate`
    (`installed-cell-with-unreadable-declaration`) rather than
    `satisfied`, at the same precedence as an unclassified cell -- both are
    "we don't know," not "we know it's clean," and `violated` requires a
    *known* contradiction this case does not have. `observer-coverage-check`
    (`cli.ts`) now also prints these cells under a new "Unverified" section
    in its rendered report.
  - The pre-existing test at `coverage.test.ts` ("a package confirmed
    installed still resolves to installed even when the declaration is
    unreadable") used a multi-package catalogue where a sibling cell was
    already unclassified, so its aggregate landed on `indeterminate` for an
    unrelated reason and the test asserted only per-cell states, never the
    aggregate -- masking this defect. A new test, "an all-installed
    catalogue with an unreadable declaration must NOT resolve to
    satisfied," uses a single repository where every package is installed
    and nothing else is unclassified, and asserts the aggregate verdict
    directly.
- **The documented input to `parseCoverageDeclaration` was the failing
  input (issue #897 audit finding B).** `README.md`, the CLI's own
  `--help`, and `coverage-declaration.ts`'s own header all instructed a
  caller to pass "the already-fetched body" of a repository's
  coverage-declaration file -- and that body, fetched with the plain,
  unauthenticated raw-content HTTP GET this contract is explicitly
  designed around, is a **string**. `parseCoverageDeclaration` required an
  already-`JSON.parse`d object and rejected a string outright with
  `coverage-declaration/not-an-object`. Following the documentation
  literally landed a caller directly on finding A above: a
  `not-an-object` declaration is exactly the "malformed declaration" case,
  and (before finding A's fix) with every package installed this graded a
  confident `satisfied`.
  - Fixed by making `parseCoverageDeclaration` accept **either** shape: an
    already-parsed value (unchanged, still works) or the raw JSON string a
    real `fetch(url).then((r) => r.text())` actually returns, which it now
    `JSON.parse`s internally. Chosen over the documentation-only fix
    (saying "already-parsed" in the docs) because a raw-content GET
    naturally hands a caller a string, not a pre-parsed value, and making
    the function accept what its own designed transport actually produces
    removes an entire class of caller mistake rather than merely
    describing it more precisely.
  - **Fails closed, never throws:** a string that is not valid JSON
    returns `{ ok: false, findings: [...] }` with a new
    `coverage-declaration/invalid-json` finding, exactly like any other
    shape defect -- never an unhandled `SyntaxError`. This is untrusted
    input from a stranger's repository; a malformed body is data for
    `coverage.ts` to grade as `declaration-unreadable`, not a program
    error that crashes a whole fleet run over one repository's bad file.
  - `README.md`, `cli.ts`'s `USAGE` text, and `coverage-declaration.ts`'s
    own module header and `parseCoverageDeclaration` doc comment are all
    updated consistently to state that both shapes are accepted.

## [0.2.7] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.2.6 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.2.6` path, so this package moves to `0.2.7`
  purely to regain one. No functional or behavioral change.


## [0.2.6] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.2.5] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `observer-coverage-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


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
    `@clossys/integrator`'s own `InstalledInventory`, named here
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
  `@clossys/builder`'s `ci/cli.ts` + `ci/bin.ts` split; `bin.ts` is
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

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/clossys/foundry/issues/273). No runtime behavior changed.

## [0.1.1] - Unreleased

### Changed

- **`live-state.ts`'s header comment now names
  `@clossys/controller/conventions` as the canonical home for the
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
