# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] - 2026-09-21

### Added

- `strategist-check --extensions <ext>` (repeatable): limits the facts gate
  scan to the given file extensions (include the leading dot). When none are
  given, the previous default set applies.
- `strategist-check --skip-dirs <name>` (repeatable): adds directory names
  to the built-in skip list during the walk; it does not replace the
  defaults (`node_modules`, `.git`, `dist`, `build`, `coverage`).

### Fixed

- `facts-gate:ignore` applies only on the line where the marker appears; a
  marker on one line never suppresses claims on following lines.
- `facts-gate:ignore` markers no longer match the prefix
  `facts-gate:ignoreme` — the ignore token must end at a word boundary.

## [0.2.0] - 2026-09-19

### Added

- `readStrategyDirectory`, a pure reader that combines a directory of
  per-fact JSON leaves into one validated `Fact[]`. It accepts the
  directory's contents as a map of relative path -> raw file text (no
  filesystem access of its own — `readStrategy` remains this package's
  one deliberate I/O surface, and a CLI or programmatic caller feeds the
  map), validates every leaf with the same `validateFacts` rules the flat
  file follows, and refuses — naming the offending file — any leaf that
  is unparseable, schema-invalid, or not a `*.json` file at all, plus a
  directory holding no JSON leaf. Facts from leaves that did validate are
  still returned; judgement about an incomplete set belongs to the
  caller, the same discipline `readStrategy`'s `issues`/`complete` pair
  holds to.
- Each fact read from a directory records its provenance in the new
  optional `Fact.sourceFile` (the leaf's path as supplied). `readStrategy`
  leaves the field unset; validators neither require nor reject it.
- `strategist-check --facts-dir <dir>`: reads facts from a directory of
  per-fact JSON files instead of the flat `facts.json`, via the same
  fail-closed contract — any leaf refusal is exit code 2, never a clean
  pass. `--facts-dir` and the flat `facts.json` are mutually exclusive:
  supplying both is refused (exit 2), naming the conflict.

### Notes

- This does not claim the position is closed. No publication or
  qualification is recorded by this change.

## [0.1.6] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `strategy traceability rate`, computed by
  `assessStrategyTraceabilityRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `checkFactsTraceability`
  remains the facts gate; it is not this combined rate.
- Declared `foundry.assessment` against a new mapped `strategist-rate-check`
  bin with `invocation: "single-json-input"`. `strategist-check` remains the
  multi-mode CLI and is not the assessment surface. Advisor remains the
  only required first-day role.
- `strategist-rate-check assessment.json`: prints the `strategy
  traceability rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.6` is
  deferred under #833.

## [0.1.5] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.1.4 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.1.4` path, so this package moves to `0.1.5`
  purely to regain one. No functional or behavioral change.


## [0.1.4] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.1.3] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `strategist-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.2] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.1] - 2026-08-24

### Fixed

- Updated README references to active Designer, Writer, and Controller
  subpaths after the predecessor packages retired.

## [0.1.0] - 2026-08-20

First release. This package is the strategist role, recut from
the previous scope's `strategy` package per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing — to a
reader who arrives at this package first.

### Added

- Dependency-free validators for a consumer's own strategy records: facts,
  mission, positioning, markets, audiences, roadmap, and brand
  essence/attributes/derivations.
- `readStrategy`, a typed reader over a consumer's strategy directory.
- Three gates, all reachable from the single `strategist-check` bin: the
  facts-traceability gate (default invocation), `brand-coverage`, and
  `direction`. Each dispatches on `argv[0]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run the
  wrong command wherever a gate is invoked by compiled path.
- Zero runtime dependencies, unchanged from the donor.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it to
  find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from the previous scope's `strategy`

- **The package is named for the job, not the artifact.** The role's exclusive
  question is *is it true, and is it us?* A name that describes a thing rather
  than a doer is an artifact, and an artifact belongs inside a role.
- **The bin is `strategist-check`, not `strategist-facts-check`.** The donor's
  bin name predates the CLI growing `brand-coverage` and `direction`
  subcommands, so it named one of three jobs while advertising itself as the
  package's entry point.
- **Nothing else was renamed.** `readStrategy`, `StrategyBundle` and the
  `strategy-dir` argument keep their names. Renaming the role does not rename
  what the role reasons about, and a sweep that also renamed the vocabulary
  would have made the diff unreviewable while changing no behaviour.

### Not included

> **Current lifecycle note:** the previous scope's `strategy` is now retired.
> This release note records its state at 0.1.0; the lifecycle contract is the
> authority for current availability.

- **No forwarding stub in the donor.** The previous scope's `strategy` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
