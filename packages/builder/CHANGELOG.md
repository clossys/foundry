# Changelog

All notable changes to `@vespeneventures/builder` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-08-24

### Fixed

- Updated current CI-gate guidance from retired Verify Standards to active
  Inspector.

## [0.7.0] - 2026-08-21

### Added

- **Class 1 (package-owned, account-neutral conventions content) now
  composes through `./machine`, closing the retirement gap tracked by
  #410.** #393 named three classes of source the machine installer had
  to compose; the prior release shipped classes 2 (per-account skill
  trees) and 3 (third-party-scoped skills) only. `./machine/machine-layer.js`
  adds the class-1 declaration contract: a machine-local file, owned by
  no repository and versioned nowhere, mapping a
  `@vespeneventures/controller/conventions` catalog id onto a
  destination expressed relative to `home` (never absolute) and an
  install kind (`link`, `copy`, or `managed-block`). Read from a
  caller-supplied path or `BUILDER_MACHINE_LAYER_DECLARATION_PATH`.
  `validateMachineLayerDeclarationShape` / `parseMachineLayerDeclaration`
  / `writeMachineLayerDeclaration` follow `packages/observer`'s
  `coverage-declaration.ts` for the validate/parse/never-throw shape;
  `buildClassOneManifest` (catalog-aware, throws internally) /
  `loadClassOnePolicy` (the public entry point, never throws) follow
  `packages/integrator`'s `detectSupersession` split. `verifyMachine`
  composes class 1 through the exact same `composeInstallationPlans`
  classes 2 and 3 already use — no second composition path — tagged
  `"package-conventions"`, and optional the same shape `thirdPartySkillsRoot`
  already is: an unconfigured class-1 source is absent, not a failure,
  so every existing caller's behavior is unchanged.
