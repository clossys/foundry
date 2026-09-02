# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-02

### Added

- Export `BASIS_FIELDS` and `BASIS_DIGEST_FIELDS`, the exact field lists an `AssessmentBasis` is built from, so a caller deriving its own current basis from source material can stay bound to this package's own contract instead of a hand-copied field list.
- Export `sameBasis()`, `sameStrings()`, and `packageKey()` — the exact comparison primitives `validateExecutionAuthorization()` is built from — so a caller independently verifying an authorization, a basis, or a package set against its own retained evidence can reuse them instead of re-implementing content-addressed comparison.

## [0.1.6] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.5] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.4] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.3] - 2026-08-27

### Added

- Add `advisor-execution-readiness`, which re-derives execution readiness at a
  runner-supplied instant and requires exact current authorization before it
  returns ready.

## [0.1.2] - 2026-08-25

### Fixed

- Require every unknown readiness criterion to have matching, owned
  `indeterminate` pre-work; retain the exact `violated` to `unresolved`
  requirement and reject either status mismatch.
- Compare delivery and independent-outcome owner references case-insensitively
  before accepting independent outcome measurement.

## [0.1.1] - 2026-08-24

### Fixed

- Validate a retained execution authorization during recurring assessment and
  command-line evaluation using the same exact-plan, freshness, sponsor, and
  scope contract used for session approval.

## [0.1.0] - 2026-08-24

### Added

- Provider-neutral sponsor fit, readiness, initiative-overlap, and pre-work assessment engine.
- First-wave plans that gate installation on evidenced baseline and conflict clearance.
- Pure session state machine and connector-facing tool contracts and handlers.
- `advisor-check` for JSON assessment reports with three-state exit semantics.
