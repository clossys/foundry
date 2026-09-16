# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.7] - 2026-09-16

### Fixed

- **The published `architect-check` binary was completely dead.** The
  entry-point guard in `src/cli.ts` compared `import.meta.url` (which Node
  always resolves through symlinks) against `process.argv[1]` (which, for
  an installed CLI, is the `node_modules/.bin` symlink itself, never the
  real file). The two paths were never equal, so `run()` never fired.
  Every documented invocation of the published package — `--help`,
  `architect-check topology <file>` against both valid and invalid input,
  even an unrecognized subcommand — returned exit `0` with zero bytes of
  output, including invalid input the documented contract says must exit
  `1` with a `"state":"violated"` report. A consumer who wired
  `architect-check` into CI got a gate that could not fail on any input.
  Fixed by resolving both sides with `realpathSync` before comparing, the
  same pattern already used elsewhere in this repository (for example
  `designer/src/cli.ts` and `writer/src/cli.ts`). See #909.
- Added a test that spawns the compiled `dist/cli.js` through a real
  `node_modules/.bin`-shaped symlink built in a temp directory, the only
  shape that actually exercises the entry-point guard — the existing
  `cli.test.ts` suite calls the exported `main(argv)` directly and never
  touched `process.argv[1]`, which is exactly why this defect shipped
  undetected.

## [0.1.6] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.1.5 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.1.5` path, so this package moves to `0.1.6`
  purely to regain one. No functional or behavioral change.


## [0.1.5] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


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
- Ontology model and snapshot API under `@clossys/architect/ontology`.
