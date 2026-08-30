# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and CLI source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.3] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and CLI source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.2] - 2026-08-27

### Fixed

- Validate GitHub snapshot and trusted-event base/head fields as canonical
  40-character Git commit SHA-1 OIDs, while retaining 64-character SHA-256
  validation only for snapshot and evidence-file digests.

## [0.1.1] - 2026-08-27

### Fixed

- Force-kill a timed-out Advisor or target child process so a child that ignores
  `SIGTERM` cannot exceed Starter's bounded decision deadline.

## [0.1.0] - 2026-08-27

### Added

- Foundry Starter's dependency-free, typed decision core with exact
  `0`/`1`/`2` result preservation.
- Fixed npm and pnpm adapters that disable lifecycle scripts and verify exact
  manifest, lockfile, version, and integrity identity.
- Protected-base snapshot/event joins, contained-evidence checks, direct
  installed manifest/bin resolution, Advisor runner-time readiness, and
  target output/exit consistency checks.
- A canonical consumer-owned two-phase GitHub Actions workflow document.
