# Changelog

## [0.4.0] - 2026-08-13

### Added

- `checkLocaleCoverage`, a governance checker over a set of locale-keyed
  `CopyRegistry` objects and a declared source locale: reports entries
  missing from a target locale and entries orphaned in a target locale (no
  longer present in the source). Stale-translation detection was deliberately
  left unimplemented — `CopyRegistryEntry` has no per-entry revision to
  compare, and `CopyRegistry.revision` is a whole-registry, unordered
  provenance string that cannot safely stand in for one; every run reports
  this gap as its own finding rather than silently skipping it.
- Fails closed, distinctly, on an empty registry set, an empty declared-locale
  set, a source locale with zero entries, and a declared target locale that
  is entirely absent — none of these report a clean pass.
- Documented this package's position on i18n in the README: translation
  runtime (ICU, plural rules, locale negotiation, formatting) stays out of
  scope by design; translation governance (coverage, drift) is this
  package's job. Also documents the voice-glossary/i18n-glossary
  distinction, and why an i18n glossary is not added to `copy/voice` in this
  release — it would require a new locale-keyed term registry, not a small
  extension of `GlossaryEntry`.

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
