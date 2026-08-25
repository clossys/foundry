# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
