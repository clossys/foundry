# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
