# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-06

### Added

- Workspace catalog construction that records discovered package manifests and
  non-fatal discovery skips from the real filesystem.
- Deterministic evaluation of internal dependency resolution, dependency
  cycles, and catalog completeness from the collected manifests.
- Pure helpers for package lookup, internal dependency discovery, and
  dependency-closure calculation.
