# Changelog

All notable changes to `@vespeneventures/builder` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-18

### Added

- `packages/builder`, absorbing `@vespeneventures/provisioning` at its root
  entrypoint and `@vespeneventures/deployment` as the `./deployment`
  (`./deployment/vercel`, `./deployment/render`) subpath, preserving both
  packages' own export shapes.
- `liveStateSurface`: `LiveStateSurfaceDeclaration`,
  `validateLiveStateSurfaceDeclaration`, `LIVE_STATE_SURFACE_FINDING_KINDS`
  (all five finding kinds, including `declared-but-not-verifiable`), and
  `reconcileLiveState` with its three constructors
  (`liveStateVerified` / `liveStateDrifted` / `liveStateCouldNotVerify`),
  built on `@vespeneventures/controller/gates`'s `GateResult` ternary.
- `toolchain`: `RuntimePin`, `PackageManagerPin`, `BuildOrderPin`,
  `ToolchainDeclaration`, their validators, and `reconcileToolchain` for
  checking a declared toolchain against one observation of a real machine.
- `./ci`: shared CI gate mechanics for #257 — `foldLiveStateReports`,
  `checkVersionFloor` (a minimum-safe-version staleness signal, the same
  mechanism `@vespeneventures/verify-standards` already ships), and
  `builder-verify-toolchain`, an installed CLI a consuming repository's own
  thin workflow invokes, with the same `0`/`1`/`2` exit-code contract every
  other gate CLI in this repository publishes. See
  `documents/caller-workflow.md` for the workflow shape.

[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/builder-v0.1.0
