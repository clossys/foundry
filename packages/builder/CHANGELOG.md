# Changelog

All notable changes to `@vespeneventures/builder` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.4.0`
  to `~0.5.0` to cover controller's new repository-profile runner
  (`runRepositoryProfileCheck` / `repository-profile-check`, #321). This
  package does not use `@vespeneventures/controller/repository`, so nothing
  here changes behaviorally.

## [0.2.3] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.3.0`
  to `~0.4.0` to cover controller's settled canonical declaration location
  and requirement-id grammar (#315, #316). This package does not use
  `@vespeneventures/controller/repository`, so nothing here changes
  behaviorally.

## [0.2.2] - Unreleased

### Documentation

- The `liveStateSurface` finding-kind section now matches
  `@vespeneventures/controller`'s corrected description (#313): the five
  kinds are a *finding* vocabulary, not a *verdict* vocabulary, so
  `declared-but-not-verifiable` can appear inside a `drifted` report's
  `findings` list (scoped to one dimension of the comparison that could not
  be evaluated, such as an unparseable `declaredAt`/`liveObservedAt`) as
  well as, separately, being the reason an entire attempt reports
  `could-not-verify` at the outcome level. No behavioural change in this
  package — it re-exports controller's copy verbatim.

## [0.2.1] - Unreleased

### Changed

- **`live-state.ts` now re-exports `@vespeneventures/controller/conventions`'s
  `liveStateSurface` contract instead of defining its own copy (#255).**
  `LIVE_STATE_SURFACE_FINDING_KINDS`, `LiveStateSurfaceDeclaration`,
  `validateLiveStateSurfaceDeclaration`, `reconcileLiveState`,
  `liveStateVerified`/`liveStateDrifted`/`liveStateCouldNotVerify`, and every
  associated type keep their existing names and behaviour — this package
  already depended on `controller` for the `GateResult` ternary the contract
  is built on, so re-exporting removes a real duplicate at no new dependency
  cost. No consumer-visible API change.
- Widened the `@vespeneventures/controller` dependency range from `~0.2.0`
  to `~0.3.0` to track controller's own minor bump (the new canonical
  `liveStateSurface` export above).

## [0.2.0] - Unreleased

### Added

- Multi-source plan composition (#240, first increment):
  `NamedSourcePlan`, `composeInstallationPlans`, `applyComposedInstallation`,
  `verifyComposedInstallation`, `ComposedPlan`, `ComposedPlanOperation`,
  `ComposedFinding`, `DestinationCollision`, and `DestinationCollisionError`.
  A caller with several independently-owned sources — several account-owned
  workspace checkouts, each with its own manifest and `sourceRoot` — builds
  one `Plan` per source with the existing, unchanged `planInstallation`, tags
  each with the identifier it asked to be known by, and composes them into
  one explicit, provenance-tagged plan. Composing fails closed, before any
  filesystem mutation, when two sources claim the same destination, naming
  every contributing source — never a last-writer-wins merge. This is
  additive only: `loadManifest`, `createRuntimeContext`, `planInstallation`,
  `applyInstallation`, and `verifyInstallation` are unchanged, and every
  existing single-source caller keeps working without touching this module.
  See the README's "Multi-source composition" section for the full shape,
  and that section's own note on what #240 describes that this increment
  does not yet cover (a durable applied receipt, retirement planning, and
  account discovery, which remains explicitly out of this package's scope).

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.1.0`
  to `~0.2.0` to track controller's own minor bump (its skill-registry
  `scope` enum is now closed to `account`/`repo`/`third-party`; see
  `@vespeneventures/controller`'s own changelog). No API change here.

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
