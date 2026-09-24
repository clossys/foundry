# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.9] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.1.8] - 2026-09-19

### Added

- Optional `hub` request evidence — `{ owner, repository, inventoried }` —
  naming the account hub and stating, on caller-supplied evidence, whether
  the subject repository is hub-inventoried (#997). Starter performs no I/O
  to obtain or verify it; an absent `hub` changes nothing.
- When `hub.inventoried` is `false`, the decision report gains one
  non-blocking finding, `not-hub-inventoried`, present in every result so
  the hub's own reconciliation can see the gap. The verdict is never
  downgraded: flagging is the hub's work, not an activation violation.
- `StarterHubEvidence`, exported from the root entrypoint, and a README
  section documenting the new optional input.

## [0.1.7] - 2026-09-18

### Fixed

- Documented installation against this source version (`0.1.7`) and the public
  npm registry. The README previously told a consumer to pin `0.1.4`, two
  patches behind the shipped manifest, so a copied install command could not
  be the exact identity Starter itself requires in `StarterRequest.starter`.

### Added

- Stated the close condition in the README: Starter is not a role, so
  adoption, grounding, and closure stay N/A. The trusted-base job is done
  when the consumer's own two-phase workflow retains `foundry-starter
  decide`'s native ternary (`foundation` stays `2`; `activation` is `0` only
  on complete joins). This does not claim the job is done.

## [0.1.6] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `foundry-starter` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.5] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

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