- **The single-directory-symlink to per-skill-links migration hazard
  (#240) is now detected and reported, never crashed on.** On the
  machine this replaces, `composedSkillsRoot` is today a single
  directory symlink into the repository being retired; this subpath's
  own shape is per-skill links at the identical path. #240's own
  reproduction recorded that transition crashing `applyInstallation` on
  a stale dangling link via an opaque, unrelated `ENOENT` deep inside
  `apply.ts`'s `replace()`. `./machine/skills-manifest.js`'s
  `buildSkillsManifest` now declares `composedSkillsRoot` itself as a
  `privateDirectories` entry (`create: true`) ahead of every per-skill
  link — no new engine mechanism, reusing `apply.ts`'s
  `applyPrivateDirectory` / `verify.ts`'s `verifyPrivateDirectory`,
  which already refuse a symlinked destination (dangling or not) with a
  named, actionable error before anything is touched, and which
  `composeInstallationPlans` already exempts from collision detection
  across sources. `skills-manifest.test.ts` reproduces the exact
  transition #240 recorded.
- **Explicit retirement of a dropped destination (#240).**
  `diffRetiredDestinations` (also exported from the package root) is a
  pure comparison: given the destinations a prior composed run managed
  and the current run's actual composed operations, it names every
  destination the prior run owned that no current source claims at
  all. Reporting only — this never removes anything, and no destructive
  option is offered. `verifyMachine` wires this in as an entirely
  optional row via `MachineVerifyInputs.previousCompositionPath`
  (a caller-persisted JSON document, no environment-variable fallback);
  a `machine/destination-retired` finding per retired destination when
  something was dropped, `indeterminate` rather than a comparison
  against a partial machine when composition itself did not resolve.

## [0.6.1] - 2026-08-21

### Added

- **`aggregate-observations`, `check-observation-freshness`, and
  `deployment-health` subcommands on the existing `builder-verify-toolchain`
  bin (#377).** `aggregateObservations`, `checkObservationAggregateFreshness`
  (`./observation-aggregate.ts`), and `evaluateDeploymentHealth`
  (`./deployment/health.ts`) were public API with no CLI path anywhere in
  this package — gate-shaped exports only a caller writing TypeScript could
  run. Dispatch is keyed on the literal `argv[0]` token, checked before the
  pre-existing no-subcommand toolchain-check parsing, never on
  `basename(process.argv[1])` — this repository invokes every gate by its
  compiled path (`node packages/builder/dist/ci/bin.js`), so a
  filename-keyed dispatch could never tell the four commands apart. No new
  `bin` entry and no new runtime dependency. `aggregate-observations` and
  `check-observation-freshness` apply the fleet 0/1/2 ternary via
  `@vespeneventures/controller/gates`'s own `gateResultToExitCode`;
  `deployment-health` applies the identical mapping to
  `DeploymentHealthStatus` (healthy → 0, degraded/unhealthy → 1, unknown →
  2). See `src/ci/cli.test.ts`'s direct-path reachability suite, which
  spawns the real compiled `dist/ci/bin.js` and asserts real exit codes for
  all four commands, including the pre-existing no-subcommand path
  unchanged.

## [0.6.0] - 2026-08-21

### Changed

- **BREAKING: `createVercelInspector().inspect` and `createRenderInspector().inspect`
  no longer throw on a malformed or unreachable provider response (#392).**
  A `network` transport failure and an `invalid-response` body that does not
  parse into the shape the provider's own contract promises are not a
  deployment that failed — they are a state the inspector could not form an
  opinion about. Both now resolve to a discriminated
  `VercelInspectionResult` / `RenderInspectionResult`: the existing success
  shape gains a `kind: "inspected"` tag, and a new `kind: "indeterminate"`
  variant carries a machine-readable `reason` (`"network"` |
  `"invalid-response"`) and a static `detail` string, mirroring the fold
  `@vespeneventures/integrator`'s `resolveReachability` already applies to
  the identical ambiguity. `unauthorized`, `rate-limited`, and an
  unrecognized `http` status still throw — the provider responded
  coherently there, which is a real finding, not an unreadable one — and so
  do `invalid-input`, `invalid-base-url`, `credential-unavailable`, and
  `aborted`, none of which are about what a provider said. A caller
  destructuring the old bare success shape, or narrowing on `.reject`s for a
  `network` or `invalid-response` kind, must update for the new
  discriminant.

## [0.5.1] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.5.0] - Unreleased

### Added

- **Machine composition (#393), a new `./machine` subpath.** Composes one
  machine's skill tree from several self-declared account-owned workspace
  checkouts plus a third-party-scoped skill source, replacing the mechanism
  a retiring account-owned installer repository used to provide.
  `discoverAccountWorkspaces` finds workspaces by their own declared
  policy — never a hard-coded list, never a guessed default — and reports a
  candidate that cannot be read as `indeterminate`, always present in the
  result, never silently dropped. `loadThirdPartySkills` is the
  third-party-scoped mirror of the same ternary, keyed off
  `@vespeneventures/controller/conventions`'s own `SkillScope` vocabulary.
  `buildSkillsManifest` turns a discovered skill tree into per-skill
  `links` entries into one composed directory — the shape that makes the
  existing `composeInstallationPlans` per-destination collision check work
  unmodified, so two sources shipping a same-named skill surface as a
  `DestinationCollisionError` for free. `verifyMachine` orchestrates all of
  it into one `GateResult`-based report, shipped as an installed CLI,
  `builder-verify-machine` (`./machine/cli.ts` + `./machine/bin.ts`, a
  separate compiled entry file from `builder-verify-toolchain`), on the
  same 0/1/2 exit-code ternary as every other gate in this package. See the
  README's "Machine composition" section for the two decisions this
  subpath implements and the reasoning behind each.

## [0.4.1] - Unreleased

### Changed

- **Widened the declared `@vespeneventures/controller` dependency range to
  `~0.8.0`** so it covers controller's issue #391 release (required-check
  recency grading). This package does not use `@vespeneventures/controller/review`
  and needed no code change; the range only needed widening to keep
  resolving controller as a local workspace link instead of falling back to
  a stale published copy — see `check:workspace-links`.

## [0.4.0] - Unreleased

### Added

- **An aggregate can now vouch for its own freshness, or say it can't
  (#340).** `stale-observation` already caught one contributing bundle
  being too old; nothing previously let the AGGREGATE'S OWN computed
  result be checked for its own age once persisted and read later by a
  different process — the failure a schedule-less, push-triggered
  aggregation actually hits when a contributing repository's publisher is
  fixed and nothing re-evaluates the aggregate to notice.
  `AggregateObservationsResult` now carries `computedAt` (echoing `now`)
  and `maxResultAgeMs` (echoing the new required `input.maxResultAgeMs`).
  The new `checkObservationAggregateFreshness(input)` takes a stored
  result's `computedAt`/`maxResultAgeMs` plus a fresh `now` supplied at
  read time, and reports `indeterminate` with the new, distinct reason
  `stale-aggregate-result` (`OBSERVATION_AGGREGATE_RESULT_INDETERMINATE_REASONS`)
  the moment it can no longer vouch for that result's age — never a
  restated `stale-observation`, which answers a different question. **Breaking:**
  `AggregateObservationsInput` gains a new required field,
  `maxResultAgeMs`, matching `staleAfterMs`'s existing "explicit, never
  defaulted" discipline. Under this repo's pre-1.0 semver policy a
  breaking change to a 0.x package is a MINOR bump, not a MAJOR one.

## [0.3.1] - Unreleased

### Fixed

- **An unattributed bundle now forces `aggregateObservations`'s `overall` to
  `indeterminate` (`unattributed-bundle`)** instead of being counted in
  `unattributedCount` while `overall` could still read `satisfied`. Evidence
  that arrived but could not be attributed to any repository id was never
  evaluated, and a report that read green over it was the exact
  stopped-looking outcome this aggregator exists to prevent. The reason is
  added to `OBSERVATION_AGGREGATE_INDETERMINATE_REASONS`.

### Documentation

- **README states the observation-bundle transport's loop-close condition
  (issue #284's acceptance criterion).** Closes for an aggregating plane
  when every expected repository id resolves to a named reason in
  `report.repositories`, none silently omitted; reopens on any bundle
  shape `aggregateObservations` cannot classify. (This entry is
  documentation; the unattributed-bundle change above is the release's
  code change.)

## [0.3.0] - Unreleased

### Added

- **Observation-bundle transport (#255, narrowed to the aggregation
  transport only -- see the issue for the full scope decision):**
  `./observation-bundle.ts` and `./observation-aggregate.ts`.

  The fleet's evaluation model is inverted: each repository runs its own
  gates in its own CI and observes its own compliance; a plane wanting a
  fleet-wide picture reads what each repository already concluded about
  itself rather than re-scanning it centrally. This ships the one missing
  piece: a standard shape and fold for those self-observations, with no
  opinion on how they get fetched or stored.

  - `ObservationBundle` / `OBSERVATION_BUNDLE_SCHEMA_VERSION` -- one
    repository's self-observation: its identity, a caller-supplied
    `producedAt`, and one `GateResult` per gate it ran, reusing
    `@vespeneventures/controller/gates`'s existing ternary rather than a
    parallel result type.
  - `writeObservationBundle` -- pure, caller-supplied data in, a serialized
    JSON bundle out. No I/O, no clock, no network; throws on a caller's own
    malformed input.
  - `validateObservationBundleShape` / `parseObservationBundle` -- offline
    structural validation of an untrusted bundle, returning findings rather
    than throwing, so a stranger's malformed bundle becomes data to report
    on downstream, not a crash.
  - `aggregateObservations` -- folds N already-fetched bundles (supplied as
    data; this package fetches nothing) into one plane-level report, one
    status per expected repository, always present. A repository this
    aggregation expected to hear from but did not, a bundle that fails
    schema validation, a bundle older than the caller-supplied staleness
    threshold, and two or more bundles claiming the same repository
    identity are all reported `indeterminate` with a named reason -- never
    omitted, and never read as `satisfied`. `overall` folds every
    repository's result with this package's own `foldGateResults`, whose
    indeterminate-beats-violated-beats-satisfied precedence is exactly what
    keeps "2 of 5 repositories unobserved" from silently reading as "the 3
    we heard from were clean."

  **What this is not**, matching the narrowed scope: no network I/O
  anywhere in this package (fetching bundles is the consuming plane's own
  job), no storage opinion (a bundle can be a committed artifact, a release
  asset, or anything else a caller's CI decides), and no scheduling or
  polling. The broader declared-intent-vs-live-state generalization #255
  originally proposed is `./live-state.ts`'s `liveStateSurface` contract,
  already shipped; this is the transport for a different, narrower gap the
  issue also named, closed on the same narrow-scope-over-guessed-generality
  reasoning.

## [0.2.6] - Unreleased

### Changed

- **Widened the `@vespeneventures/controller` dependency range from `~0.6.0`
  to `~0.7.0`** to cover controller's new
  `repositoryProfileValidationCoverage` export under `./repository` (#309),
  which reports which of `validateRepositoryProfile`'s schema-version-gated
  checks actually ran. This package does not use
  `@vespeneventures/controller/repository`, so nothing here changes
  behaviorally.

## [0.2.5] - Unreleased

### Changed

- Widened the `@vespeneventures/controller` dependency range from `~0.5.0`
  to `~0.6.0` to cover controller's new custom-axis mechanism for
  `runRepositoryProfileCheck` (`RepositoryProfileRunInput.customAxes`,
  #324). This package does not use `@vespeneventures/controller/repository`,
  so nothing here changes behaviorally.

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
