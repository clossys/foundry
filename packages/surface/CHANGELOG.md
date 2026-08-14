# Changelog

## [0.1.10] - 2026-08-13

### Added

- **`react` peer-version guard.** `src/web/renderWebDocument.ts` — the
  canonical `./web` entry point, which already transitively covers
  `./web/internal/webTemplates.ts`'s own `react` usage — now calls
  `assertPeerVersion` (new internal `src/internal/peer-version.ts`) at
  import time, throwing a named, actionable error when the optional
  `react` peer is either not installed or installed outside this
  package's declared `>=18` range — distinct messages for each case, read
  from `react`'s own exported `version` (not a filesystem read, so this
  works whether `./web` is reached from a server or a browser bundle).
  `react-dom` has no guard: no file in this package imports it directly.
  Previously, an absent or incompatible `react` produced no signal until
  `createElement` itself crashed. See the README's "Requirements and
  version coupling" section. (#182)

## [0.1.9] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.10.0` to `~0.11.0` to
  track that package's 0.11.0 release, which adds marketing/editorial
  content blocks (`Hero`, `FeatureGrid`, `Faq`, `PricingTable`,
  `Testimonial`, `ArticleBody`) at the `./blocks` subpath. Required for the
  same reason as every prior range widening in this file: in 0.x semver a
  tilde range is minor-locked, so `~0.10.0` excluded `ui` 0.11.0 and the
  dependency stopped resolving to the sibling package. No API change here
  — this package does not use the new block exports.

## [0.1.8] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.9.0` to `~0.10.0` to
  track that package's 0.10.0 release, which adds public-site chrome
  (`SkipLink`, `SiteHeader`, `NavShell`, `SiteFooter`) at the `./shell`
  subpath. Required for the same reason as every prior range widening in
  this file: in 0.x semver a tilde range is minor-locked, so `~0.9.0`
  excluded `ui` 0.10.0 and the dependency stopped resolving to the sibling
  package. No API change here — this package does not use the new shell
  exports.

## [0.1.7] - 2026-08-13

### Changed

- README now states up front that this package renders and validates but
  deliberately does not compose: there is no step that takes an intent and
  selects a template, and there will not be one. Consumers were evaluating
  this package as a replacement for a composition engine and reaching that
  conclusion only after real investigation. Documentation only — no API
  change; the boundary described is the one that already existed.

## [0.1.6] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.8.0` to `~0.9.0` to track
  that package's 0.9.0 release, which promotes its WCAG colour module to
  public API and adds a checked-in contrast gate (`checkTokenContrast`,
  `ui-contrast-check`). Required for the same reason as every prior range
  widening in this file: in 0.x semver a tilde range is minor-locked, so
  `~0.8.0` excluded `ui` 0.9.0 and the dependency stopped resolving to the
  sibling package. No API change here — this package does not use the new
  contrast exports.

## [0.1.5] - 2026-08-13

### Changed

- Widened the `@vespeneventures/copy` range from `~0.4.0` to `~0.5.0` to
  track that package's 0.5.0 release (pattern rules, a third severity
  tier, channel scoping, and path exclusions for the scanning surface —
  see `copy`'s own CHANGELOG). Required for the same reason as the prior
  `copy`/`ui` widenings in this file: in 0.x semver a tilde range is
  minor-locked, so `~0.4.0` would exclude `copy` 0.5.0 and the dependency
  would stop resolving to the sibling package.

## [0.1.4] - 2026-08-13

### Changed

- Widened the `@vespeneventures/ui` range from `~0.7.0` to `~0.8.0` to track
  that package's 0.8.0 release, which adds the `theme` subpath. Required
  for the same reason as the `copy` widening in 0.1.3: in 0.x semver a
  tilde range is minor-locked, so `~0.7.0` excluded `ui` 0.8.0 and the
  dependency stopped resolving to the sibling package.
- Restored this package's `package.json` to the compact formatting every
  other package here uses. The 0.1.3 edit was made with a JSON
  pretty-printer, which expanded every single-line object and array —
  no semantic change, but it left this one manifest formatted unlike its
  siblings.

## [0.1.3] - 2026-08-13

### Changed

- Widened the `@vespeneventures/copy` range from `~0.3.0` to `~0.4.0` to
  track that package's 0.4.0 release. This is required, not cosmetic: in
  0.x semver a tilde range is minor-locked, so once `copy` reached 0.4.0
  the previous `~0.3.0` range excluded it and the dependency stopped
  resolving to the sibling package at all. No API change here — `copy`
  0.4.0 is purely additive to what this package uses.

## [0.1.2] - 2026-08-13

### Changed

- Documented the version coupling between this package and its two runtime
  dependencies: `@vespeneventures/copy` (`~0.3.0`) and
  `@vespeneventures/ui` (`~0.7.0`) are patch-only tilde ranges, not exact
  pins. This is a real constraint on the dependency graph, not an
  install-ordering concern — a package manager resolves the whole graph
  regardless of what order packages are requested in. A consumer whose own
  policy is to pin exact versions must pin `copy` to a matching `0.3.x`
  patch and `ui` to a matching `0.7.x` patch, or `surface`'s declared
  ranges and the consumer's exact pin cannot both be satisfied and the
  install fails with an unresolvable version conflict. Previously
  undocumented.

## [0.1.1] - 2026-08-13

### Fixed

- Removed the stale "Release status" caveat claiming this package "has not
  completed a public registry release." This package is already marked
  published in this repository's own lifecycle catalog — the caveat, not
  the package, was outdated. Surfaced by a consumer integration (#147).

### Changed

- Documented that a `SurfaceDocument` is exactly one canvas by design:
  `LayoutSpec`'s slots are fractional positions on a single fixed canvas,
  with no flow, no auto-height, and no array of canvases on the contract.
  A multi-page artifact is a consumer-side concern — compose an ordered
  sequence of `SurfaceDocument`s, one per page, and assemble the rendered
  results outside this package. Previously discoverable only by trial.
  Surfaced by a consumer integration (#151).

## [0.1.0] - 2026-08-12

- Consolidated the former composition, rendering, and asset-registry packages
  into `@vespeneventures/surface`.
- Added explicit `core`, `media`, and channel renderer subpaths.
- Added the canonical CopyRef-based `SurfaceDocument` contract.
- Added flowed web/email slot contracts and output manifests with optional
  structural strategy provenance.
- A `migrateComposeDocument` compatibility helper and its
  `LegacyCopyRefFactory` callback were written and then removed before this
  first release, so neither ever shipped. Consumers author `SurfaceDocument`
  directly; there is no legacy `ComposeDocument` migration path to adopt.
