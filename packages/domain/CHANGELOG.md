# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.2.1] - 2026-08-13

### Fixed

- `homepage` pointed at `packages/domain-model`, the pre-rename directory
  that no longer exists. The published `0.2.0` manifest therefore linked a
  reader to a 404 from the registry's own package page. It now points at
  `packages/domain`.
- The README's "Migration" section still described
  `@vespeneventures/domain-model` as a live temporary compatibility package.
  It was retired from the registry once supported consumers had migrated, so
  the section now says that outright rather than pointing a new consumer at
  something they cannot install.

## [0.2.0] - 2026-08-11

### Added

- Canonical package name `@vespeneventures/domain`, replacing the original
  `@vespeneventures/domain-model` name. The public API is unchanged.
- Product-neutral domain snapshots: records, directed relations, detached
  authoring, deterministic normalization and serialization.
- Snapshot validation against declared types, fields, value types,
  vocabularies, relation endpoints, and declared cardinalities.

## [0.1.0] - 2026-08-10

### Added

- Initial dependency-free domain-model definitions, validation, normalization,
  serialization, and compatibility comparison.
