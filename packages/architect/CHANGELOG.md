# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.10] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).


## [0.1.9] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `architecture exception rate`, computed by
  `assessArchitectureExceptions()`. No observed material changes is
  indeterminate, never a zero rate. This package does not measure consumer
  evidence and does not close the loop.
- Declared `foundry.assessment` against the mapped `architect-check` bin with
  `invocation: "single-json-input"`, so first-day onboarding discovers this
  role's assessment surface from the installed manifest instead of inferring
  one. Advisor remains the only required first-day role.
- `architect-check assessment.json`: one JSON object with `topology`,
  `observations`, and `maximumExceptionRate`. Prints the architecture
  exception rate report and exits on the `0` / `1` / `2` ternary. The
  existing `topology` and `exceptions` subcommands remain.

### Notes

- This does not claim the position is closed. Qualification of `0.1.9` is
  deferred under #833.

## [0.1.8] - 2026-09-16

### Note

- **0.1.7 was never published; this release supersedes it without repeating
  its work.** 0.1.7 (below) carried the same `architect-check` entry-point
  fix as this release, and its qualification record
  (`governance/release-qualifications/clossys-architect-0.1.7.json`) was
  generated and retained, binding candidate `packageTreeSha1
  45714600108521d00ca95f9d43a72092acbf8d42`. Before publication, #919
  corrected the new `bin-entry.test.ts` added by #909/0.1.7 so it chmods a
  temporary copy of `dist/cli.js` instead of the real packed file — a fix
  needed because CI packs immediately after running the package's tests, so
  the original test left CI publishing a tarball in the wrong file mode.
  That correction touched a file inside `packages/architect/`, which moved
  the package tree to `9233ea5efff49257bcebc7e6e5882753591f5aee` and left the
  retained 0.1.7 record qualified against a package tree that no longer
  exists. Qualification records are immutable — each file path is
  introduced exactly once and is never corrected in place — so the 0.1.7
  record cannot be updated to match, and 0.1.7 cannot be published. This
  release reuses the already-fixed and already-corrected source unchanged
  and exists solely to obtain a fresh, never-before-used record path. See
  #909 (the original `architect-check` defect) and #919 (the test
  correction that made 0.1.7 unpublishable).

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
