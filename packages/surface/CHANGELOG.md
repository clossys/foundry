# Changelog

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
