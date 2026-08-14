# Changelog

All notable changes to this package are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.6] - 2026-08-14

### Changed

- Widened the `@vespeneventures/governance` dependency range to `~0.9.0`
  so the compatibility package remains linked to governance 0.9.0. No release
  export changed.

## [0.2.5] - 2026-08-14

### Changed

- Widened the `@vespeneventures/governance` dependency range to `~0.8.0`
  (was `^0.7.0`) so this package can pick up governance's 0.8.0 addition of
  the `./cleanup` subpath (`classifyCleanupCandidate`, a pure workspace-
  cleanup classifier). No change to any export this package re-exports; no
  functional change here.

## [0.2.4] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.7.0`
  (was `^0.6.0`) so this package can pick up governance's 0.7.0 addition of
  the `./artifacts` subpath (`verifyGovernedArtifact`/
  `verifyGovernedArtifacts`, a governed-artifact checksum/schema-version/
  provenance verification contract). No change to any export this package
  re-exports; no functional change here.

## [0.2.3] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.6.0`
  (was `^0.5.0`) so this package can pick up governance's 0.6.0 addition:
  `packRoundTrip`'s new `tarballPath` option, which lets a caller point the
  round trip at an already-packed tarball instead of always re-packing
  `packageDir`. The re-exported `PackRoundTripOptions` type gains this new
  optional field; no other change to any export this package re-exports.

## [0.2.2] - 2026-08-13

### Changed

- Widened the `@vespeneventures/governance` dependency range to `^0.5.0`
  (was `^0.4.0`) so this package can pick up governance's 0.5.0 fix to
  `packRoundTrip` (wildcard `exports` subpaths are now expanded against the
  files a tarball actually shipped instead of being resolved as literal
  paths). No change to any export this package re-exports, though the
  re-exported `ImportCheck["mode"]` union gains governance's new `"pattern"`
  member and `RoundTripResult["findings"]` its new
  `"round-trip-pattern-unmatched"` rule; the README documents both. No
  functional change in this package itself.

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
- Corrected the README's stated runtime dependencies. It previously
  described a pre-consolidation set — `@vespeneventures/gates` and
  `@vespeneventures/policy` — that no longer exists; the package's actual
  runtime dependency is `@vespeneventures/governance`.
- No functional change to the deprecation: this remains a deprecated
  compatibility package; new integrations should use
  `@vespeneventures/governance/release` directly.

## [0.1.3] - 2026-08-12

### Deprecated

- Migrate to `@vespeneventures/governance/release`. This compatibility release
  preserves the existing root exports.

## [0.1.2] - 2026-08-12

### Added

- Isolated Next.js compilation proof for explicitly configured framework
  export subpaths.

## [0.1.1] - 2026-08-11

### Added

- Scoped private-registry install proof that preserves npmjs resolution for
  unscoped runtime dependencies.

## [0.1.0] - 2026-08-11

### Added

- Initial isolated tarball pack, install, import, and digest-verification
  helpers.
