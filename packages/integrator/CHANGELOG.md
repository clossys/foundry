# Changelog

All notable changes to `@vespeneventures/integrator` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.2.1]

### Fixed

- `currencyVerdict` now folds `absent-without-reason` to `violated` rather than
  `indeterminate`. Nothing about an unexplained absence is unexamined: the
  package is entitled, it is not installed, and no opt-out records a decision to
  leave it out. That is a complete evaluation reaching a negative answer, and
  reporting it as indeterminate demoted a settled violation into "could not
  tell". Because indeterminate outranks violated in the fold, it could also mask
  a genuine major gap appearing alongside it. `unreachable`, `unauthenticated`
  and `indeterminate` are unchanged — those are the states where something
  genuinely could not be determined.

## [0.2.0] - Unreleased

### Added

- **Breaking: `judgeCurrency`'s `behind` state is now graded by semver distance
  instead of being one undifferentiated "drift" finding.** `behind` carries
  a new `severity: "patch" | "minor" | "major"`, computed by the new
  `classifyCurrencyDistance(installedVersion, latestVersion)`: a patch gap
  is `"patch"`, a minor gap is `"minor"`, a major gap is `"major"` — and a
  pre-1.0 (`0.y.z`) minor gap also grades `"major"`, since semver explicitly
  permits a `0.y` minor bump to break. `upgradeSet`'s entries carry the same
  `severity`. A version this package cannot safely grade at all —
  unparseable, or carrying a prerelease identifier on either side — is a new
  `indeterminate` state (`PackageCurrency` now has seven states, not six),
  with a machine-readable `reason` (`"version-unparseable"` or
  `"version-not-comparable"`); it is never folded into `current` or
  `behind`. This closes the gap a consuming plane previously had no choice
  but to hand-roll its own version of: uniformly treating every currency
  finding as equally blocking trains a consumer to read a currency gate's
  red as "go bump something" rather than "something is wrong," and buries
  the one distance semver actually promises may break (major, including
  pre-1.0 minor) under the noise of routine patches. This package grades;
  it does not decide policy — folding `severity` into a pass/fail gate
  contract remains the caller's own decision, same as always.

### Documentation

- **README states a consuming plane's currency-gate loop-close condition
  (issue #286's acceptance criterion), and honestly discloses issue #330 —
  the pnpm-lockfile reading gap — as an open loop item rather than glossing
  over it.** Closes when the gate reports green only by currency or by
  recorded opt-out, never by silence; reopens on any drift a gate now
  catches that a consumer previously had to write its own evaluation logic
  to find. No code change.

## [0.1.0] - 2026-08-18

### Added

- `loadEntitlementDeclaration` for offline validation of what catalogue a
  plane is entitled to, and its per-package opt-outs. Every opt-out requires a
  non-empty `reason` — an opt-out with none is rejected outright, since a
  recorded reason is what turns an absence into a decision instead of drift.
- `readInstalledInventory` and `createNodeInventoryFileSystem` for reading a
  plane's own manifest and lockfile through an injected `InventoryFileSystemPort`,
  following `@vespeneventures/provisioning`'s injected-port pattern. Reports
  only what actually resolves in the lockfile, not merely what is declared.
- `probeReachability` and `resolveReachability` for a registry reachability
  probe over an injected `Transport`. Resolves the `unreachable` vs
  `unauthenticated` ambiguity a single `404` cannot answer by itself, using
  the same aggregate-batch reasoning as this repository's own
  `scripts/check-package-visibility.mjs`: if nothing in a probed batch comes
  back known, a blind credential explains every `404` in it better than an
  entire entitled catalogue slice having never been published.
- `judgeCurrency` for the version reconciler: combines entitlement, installed
  inventory, and reachability into `PackageCurrency[]`, a discriminated union
  enforcing exactly the six required states — `current`, `behind`,
  `absent-with-reason`, `absent-without-reason`, `unreachable`,
  `unauthenticated` — so that a narrower or malformed result cannot
  type-check.
- `upgradeSet` and `optOutGaps` for the loop's act step: the upgrade set and
  the entitled-absent-unexplained gaps.
- `computeCurrencyMetric` for this package's stated metric: the share of
  entitled packages installed and at the latest published version, plus,
  reported separately, the count entitled-and-absent with no recorded
  opt-out.
- `loadAdmissionContract` and `evaluateAdmission` for the admission contract:
  `must-be-entitled`, `must-not-be-opted-out`, `requires-known-reachability`,
  and `minimum-version` rules, composed entirely from data this package
  already models rather than a new external source.
- `parseVersion` and `compareVersions`, a minimal dependency-free semantic
  version parser and comparator.
- `IntegratorValidationError` with a stable `IntegratorErrorCode`, thrown by
  every offline validator in this package.

[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/integrator-v0.1.0
