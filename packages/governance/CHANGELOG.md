# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-11

### Fixed

- Depend on the publishable `@vespeneventures/release@^0.1.1` closure so an
  isolated consumer can install the governance package.

## [0.1.0] - 2026-08-11

### Added

- A declarative, complete package lifecycle registry with explicit
  deprecation replacements.
- Read-only workspace and package-preflight orchestration over the existing
  catalog, gates, and release packages.
- A deterministic no-write package starter plan. A complete profile is now
  caller-owned and must supply real metadata, tooling, license text, and a
  dated changelog entry; unprofiled plans are private starters, never claimed
  to be publishable.
- Compact CLI reports with JSON and verbose output modes, plus explicit
  lifecycle-file and workspace-root input errors.
- Deprecated-package evidence requirements: either a replacement package and
  semver range or a terminal no-successor reason, plus a date, decision
  reference, and migration reference.
- A shared preflight scope forwarded consistently to both release and
  governance checks.
