# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## 0.2.0 - 2026-09-28

- Each package skill's section for when the package is not installed speaks of the repositories the team is set up in, instead of every inventoried repository.
- Each package skill says the whole team is composed in the hub and a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there once that plan's setup pull request has merged, so a missing `@clossys-<package>` mention is a bug only in the hub.
- foundry-starter admit exits 2 when the pull-request head ledger is absent.
- foundry-starter admit exits 1 when the head is a next generation whose last entry is labeled approved.
- foundry-starter admit exits 1 when the head ledger is another spelling of the protected base ledger.
- foundry-starter admit exits 1 when the head ledger adds a package act the base ledger did not defer.
- foundry-starter admit exits 1 when the head ledger's history breaks the base ledger's history prefix.
- foundry-starter admit exits 0 when the pull-request ledger's canonical bytes are the protected base ledger's.
- foundry-starter admit exits 1 when the head ledger keeps a deferred row on the admitted generation.
- foundry-starter admit exits 0 when the pull-request ledger is the admitted next generation of the protected base ledger.
- foundry-starter admit exits 1 when the protected base's npm ci result does not match a base ledger package's integrity.
- A v1 Starter request can select phase admission.
- foundry-starter admit exits 1 when the head ledger's new generation names a different plan digest from the base setup entry.
- foundry-starter admit exits 1 when the protected base's pnpm install --frozen-lockfile result does not match a base ledger package's integrity.
- foundry-starter admit exits 1 when the head ledger's new generation names a different subject digest from the base setup entry.
- foundry-starter admit exits 1 when a protected-base manifest spec for a ledger package is a tarball filename.
- foundry-starter admit exits 2 when the pull-request head ledger is not a readable ledger document.
- The caller-workflow document explains that `decide` proves a changed pin one merge later, and shows an optional `prove-head-install` job for the npm caller.
- Make the protected-base `advisor` request block optional. When it is omitted, `decide` verifies matching `authorization.planDigest` and ledger plan digest values instead of running `@clossys/advisor`, while the target check still runs.
- Export `evaluateHeadInstall()` and the `HeadInstall*` types from `@clossys/starter`, and `PUBLIC_NPM_REGISTRY`, `validateNpmLockfileSources()`, and `stagedNpmManifest()` from `@clossys/starter/npm`.
- After `npm ci` completes, it compares npm's own hidden lockfile, `node_modules/.package-lock.json`, against the head's `package-lock.json` entry by entry, reporting a mismatch as a violation and an unreadable hidden lockfile as indeterminate.
- `prove-head` refuses a head `package-lock.json` entry whose resolved source is not a `https://registry.npmjs.org/` tarball named for its own entry's name and version, or whose integrity is not one SHA-512 value, other than a bundled dependency recorded with neither field.
- It refuses a dependency spec ending in `.tgz`, `.tar.gz`, or `.tar` anywhere one could redirect the install: the manifest's `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`, `overrides` at any depth, and a lock entry's own dependency maps (or the root entry's `devDependencies`).
- Add `foundry-starter prove-head`, which checks a pull request head's own npm install from the protected base's installed Starter by reading the head's request, `package.json`, and `package-lock.json` as data.

## 0.1.10 - 2026-09-24

- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).

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
