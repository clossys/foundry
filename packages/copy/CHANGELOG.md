# Changelog

## [0.3.1] - 2026-08-13

### Fixed

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated. Surfaced by a consumer integration (#147).

## [0.3.0] - 2026-08-12

- Added the strict, locale-aware `CopyRegistry` and `CopyRef` resolution API
  for audience-facing rendered surfaces, including entry lifecycle and source
  provenance.
- Added `createCopyResolver` and `resolveCopyRef`; required copy now fails
  closed for unknown IDs, locale mismatch, unapproved lifecycle state, and
  placeholder mismatches.

## [0.1.0] - 2026-08-07

- Consolidated the voice contract, template, validation, and checker into
  `@vespeneventures/copy`.
- Added `@vespeneventures/copy/voice` and
  `@vespeneventures/copy/voice-record.template.jsonc` entry points.
