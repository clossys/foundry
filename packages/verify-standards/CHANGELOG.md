# Changelog

All notable changes to `@vespeneventures/verify-standards` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

### Added

- Initial release. One repository-standards gate, published as a package so a
  fix has a path to every consumer, invoked by a thin workflow each consuming
  repository keeps for itself.
- Four checks, each a pure function of caller-collected observations:
  `checkSecretScan`, `checkTaskRecord`, `checkReviewEvidence`, and
  `checkPolicyDrift`.
- `verifyStandards`, which runs the selected checks and folds their results
  `indeterminate`-first, and the `verify-standards` executable, which reads
  one caller-named inputs document and maps the folded verdict onto the
  `0` / `1` / `2` exit contract this repository's other gate CLIs already
  publish. No flag can turn a `2` into a `0`.
- Every check reports the `satisfied` / `violated` / `indeterminate` ternary
  from `@vespeneventures/governance/gates`, with each check's possible
  indeterminate reasons declared as one enumerated vocabulary in its own
  source rather than accumulating as ad hoc strings at call sites.
- A minimum-safe-version floor (`MINIMUM_SAFE_VERSION`, `checkVersionFloor`).
  A build below the floor fails as `2` rather than warning. Because a running
  build can only compare against the floor it shipped with, the floor also
  checks a second, independent fact — the version range the caller declared
  for this package — so a current build can tell a caller that its own range
  still admits a pre-floor build.
- `documents/caller-workflow.md`, the consumer-side half: the thin workflow a
  consuming repository adds, the inputs-document shape, and why collection
  stays on the caller's side of the boundary.

### Notes on what is deliberately absent

- No collection of any kind: no scanner is downloaded or run, no tracker is
  queried, no enforcement surface is read. That is what lets this package hold
  no credential, keeps its entry point synchronous, and leaves a re-checkable
  inputs document behind after every run.
- No account values — no owner, repository, label taxonomy, required context,
  or provider list. Requirements are opaque identifiers compared for equality.
