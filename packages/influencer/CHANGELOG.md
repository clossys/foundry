# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.8] - 2026-09-22

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.1.7
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version (docs/PUBLISHING.md, "Once a version's record is retained, any
  change to that package needs a new version").

## [0.1.7] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.1.6] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `qualified response yield per thousand`, computed by
  `assessQualifiedResponseYieldPerThousand()`. An empty eligible-exposure
  set is indeterminate, never a perfect yield. `checkResponseYield`
  remains the kebab-metric gate; it is not this assessment.
- Declared `foundry.assessment` against a new mapped `influencer-rate-check`
  bin with `invocation: "single-json-input"`. `influencer-check` remains
  the two-argument CLI and is not the assessment surface. Advisor remains
  the only required first-day role.
- `influencer-rate-check assessment.json`: prints the `qualified response
  yield per thousand` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.6` is
  deferred under #833.

## [0.1.5] - 2026-09-16

### Fixed

- `influencer-check` was completely inert as installed from the public
  registry. Its bin-entry guard compared `import.meta.url` to
  `` `file://${process.argv[1]}` ``: `import.meta.url` always resolves
  symlinks while `process.argv[1]` under an installed `node_modules/.bin`
  entry is the symlink itself, so the two were never equal and `run()`
  never fired. Every invocation — `--help`, valid input, and invalid
  input alike — silently exited `0` with zero bytes of output, including
  the cases the documented exit-code contract says must be `1` or `2`. A
  consumer wiring `influencer-check` into CI had a gate that could not
  fail. `0.1.4` published to the public registry with this defect. The
  guard now resolves both sides with `realpathSync` before comparing,
  matching the fix already applied elsewhere in this repository's other
  CLIs. Refs #909.

## [0.1.4] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `influencer-check` would not have been installed
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

- Corrected README publication wording; the package is available from the
  public registry.

## [0.1.0] - 2026-08-23

### Added

- Initial provider-neutral Influencer role with complete consumer bindings,
  intent-bound authority, a paid-spend ceiling fixed at zero, atomic action
  claiming, injected configure/publish/reply actuation, and durable outcomes.
- `influencer-check response-yield`, computing independently verified qualified
  audience responses per thousand eligible exposures and returning an explicit
  indeterminate result when evidence cannot support the metric.
