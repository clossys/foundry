# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-08-30

### Added

- Added a value-free credential lifecycle contract that distinguishes
  provider-created ephemeral job credentials from manually rotatable secrets.
  Ephemeral evidence validates provider, scope, job lifetime, scoped use, and
  expiry-at-job-end semantics without inventing a rotation timestamp. Manual
  evidence keeps repository-secret metadata separate from owner-controlled
  token provenance, so `updatedAt` alone remains indeterminate. Results retain
  the closed `satisfied` / `violated` / `indeterminate` and `0` / `1` / `2`
  behavior, and unknown credential-shaped fields are rejected without echoing
  them. This is a contract addition only; no consumer adoption is claimed.

## [0.1.4] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.3] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.1.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.1.1] - Unreleased

### Documentation

- **README states a consuming plane's credential-inventory loop-close
  condition (issue #285's acceptance criterion), and links issue #326 for
  the fuller lifecycle scope this slice does not yet claim.** Closes when
  the declared inventory accounts for every live credential and none reads
  `unverifiable` without an explicit opt-out; reopens on any credential
  observed in use but never declared. No code change.

## [0.1.0] - Unreleased

Renamed from `@vespeneventures/secrets`, which never published a release.
Resolution was one verb of five; this package now owns the other four —
custody, rotation, revocation, and distribution — end to end, alongside the
resolution contracts unchanged.

### Added

- Key custody: a value-free manifest of who owns each declared key and where
  it lives (`defineKeyCustody`, `custodyOf`, `unownedKeys`).
- Key rotation: an explicit four-state result — `current` / `stale` /
  `unowned` / `unverifiable` — so a rotation the system cannot observe is
  never reported as fine (`evaluateRotation`, `rotationQueue`,
  `summarizeRotationMetric`, `sameDigest`).
- Key revocation: a pointer to upstream revocation authority and a
  value-free record of a revocation, with no code path that performs a
  revocation itself (`defineRevocationPath`, `recordRevocation`,
  `isRevoked`, `latestRevocation`).
- A distribution manifest declaring which principal may resolve which name
  (`defineDistributionManifest`, `mayResolve`, `principalsFor`, `keysFor`).
- Initial provider-neutral client and adapter contracts.
- Late-bound environment and mutable in-memory test adapters.
- Async and synchronous resolution with safe, value-free errors.
- Value-free secret catalog types and a frozen catalog authoring helper.
- Infisical v4 API integration at the `./infisical` subpath with injected
  configuration, access-token and OIDC authentication, value-free readiness,
  child-process injection, and a provider-specific CLI that never prints
  secret values.
- Separately constructed, policy-gated Infisical replacement with optional
  verification and no unsafe automatic rollback.
