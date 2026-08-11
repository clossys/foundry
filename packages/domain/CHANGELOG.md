# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
