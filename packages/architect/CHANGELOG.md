# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `architect-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.3] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.2] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.1] - 2026-08-24

### Fixed

- Corrected the install guidance now that Architect is a public package.

## [0.1.0] - 2026-08-23

### Added

- Initial architect role contract for provider-neutral scopes, systems,
  responsibilities, authorities, systems of record, and interfaces.
- Deterministic topology validation, normalization, serialization, and
  compatibility comparison.
- Evidence-based architecture exception assessment with explicit indeterminate
  results when no material changes have been observed.
- `architect-check` topology and exception-assessment commands.
- Ontology model and snapshot API under `@vespeneventures/architect/ontology`.
