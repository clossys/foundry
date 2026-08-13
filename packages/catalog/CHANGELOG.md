# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-13

### Changed

- **Breaking:** now requires `@vespeneventures/governance@^0.3.0` (was
  `^0.2.0`). Because this package re-exports governance, governance's
  0.3.0 lifecycle-schema requirement applies through it too — see
  `@vespeneventures/governance`'s own changelog for the full detail on
  `forwardsToReplacement` and the `qualifiedEvidence`/`adoptedEvidence`
  fields. Under this repo's pre-1.0 semver policy a breaking change to a
  0.x package is a MINOR bump, not MAJOR.
- Corrected the README's stated runtime dependencies. It previously claimed
  "No runtime dependencies," but the package genuinely depends on
  `@vespeneventures/governance` (which itself depends on
  `@vespeneventures/policy`) via its own `src/index.ts` re-export.
- No functional change to the deprecation: this remains a deprecated
  compatibility package; new integrations should use
  `@vespeneventures/governance/catalog` directly.

## [0.1.1] - 2026-08-12

### Deprecated

- Migrate to `@vespeneventures/governance/catalog`. This compatibility release
  preserves the existing root exports.

## [0.1.0] - 2026-08-06

### Added

- Workspace catalog construction that records discovered package manifests and
  non-fatal discovery skips from the real filesystem.
- Deterministic evaluation of internal dependency resolution, dependency
  cycles, and catalog completeness from the collected manifests.
- Pure helpers for package lookup, internal dependency discovery, and
  dependency-closure calculation.
