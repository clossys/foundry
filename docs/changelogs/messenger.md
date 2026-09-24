# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## 0.1.12 - 2026-09-24

- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).

## [0.1.11] - 2026-09-22

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.1.10
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version.

## [0.1.10] - 2026-09-21

### Fixed

- Install section names `https://registry.npmjs.org` and states that
  installing requires no authentication, with no GitHub-token wording that
  could be read as a prerequisite. (#924)

## [0.1.9] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.1.8] - 2026-09-18

### Added

- Stated the charter close condition against the exact metric name
  `timely verified delivery rate`, computed by
  `assessTimelyVerifiedDeliveryRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `checkDeliveryClosure` still
  reports kebab `timely-verified-delivery-rate` against a setpoint; that
  function is not this assessment.
- Declared `foundry.assessment` against a new mapped `messenger-rate-check`
  bin with `invocation: "single-json-input"`. `messenger-check
  delivery-closure` stays the setpoint gate and is not the assessment
  surface. Advisor remains the only required first-day role.
- `messenger-rate-check assessment.json`: prints the `timely verified
  delivery rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.8` is
  deferred under #833.

## [0.1.7] - 2026-09-16

### Fixed

- The Install section stated this package is published to GitHub Packages
  and instructed consumers to map the `@clossys` scope and supply a
  `read:packages` token. Neither step is real: `@clossys/messenger`
  publishes to `https://registry.npmjs.org` with public access and
  installs anonymously, with no scope mapping or token of any kind.
  (#924)

## [0.1.6] - 2026-09-16

### Fixed

- `messenger-check` was completely inert as installed from the public
  registry. Its bin-entry guard compared `import.meta.url` to
  `` `file://${process.argv[1]}` ``: `import.meta.url` always resolves
  symlinks while `process.argv[1]` under an installed `node_modules/.bin`
  entry is the symlink itself, so the two were never equal and `run()`
  never fired. Every invocation — `--help`, valid input, and invalid
  input alike — silently exited `0` with zero bytes of output, including
  the cases the documented exit-code contract says must be `1` or `2`.
  `0.1.5` published to the public registry with this defect. The guard
  now resolves both sides with `realpathSync` before comparing, matching
  the fix already applied elsewhere in this repository's other CLIs.
  Refs #909.

## [0.1.5] - 2026-09-15

### Added

- A named, actionable optional-peer guard for `resend` on
  `@clossys/messenger/providers/resend`. That subpath is the package's one
  import site for `resend`, and an absent or out-of-range install used to
  surface only as whatever the Resend SDK itself happened to throw deep
  inside its own call surface. It now reports the peer, the version
  actually found, and the range this package declares. A version string
  the guard cannot parse is reported as indeterminate — a single warning,
  never a thrown error — so an unreadable version never crashes a build.
  The provider-neutral root export is unchanged and still needs no
  `resend` install at all.


## [0.1.4] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `messenger-check` would not have been installed
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

- Corrected README publication and installation wording for the public
  registry package.

## [0.1.0] - 2026-08-23

### Added

- Initial provider-neutral Messenger role with mandatory authorization policy,
  durable claim/completion ledger, finished email validation, and normalized
  delivery outcomes.
- `messenger-check delivery-closure`, measuring timely verified delivery from
  independent evidence and returning indeterminate when no delivery intent is
  due.
- Optional `./providers/resend` adapter for outbound email and signed delivery
  webhook normalization. Person-request admission intentionally remains outside
  this role.
