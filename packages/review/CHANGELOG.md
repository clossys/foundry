# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.6.0`
  (was `^0.5.0`) so this package can pick up governance's 0.6.0 addition
  (`packRoundTrip`'s new `tarballPath` option). No change to any export this
  package re-exports; no functional change here.

## [0.2.2] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.5.0`
  (was `^0.4.0`) so this package can pick up governance's 0.5.0 fix to
  `packRoundTrip` (wildcard `exports` subpaths are now expanded against the
  files a tarball actually shipped instead of being resolved as literal
  paths). No change to any export this package re-exports; no functional
  change here.

## [0.2.1] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.4.0`
  (was `^0.3.0`) so this package can pick up governance's 0.4.0 additions
  (new `evaluateRatchet`, `checkOverrideTargetRanges`, and
  `checkDependencyScope` gates under `./gates`; no change to any export
  this package already re-exports). No functional change here.

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
  "Zero runtime dependencies," but the package genuinely depends on
  `@vespeneventures/governance` (which itself depends on
  `@vespeneventures/policy`) via its own `src/index.ts` re-export.
- No functional change to the deprecation: this remains a deprecated
  compatibility package; new integrations should use
  `@vespeneventures/governance/review` directly.

## [0.1.1] - 2026-08-12

### Deprecated

- Migrate to `@vespeneventures/governance/review` and its `./github` subpath.
  This compatibility release preserves the root and GitHub exports plus the
  `review-check` command.

## [0.1.0] - 2026-08-11

### Added

- Provider-neutral contracts for review evidence, required checks, decisions,
  and review threads.
- Deterministic, fail-closed evidence validation with no I/O.
- A pure `@vespeneventures/review/github` normalizer for caller-provided
  GitHub-shaped payloads.
- The `review-check` CLI for deterministic JSON evidence and policy reports.
