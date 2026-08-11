# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release of the content-addressed `PolicyBinding` primitive:
  `computeDigest` creates a digest from string or byte input;
  `validateBindingShape` validates an untrusted binding without throwing; and
  `verifyBinding` compares a materialized document with its declared digest.
  The package is dependency-free and performs no I/O.
- `DIGEST_ALGORITHMS`, `DigestAlgorithm`, `Finding`, and `PolicyBinding`
  exports, including a closed initial `sha256` vocabulary and stable finding
  fields for callers that need to report invalid bindings.
- `OWN_LICENSE_BINDING`, a self-hosting example bound to this package's MIT
  licence and covered by a test so changes to the committed licence bytes
  require an intentional digest update.
