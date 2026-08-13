# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-08-13

### Fixed

- The root entry (`import "@vespeneventures/governance"`) no longer
  transitively loads the TypeScript compiler. `governance.ts` and
  `release/preflight.ts` each imported `runFoundationCheck`/
  `computeBuildOrder` from the `./gates/index.js` barrel rather than from
  the specific files those functions live in — and that barrel also
  re-exports `secret-gates.ts`, whose own top-level `import ts from
  "typescript"` rode along with it regardless of which single export a
  caller actually wanted. A plain root import now stays free of the
  compiler itself; a consumer who deliberately imports the public
  `@vespeneventures/governance/gates` subpath still gets everything,
  unchanged, secret-gates included. This is specifically about
  `typescript`: the root already used `node:fs` (workspace discovery) and
  `preflightGovernedPackage` already used `node:child_process` (a real
  tarball pack-and-install check) before this change, for reasons entirely
  unrelated to the barrel-import bug fixed here — see the README's
  "Requirements" section for the precise boundary. Surfaced by a consumer
  integration (#152).

## [0.2.0] - 2026-08-12

### Added

- Explicit lifecycle maturity states for incubating, published, qualified,
  and adopted packages, while retaining legacy `active` records for schema-v1
  compatibility.
- A distinct retired state with dated durable retirement evidence and CLI
  maturity summaries.
- The `catalog`, `gates`, `release`, `repository`, and `review` subpaths,
  including the review GitHub normalizer and established process CLIs.

### Changed

- Governance now owns its package-process implementations and depends only on
  policy plus TypeScript for source-aware gates. The former standalone package
  names are compatibility packages with documented migration paths.

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
