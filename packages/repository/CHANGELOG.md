# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-08-15

### Changed

- Updated the `@vespeneventures/governance` dependency range from `~0.11.0`
  to `~0.12.0`
  so this deprecated repository facade remains linked after governance's
  separate advisory-review-contract release. Its repository v1/v2/v3 exports
  and semantics are unchanged.

## [0.4.2] - 2026-08-14

### Changed

- Updated the `@vespeneventures/governance` dependency range from `~0.10.1`
  to `~0.11.0`
  so this deprecated repository facade remains linked after governance's
  separate composition-contract release. Its repository v1/v2/v3 exports and
  semantics are unchanged.

## [0.4.1] - 2026-08-14

### Fixed

- Forwarded governance 0.10.1's restored no-I/O repository import boundary
  (#243). The compatibility CLI API is now inert on import and a dedicated
  executable wrapper preserves the installed `repository-check` command,
  including invocation through npm-created bin symlinks. Repository profile
  v1, v2, and v3 behavior is unchanged.

## [0.4.0] - 2026-08-14

### Changed

- **Breaking for exhaustive type consumers:** forwards profile v3 and the
  exact-root declaration/evaluation API from
  `@vespeneventures/governance/repository`. Closed v1 and v2 profiles remain
  supported; new declarations use v3. The governance dependency is now
  `~0.10.0`.

## [0.3.0] - 2026-08-14

### Changed

- **Breaking for exhaustive type consumers:** forwards the repository profile
  v2 and pure requirements-evaluation API from
  `@vespeneventures/governance/repository`. The v1 profile remains explicitly
  supported; new declarations use v2. The governance dependency is now
  `~0.9.0`.

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
  `@vespeneventures/governance/repository` directly.

## [0.1.1] - 2026-08-12

### Deprecated

- Migrate to `@vespeneventures/governance/repository`. This compatibility
  release preserves the existing root exports and `repository-check` command.

## [0.1.0] - 2026-08-10

### Added

- A dependency-free repository profile contract for consumer-owned branch,
  command, and protected-path values.
- Deterministic validation with no I/O or provider behavior.
- `repository-check`, which reads one consumer-owned JSON profile and emits a
  deterministic validation report without invoking commands, Git, or a
  provider API.

### Changed

- Profile command and protected-path collections are bounded at 10,000 entries
  so untrusted configuration has a finite validation cost.
