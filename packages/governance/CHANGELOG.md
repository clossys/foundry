# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **This package is now a deprecated compatibility stub.** Its source moved
  to `@vespeneventures/controller` (issue #282); every subpath here is a
  thin `export *` forward to the matching `@vespeneventures/controller`
  subpath, and every installed command (`foundry-governance`,
  `foundry-check`, `repository-check`, `review-check`) now runs through
  `@vespeneventures/controller`'s own implementation. No export was removed
  and no call shape changed — only the package that owns the source did.
  See [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller).
  Issue #288 removes this package once the migration window closes.

Everything before this entry documents this package's history while it was
the source of truth for this surface. See
[`@vespeneventures/controller`'s CHANGELOG](../controller/CHANGELOG.md) for
what happens to this surface from here on.
