# Changelog

## Unreleased

- Added the canonical CopyRef-based `SurfaceDocument` contract and migration
  helper for the deprecated `ComposeDocument` shape.
- Added flowed web/email slot contracts and output manifests with optional
  structural strategy provenance.
- Removed the unpublished `migrateComposeDocument` compatibility helper and
  its `LegacyCopyRefFactory` callback. Consumers author `SurfaceDocument`
  directly before the package's first public release.

## 0.1.0

- Consolidated the former composition, rendering, and asset-registry packages
  into `@vespeneventures/surface`.
- Added explicit `core`, `media`, and channel renderer subpaths.
