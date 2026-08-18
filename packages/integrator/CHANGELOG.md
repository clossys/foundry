# Changelog

All notable changes to `@vespeneventures/integrator` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
