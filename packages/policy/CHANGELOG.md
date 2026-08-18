# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **This package is now a deprecated compatibility stub.** Its source moved
  to `@vespeneventures/controller/policy` (issue #282); `src/index.ts` is
  now a single `export * from "@vespeneventures/controller/policy"`. No
  export was removed and no call shape changed — only the package that owns
  the source did. See
  [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller).
  Issue #288 removes this package once the migration window closes.

## [0.1.0] - Unreleased

### Added

- Initial release of the content-addressed `PolicyBinding` primitive:
  `computeDigest` creates a digest from string or byte input;
  `validateBindingShape` validates an untrusted binding without throwing; and
  `verifyBinding` compares a materialized document with its declared digest.
  The package was dependency-free and performed no I/O.
- `DIGEST_ALGORITHMS`, `DigestAlgorithm`, `Finding`, and `PolicyBinding`
  exports, including a closed initial `sha256` vocabulary and stable finding
  fields for callers that need to report invalid bindings.
- `OWN_LICENSE_BINDING`, a self-hosting example bound to this package's MIT
  licence and covered by a test so changes to the committed licence bytes
  require an intentional digest update.
