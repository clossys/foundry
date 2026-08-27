# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.17] - 2026-08-25

### Fixed

- Completion evidence now fails closed on its consumer-owned proof: strict
  semver/RFC3339 parsing at most millisecond precision, distinct controls,
  an open linked position,
  exact baseline/source/cadence linkage, setpoint transition, and derived
  cadence aggregation all prevent internally inconsistent consumer-retained
  records from creating a false completion. The corrected causal sequence is
  `before < controls ≤ rollback ≤ after ≤ close start < recurrence ≤ close end`;
  in-window violated evidence dominates indeterminate evidence, and
  satisfaction needs a later satisfied cadence run. Malformed or incomplete
  evidence is indeterminate rather than a false completion. Retained reference
  and locator strings now fail closed when they carry credential, provider-value,
  or central-adoption-decision payload assignments or URL authority userinfo,
  through three bounded normalization layers. URL parsing uses actual
  delimiters in preserved and TAB/CR/LF-stripped views; candidates are scoped
  to standalone root atoms and query/fragment values, while path and opaque
  protection projects scalar by scalar to the next layer. A 65,536-code-unit
  reference cap applies; ordinary identifiers are not treated as values.
  Sensitive-assignment scanning now accumulates normalized scalar chunks before
  joining them, preserving its position map without quadratic work near that
  cap.
- Aligned the schema-v4 Advisor owned-metric identity to Advisor 0.1.2's
  published `engagement-decision-currency-rate` literal, so its exact
  completion evidence binds to the same role metric.

## [0.8.16] - 2026-08-25

### Fixed

- Aligned Controller's public role charter with the shipped schema-v4 contract:
  its exact schema version, primary and secondary modes, five universal loop
  stages, rule-conformance metric, consumer-owned setpoint and cadence,
  boundary, and independent close condition now have one generated README
  representation. The repository now fails when that representation drifts
  from the canonical role contract.
- Clarified that the root lifecycle-registry API is distinct from the
  repository's seven-state, evidence-derived package lifecycle ladder.

## [0.8.15] - 2026-08-24

### Added

- Extended the shipped schema-version-4 role-loop contract with the
  provider-neutral `@vespeneventures/advisor` role and its engagement decision
  currency metric. Consumer position validation now recognizes Advisor as an
  active role.

## [0.8.14] - 2026-08-24

### Added

- `@vespeneventures/controller/positions` now ships the versioned,
  consumer-owned completion-evidence contract and
  `foundry-completion-evidence-check`. It links one open position to exact
  package/install proof, invocation and placement, red/green control,
  duplicate removal, rollback, recurring-run evidence, and independent
  before/after outcome and close-window verdicts. Unreadable evidence remains
  indeterminate; the reported outcome is checked against the shipped role's
  metric direction and the linked position's setpoint rather than trusted as a
  caller label. Outcome-owner identifiers must be canonical printable ASCII,
  self-source comparison is case-insensitive, and a caller cannot hide a
  readable measurement behind an indeterminate label. The package does not
  read providers, credentials, or make a central adoption decision.

## [0.8.13] - 2026-08-24

### Fixed

- Corrected current README guidance after former Controller package names were
  retired; new integrations use Controller subpaths directly.

## [0.8.12] - 2026-08-24

### Fixed

- Installed-position validation now verifies the complete shipped
  `installed-position-contract` vocabulary against its implementation before
  accepting a consumer ledger. The role contract and position contract are
  both immutable packaged snapshots; exported vocabulary collections are
  frozen at runtime and vocabulary drift now fails closed.

## [0.8.11] - 2026-08-24

### Added

- `@vespeneventures/controller/positions` and `foundry-position-check`: a
  pure validator for consumer-owned installed-position ledgers. Every active
  role receives an explicit `open` or `not-applicable` disposition; open roles
  cite complete positions with first-day assessment and all five loop-stage
  bindings. The validator reads caller-supplied records only and never infers
  adoption, independent grounding, or closure.

## [0.8.10] - 2026-08-22

### Fixed

- `runGovernanceCheck` now runs `evaluateDependencyInstallability`. The rule
  shipped in 0.8.9 exported, documented and unit-tested, and no production
  caller invoked it — so the gate that exists to catch a still-installable
  package depending on a retired one never ran the rule that catches one. The
  edges come from the catalog's own manifests: `dependencies` plus any
  `peerDependencies` not marked optional, which is exactly what an install
  has to resolve. An optional peer that cannot resolve is not a broken install.

  **A consumer whose governance run passed may now fail.** That is the point:
  the rule and its documentation already promised this behaviour, and only the
  wiring was missing. Nothing about the rule's own judgement changed.

- The text output of `package-governance` now prints each finding — its rule,
  its location, and its message — under the counts. It previously reported
  `Lifecycle findings: 3` and stopped, so a failing run named nothing to fix.
  The detail was reachable only through `--verbose`, which dumps the whole
  report as JSON including every package description, leaving a reader to grep
  a blob for the lines that mattered. Counts stay; `--verbose` is unchanged.

## [0.8.9] - 2026-08-22

### Added

- `evaluateDependencyInstallability` — the ordering constraint on a retirement.
  A package that is still installable must not depend on one that is not, or
  installing it cannot resolve. Fires only where the depender is installable
  and its dependency is not: a deprecated package depending on a deprecated
  package is correct, and a retired package depending on a retired package
  cannot break, since nothing can install either. Verified against the real
  tree — 0 findings as-is, 2 on a subset retirement that would break an
  install, 0 when the affected packages are retired together.
## [0.8.8] - 2026-08-22

### Changed

- `evaluateLifecycleCoverage` now accepts an optional `packageVersions` map
  (keyed by package name) and, when supplied, emits a new
  `replacement-range-stale` finding whenever a terminal lifecycle entry's
  `replacement.range` does not cover the replacement's actual current
  version. Previously the `replacement-range` finding only checked that
  the declared range was syntactically valid semver, never that it still
  covered the replacement package it named — a range could go stale as
  the replacement kept shipping and nothing caught it. Omitting
  `packageVersions` keeps the prior behavior exactly, so this is additive.

## [0.8.7] - 2026-08-21

### Changed

- **BREAKING: the source-aware secret-surface gates moved off `./gates`
  onto their own subpath, `./gates/secrets`.** `checkCredentialInventory`,
  `checkCredentialSurfaceDrift`, `checkLocalSecretFiles`,
  `checkProviderResourceNames`, `checkSecretName`, `checkSecretReadiness`,
  `checkValueFreeSecretCatalog`, `detectRawSecretReads`, and their
  associated types are **no longer exported from
  `@vespeneventures/controller/gates`**. Import them from
  `@vespeneventures/controller/gates/secrets` instead.
- **`typescript` is an optional peer again**
  (`peerDependenciesMeta: { typescript: { optional: true } }`, restored).
  It was made required in 0.8.4 (issue #411) because
  `gates/secret-gates.ts` imports `typescript` unconditionally and, at the
  time, was re-exported unconditionally from the shared `./gates` barrel —
  so "optional" was a live lie for any `./gates` consumer. That fix traded
  one defect for another: with `typescript` required, an offline install
  of the published tarball (`npm install --offline`, no cache to resolve a
  peer from) failed outright, caught by
  `src/repository/installed-bin.test.ts`, for a consumer who never wanted
  a secret gate in the first place.

### Fixed

- **The actual defect from #411 — one gate's compiler dependency forcing
  itself on every `./gates` consumer, not the honesty of the manifest flag
  — is now fixed at the source.** `secret-gates.ts` lives behind its own
  subpath (`./gates/secrets`, `src/gates/secrets.ts`) and `gates/index.ts`
  no longer re-exports it, matching the same technique this package
  already used to keep the root entry point (`index.ts`/`governance.ts`)
  free of `typescript` — see `governance.ts`'s own header. `./gates` itself
  no longer requires `typescript` at all; `root-entry-boundary.test.ts` now
  asserts that boundary for `./gates` the same way it already did for the
  root, and traces `./gates/secrets` as the new (and now only) place
  `secret-gates.ts` is reachable from a public entry point.
  `gates/typescript-required.test.ts` proves both halves of the split with
  a mocked absent peer: `./gates/secrets` still rejects without
  `typescript` installed, and `./gates` no longer does.

## [0.8.6] - 2026-08-21

### Added

- **Two `foundry-governance` subcommands close the last remaining
  instances of issue #377** ("gates shipped as library exports with no
  CLI path are decorative"): `preflight` and `verify-published`. Traced the
  real call graph (not the import list) first: none of this package's five
  existing bins called `preflightPackage`, `preflightGovernedPackage`,
  `packRoundTrip`, or `verifyPublishedArtifact` anywhere — `packRoundTrip`
  was reachable only from an inline script inside
  `.github/workflows/publish.yml`, never from a bin a consumer could
  invoke — confirming the three were genuinely decorative, not merely
  under-exercised by this repository's own CI.
  - `foundry-governance preflight <lifecycle-file> <package-dir> [root]`
    calls `preflightGovernedPackage`, which itself calls `preflightPackage`
    and `packRoundTrip` — one subcommand reaches all three named exports
    via the call graph, the same "outer gate calling an inner one" shape
    already established for `verifyToolchain` → `reconcileToolchain` and
    `verifyComposedInstallation` → `verifyInstallation`. This also closes a
    real, previously-documented gap this repository's own contributor
    publishing guide named: no local command proved a package installs and
    imports cleanly before you propose publishing it.
  - `foundry-governance verify-published <expected-digest> <content-file>`
    calls `verifyPublishedArtifact` directly.
  - Extended the package's existing `foundry-governance` bin rather than
    adding a sixth bin, per the wiring rule this issue's own thread states.
    Dispatch is keyed on the literal `argv[0]`, never on
    `basename(process.argv[1])` — this repository invokes every gate by its
    compiled `dist/` path, under which a filename-keyed dispatch always
    sees `cli.js` and silently runs the wrong command, a defect that
    shipped once already during this same effort. Confirmed reachable the
    way this repository actually invokes gates: a new test spawns the real
    compiled `dist/cli.js` via `execFileSync` for both new subcommands AND
    the pre-existing no-subcommand invocation (unchanged).
  - The pre-existing, synchronous, no-subcommand `main` is unchanged —
    same signature, same behavior, same tests. The two new subcommands call
    `async` functions, so a new `mainAsync` dispatcher (which `run()` now
    calls) handles them and falls through to the original `main` otherwise.

## [0.8.5] - 2026-08-21

### Fixed

- **The three CLI `main()` functions no longer throw on malformed input
  (issue #392, medium finding).** `repository/cli.ts`, `gates/cli.ts`, and
  `review/cli.ts` each let a `CliInputError` from argument parsing or
  `JSON.parse`-ing a file escape `main()` itself, relying on a separate
  `run()` wrapper's `catch` to turn it into exit code 2 — meaning `main()`
  was not actually safe to call directly, unlike `inspector`'s and
  `builder`'s own CLI `main()` functions, which never throw and always
  return `0 | 1 | 2` themselves. Each of the three now wraps its own risky
  calls (argument parsing, file read + JSON parse, and — as a backstop, the
  same way `inspector`'s `main` wraps its own core call — the pure
  validator/check call itself) and returns `2` directly; `run()` is now a
  trivial `process.exitCode = main(...)` with nothing left to catch,
  matching the sibling pattern exactly rather than inventing a third one.
  Existing tests that asserted the old `toThrow(CliInputError)` behavior
  now assert the returned exit code instead.

## [0.8.4] - 2026-08-21

### Fixed

- **`typescript` is now a required peer, not an optional one (issue #411).**
  `gates/secret-gates.ts` has always imported `typescript` unconditionally,
  at module scope — `peerDependenciesMeta: { optional: true }` was a live
  lie: a consumer who believed it and skipped installing `typescript` got a
  hard `ERR_MODULE_NOT_FOUND` the instant anything reached the `./gates`
  subpath, not a degraded gate and nothing to catch it. This went unnoticed
  because #226 made the registry drop `peerDependenciesMeta` from published
  metadata, so every real consumer installed `typescript` regardless of
  what the flag claimed. `peerDependencies` is declared at the package
  level, not per subpath, so there is no way to keep the compiler optional
  for the root entry point (which genuinely never touches it — see
  `governance.ts`'s own header) while requiring it for `./gates` (which
  always does). Given that, the `optional` flag is removed; `typescript`
  is now an honest, required peer. `secret-gates.test.ts` and
  `public-contract.test.ts` assert the flag is gone, and a new
  `gates/typescript-required.test.ts` exercises the actual absent-peer
  import path (via a mocked resolution failure) rather than only asserting
  the manifest declaration.

## [0.8.3] - 2026-08-21

### Added

- **`RepositoryRequirement`'s constraint vocabulary now expresses an
  open-ended minimum-version floor (issue #318).** `{ kind: "present" }` and
  `{ kind: "one-of", values: [...] }` were the only two shapes: the first
  understates an open range like `engines.node: ">=20"` ("must merely
  exist"), and the second requires an exhaustive, closed enumeration that
  goes stale the moment a new value satisfying the same floor is released —
  exactly the gap that left this repository's own `governance/repository-profile.json`
  (issue #317) declaring `runtime.node` as bare `{ kind: "present" }`,
  weaker than the real `>=20` constraint. The new
  `{ kind: "minimum-version", floor: "20" }` shape closes it: `floor` is a
  bare dotted-numeric version string (`"20"`, `"20.11"`, `"10.33.0"`), parsed
  and compared by a new minimal, dependency-free comparator
  (`src/repository/version-floor.ts` — deliberately not
  `@vespeneventures/integrator`'s `semver.ts`; this package takes no runtime
  dependencies and the two parsers serve different grammars). `evaluateRepositoryRequirements`
  combines multiple declared floors for the same requirement by keeping the
  strictest, reports `conflicting` when a floor and a `one-of` set share no
  compatible value, and treats an observed value that does not itself parse
  as a version as `unsatisfied` — never `satisfied`. An unparseable `floor`
  on the constraint itself is a new `constraint-floor` structural finding,
  routed through the same closed `status: "invalid"` path every other
  malformed constraint already used, so it can never be silently treated as
  satisfied. Every existing `present` and `one-of` requirement continues to
  parse and evaluate identically — see the added regression coverage in
  `src/repository/validate.test.ts` and `src/repository/evaluate.test.ts`.

  Versioned `0.8.3`, not `0.9.0`: `packages/builder`, `packages/inspector`,
  and `packages/ledger` each declare `"@vespeneventures/controller": "~0.8.0"`.
  A minor bump falls outside that range and silently swaps their local
  workspace link for a remote registry copy on the next lockfile
  resolution — confirmed by hand via `npm install --package-lock-only`
  before settling on this version. `0.8.2` is skipped: it is both already
  published and, after this branch was rebased onto a newer `main`, also
  the version of the unrelated changelog-packaging release directly below
  this entry; this release is unrelated to either.

## [0.8.2] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.8.1] - 2026-08-20

### Fixed

- **`assertPeerVersion` no longer throws when it merely cannot PARSE an
  installed `typescript` version — including any version carrying a
  prerelease identifier (issue #389).** The version parser this guard uses
  accepts only strict `x.y.z`, and `assertPeerVersion` runs at MODULE LOAD
  from `gates/secret-gates.ts`, so the throw fired during import
  resolution, before any caller could catch it. An unparseable DECLARED
  RANGE is still this package's own bug and still throws, unchanged; an
  unparseable INSTALLED version is now treated as `indeterminate` — this
  guard warns once per distinct `(peer, foundVersion)` pair via
  `console.warn` and proceeds, rather than crashing the consumer's build.
  This is a deliberate, documented inversion of the fleet's fail-closed
  `indeterminate` contract (`gates/result.ts`): a CI gate must refuse to
  certify what it could not check, but a runtime import guard must not
  crash a consumer's build over a version string it merely failed to read.
  See `src/internal/peer-version.ts`'s own header for the full reasoning
  and the tradeoff this buys.

## [0.8.0] - 2026-08-20

### Fixed

- **`./review`'s required-check evaluation now grades the most recent run of
  each check name, not the first one it happens to encounter (issue #391).**
  A provider's status-check collection reports every run for one `name` at a
  head, not one current value per name, so a check can legitimately appear
  in `checks` more than once — a failed attempt and its later, passing
  re-run were both present as separate entries. `validateReviewEvidence`
  previously graded a required check by simple membership across every entry
  for that name, so once one run had failed, a later genuinely successful
  re-run of the same name could never clear the verdict: the stale failed
  entry was still in the collection and always would be. Confirmed live
  twice against one consumer repository, where a `task-record` re-run went
  green and the gate still reported it failed on two subsequent runs.

  `ReviewCheck` gains an optional `completedAt` (RFC 3339 completion
  timestamp) so recency can be decided without guessing; it is optional,
  unlike `ReviewRecord.submittedAt`, because a check that has not finished
  yet genuinely has none, and a check name with only one current-head entry
  never needs one. `normalizeGitHubReviewEvidence` (`./review/github`) reads
  it from a GitHub check node's `completedAt`/`completed_at`, the same
  optional, never-invented way it already reads `headSha`/`head_sha`.

  Two adjacent correctness gaps are closed in the same pass, both following
  the same never-guess discipline:

  - **Pagination.** A required check's own verdict is now
    `"required-check-indeterminate"` — never a pass or a failure — for as
    long as `paginationComplete` is not `true`, even when every run already
    observed for that name reported `"success"`: an unread page could still
    hold a newer run of the same name.
  - **`headSha` skew.** A run observed for a superseded head was already
    excluded from grading via the existing per-item `headSha` check (and
    still separately, unconditionally reported as `"stale-evidence"`); that
    behavior is now stated explicitly as the deliberate design, not
    incidental.

  When more than one current-head run for a name remains after that (the
  new case this release adds), and recency cannot be decided without
  guessing — a run with no `completedAt` in the mix, or several runs tied
  for the latest `completedAt` that disagree on `conclusion` — the required
  check is `"required-check-indeterminate"` rather than graded either way.
  Two new `ReviewFindingRule` values support this:
  `"required-check-indeterminate"` and `"check-completed-at"` (an invalid,
  present `completedAt`). Every existing caller with at most one current-head
  run per required check name — the common case — is completely unaffected:
  same input, same output.

## [0.7.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.7.1] - Unreleased

### Documentation

- **README states the `./repository` runner's loop-close condition
  (issue #282's acceptance criterion).** Falsifiable, not a mission
  statement: closes for a consuming repository when `repository-profile-check`
  is a required check that has proven it blocks a schema-invalid declaration,
  and no hand-written evaluator survives beside it; reopens on any contract
  gap a caller has to file (`customAxes`, issue #324, exists because one
  was). No code change.

## [0.7.0] - Unreleased

- **`./repository` exports a new `repositoryProfileValidationCoverage(value)`
  (#309), reporting which of `validateRepositoryProfile`'s schema-version-
  gated checks it actually ran.** `validateRepositoryProfile` accepts three
  repository-profile schema versions, but a legacy (v1) profile has no
  `requirements` or `rootEntries` fields at all, and a v2 profile has
  `requirements` but not `rootEntries` — so an empty `findings` array from
  `validateRepositoryProfile` looked identical whether those fields were
  genuinely checked and found correct, or never examined because the
  declared schema version predates them. `repositoryProfileValidationCoverage`
  answers that directly, returning `{ requirementsChecked, rootEntriesChecked }`
  for the same input, without re-running validation. `validateRepositoryProfile`
  itself is unchanged — same input, same output, for every existing caller.
  Never throws, even for a revoked `Proxy` or another object whose reflective
  operations throw instead of returning `false` — it falls back to the same
  strictest-schema coverage a merely-unrecognized `schemaVersion` gets,
  matching `validateRepositoryProfile`'s own fail-closed try/catch.

## [0.6.0] - Unreleased

### Added

- **`runRepositoryProfileCheck` now accepts caller-supplied custom axes for
  derived cross-reference checks (`./repository`, issue #324).** The runner
  previously covered exactly two axes — declared requirements and the root
  vocabulary — and had no way to express a DERIVED comparison against a
  consumer's own source of truth: one consumer repository cross-references
  `commands[].run`'s `npm run <script>` against its manifest's real
  `scripts` map and `protectedPaths` against a live path-matching predicate
  in its own merge-governance workflow; another verifies a `run` file path
  exists on disk and that each `protectedPaths` entry's basename is
  referenced across a set of governance files. Neither can be expressed as
  a `RepositoryRequirementObservation` or a root entry, so migrating either
  consumer fully onto the shared runner would have silently dropped a real
  check. `RepositoryProfileRunInput.customAxes` closes that gap: an
  optional list of `{ name, result }` pairs where `result` is a
  caller-ALREADY-EVALUATED `GateResult` for a comparison only the caller
  can perform — this package still learns nothing about any specific
  consumer's manifest layout, workflow file, or governance convention. Every
  custom axis folds through the exact same `foldGateResults` call, and
  therefore the exact same `indeterminate` > `violated` > `satisfied`
  precedence, as the two built-in axes: an indeterminate custom axis makes
  the whole run indeterminate even when every built-in axis is satisfied. A
  custom axis whose `result` is not itself a well-formed `GateResult` is
  never ignored and never treated as `satisfied` — it folds to
  `indeterminate` under the new `custom-axis-indeterminate` and
  `custom-axis-invalid` reasons (added to `REPOSITORY_PROFILE_RUN_REASONS`),
  the latter naming which axis was malformed. Schema validation still runs
  unconditionally first: no custom axis is ever reached for a schema-invalid
  declaration, proven by a dedicated regression test. `customAxes` is
  optional and additive — every existing call to `runRepositoryProfileCheck`
  keeps working unchanged, with identical results; the full pre-existing
  test suite passes untouched. `repository-profile-check`'s `--discovery`
  file gained a third, equally optional `customAxes` key carrying the same
  `{ name, result }` shape — reading it is not new I/O, it is the same file
  read the two existing discovery keys already go through; producing the
  comparison itself remains entirely the caller's own responsibility,
  performed before this command is ever invoked.

## [0.5.0] - Unreleased

### Added

- **The repository-profile runner (`./repository`, issue #321):
  `runRepositoryProfileCheck` and the `repository-profile-check` CLI.**
  This package previously shipped the contract — schema, validator, pure
  evaluators, the exit-code ternary — but not the thing that runs it: locate
  a declaration, observe the repository's real state, call the evaluators,
  decide one of `satisfied` / `violated` / `indeterminate`
  (`@vespeneventures/controller/gates`'s `GateResult`), and print something
  actionable. `runRepositoryProfileCheck` is that runner as a single,
  zero-I/O call; `repository-profile-check` is the single command wrapping
  it, alongside the existing `repository-check`. Discovery of the
  repository's real state — requirement observations and the root
  direct-child listing — is always caller-injected, never performed by this
  package: it takes exactly the shapes `evaluateRepositoryRequirements` and
  `evaluateRepositoryRoot` already accept, so the runner stays hermetically
  testable and keeps working with no shell or network access.
  `validateRepositoryProfile` runs unconditionally before either evaluator
  is ever reached, and a schema-invalid declaration is `indeterminate` —
  never routed to evaluation, never `satisfied`. `rootObservedEntries:
  undefined` (root discovery never ran) is deliberately distinct from `[]`
  (root discovery ran and found nothing): collapsing the two would report a
  declared-but-unevidenced root vocabulary as a real violation instead of
  the honest "could not evaluate."

## [0.4.0] - Unreleased

### Added

- **`repository-check` (`./repository`) now locates a declaration without
  being told where it is (#315).** `governance/repository-profile.json` is
  the settled canonical location, exported as
  `CANONICAL_REPOSITORY_PROFILE_PATH`. Given no argument, or a directory
  argument, the CLI searches that root for a declaration; the canonical path
  is always checked first and, when present, is always what gets used — a
  file anywhere else never shadows it. A declaration found somewhere else
  (the canonical filename under a different directory, or the one known
  former filename, `repository-declaration.json`, under the canonical
  directory) is reported through its own `declaration-non-canonical-location`
  finding, and no declaration anywhere is `declaration-not-found` — the two
  are never conflated, so a repository that has a declaration in the wrong
  place is never read as a repository that declares nothing. Passing a file
  path directly still validates exactly that file, with no search at all.
  The pure `/repository` evaluators remain zero-I/O; discovery lives only in
  the CLI, which already owned this package's only I/O.
- **The requirement-id grammar is now closed and two-segment (#316):
  `<category>.<subject>`, with `category` one of `runtime`, `tool`,
  `dependency` (exported as `REQUIREMENT_ID_CATEGORIES`).** The governing
  principle: the id names the slot, the constraint names the value. An id
  that instead embeds its own value or precision — an extra segment
  (`runtime.node.major`) or a concrete answer folded into the category
  (`package-manager.npm`) — is now reported as a `requirement-id-value-embedded`
  finding rather than accepted, in `validateRepositoryProfile` and in the
  requirements evaluator's observation ids alike, so this drift cannot
  silently recur. An id that isn't shaped like `<category>.<subject>` at all
  remains the more generic `requirement-id` finding.

### Changed

- **Breaking: `repository-check`'s positional argument is now optional, and
  a directory argument no longer errors.** Previously a required exact
  profile-file path; a missing argument or a directory argument each threw
  `CliInputError` (exit 2). Both are now valid, and both start the discovery
  described above instead of failing to run — see Added, above. An explicit
  *file* path continues to validate exactly that file exactly as before.

### Fixed

- **`reconcileLiveState` (`./conventions`) now compares `declaredAt`/
  `liveObservedAt` as instants, not as strings (#313).** The doc comments on
  both fields require only "ISO 8601," which permits UTC offsets other than
  `Z` and optional fractional seconds; two valid ISO 8601 values could
  therefore compare in the wrong direction as plain strings (for example,
  `"2026-08-10T09:00:00+02:00"`, 07:00 UTC, sorted lexicographically *after*
  `"2026-08-10T08:00:00Z"`, 08:00 UTC, even though it names an earlier
  instant). This was the sole trigger for the
  `live-artifact-predates-its-declaration` finding, so with mixed offsets
  that finding could silently fail to fire, or fire when it should not.
  Both timestamps are now parsed with `Date.parse` and compared as epoch
  instants. A `declaredAt`/`liveObservedAt` that is present but cannot be
  parsed as an instant is now reported as a `declared-but-not-verifiable`
  **finding** (naming which field and value could not be parsed), never as
  a silent pass. That finding is recorded in the same `findings` list as
  any outright disagreement `agrees` already found, rather than returned
  as an outcome-level `could-not-verify` that would have discarded it —
  review on the first version of this fix caught that an early-return
  there was silently dropping a real, already-collected
  `live-differs-from-declared` finding whenever the timestamp also
  happened to be unparseable. `LiveStateFinding.kind` is now typed as the
  full five-kind `LiveStateSurfaceFindingKind` (previously the
  four-kind-only `LiveStateDriftKind`) to allow this.

  The final verdict reads WHICH kinds ended up in the findings list, not
  merely whether it is non-empty — a second round of review caught that
  reporting `violated` whenever `findings.length > 0` manufactures a
  violation for a subject whose values genuinely agree and whose ONLY
  issue is an unparseable timestamp, which is exactly what
  `indeterminate` exists to report instead. Any real drift kind (one of
  `LiveStateDriftKind`'s four) present anywhere in the list makes the
  subject `drifted`, carrying every finding collected including a
  `declared-but-not-verifiable` one riding alongside it; a lone
  `declared-but-not-verifiable` finding with no real drift makes the
  subject `indeterminate` instead, never a manufactured violation; no
  findings at all is `verified`. A confirmed finding is never downgraded
  to could-not-verify, and an unverifiable dimension is never inflated
  into a violation.

### Documentation

- `conventions/documents/live-state-reconciliation.md` now says a
  declaration names **five** things, matching the five fields it actually
  lists (`store`, `readableByScript`, `readableBy`, `reconciledBy`, `note`);
  it previously said four.
- `live-state-reconciliation.md`, `routine-declaration.md`, and
  `schedule-declaration.md` now distinguish the `could-not-verify`
  **outcome** from `declared-but-not-verifiable`, its machine-readable
  **reason**, and state explicitly that `could-not-verify` covers both a
  read that was never attempted and a read that was attempted and reported
  a blocker mid-attempt (an API returning 500, a permission refused) — not
  only a surface that is unreadable in principle.
- The README's `liveStateSurface` section now states the mapping from this
  module's `verified` / `drifted` / `could-not-verify` vocabulary to
  `GateResult`'s own `satisfied` / `violated` / `indeterminate` verdict
  literals explicitly, rather than leaving a reader to infer it from the
  tests.

## [0.3.0] - Unreleased

### Added

- **`./conventions` gains the canonical `liveStateSurface` contract (#255):**
  `LIVE_STATE_SURFACE_FINDING_KINDS` (all five finding kinds, including
  `declared-but-not-verifiable`), `LiveStateSurfaceDeclaration` and
  `validateLiveStateSurfaceDeclaration`, `reconcileLiveState`, and the three
  outcome constructors `liveStateVerified` / `liveStateDrifted` /
  `liveStateCouldNotVerify`. This consolidates a shape that had already been
  reimplemented independently in `@vespeneventures/builder` and
  `@vespeneventures/observer`, plus this package's own tier-specific
  `reconciliationFindingKinds` (`./routines.ts`) and
  `scheduleReconciliationFindingKinds` (`./schedules.ts`): `controller` owns
  every rule those two vocabularies already specialize and has no dependency
  of its own, so it is the shape's one canonical home. Neither tier-specific
  validator's behaviour changed.
- New shipped convention document,
  `conventions/documents/live-state-reconciliation.md`, naming the shared
  contract once: a declaration of intent, a live state owned elsewhere, a
  reconciliation surface that may not exist yet, and the three-state outcome
  (verified / drifted / could-not-verify) that keeps "nobody looked" from
  reading as "looks fine." `routine-declaration.md` and
  `schedule-declaration.md` now each cross-reference it as the shape their
  own finding vocabulary specializes.

## [0.2.1] - Unreleased

### Fixed

- **`branch-provenance-hook.sh` and `scoped-main-push.sh` no longer treat an
  unset required `AGENT_BRANCH_PREFIX` as allow.** Both hooks signal their
  decision on stdout; exiting 0 with empty stdout is read by the caller as
  "allow." With the variable unset, both hooks printed a stderr line saying
  "refusing to run unconfigured" and then did exactly the opposite — exited
  with no stdout, permitting the very branch creation or default-branch push
  they exist to block, while the log read as if the guard had run and
  refused. This is live, not theoretical: `scoped-main-push.sh` used to
  hardcode its prefix, so it always evaluated; parameterizing it for
  publication removed the hardcoded value without giving the unset case a
  safe direction, so any consumer moving from a hardcoded local copy to the
  published one loses default-branch protection silently unless something
  else happens to set the variable — and the variable comes from the agent
  product's own hook registration, which a consuming repository does not own
  and cannot set for its operator (issue #307).

  The fix has two parts:

  1. When `AGENT_BRANCH_PREFIX` is unset, the branch-provenance naming rule
     (the only rule that reads the variable) now emits an `ask` decision —
     the same JSON shape these hooks already use for `deny` — naming the
     missing variable and stating that the rule cannot evaluate without it,
     instead of exiting silently. `ask` was chosen over an unconditional
     `deny`: it keeps the guard's decision in a human's hands rather than
     dropping it, and it does not make every branch creation in an
     unconfigured install fail outright the way `deny` would — which in
     practice tends to get a hook deleted rather than configured, the
     opposite of what a default-branch guard is for.
  2. Default-branch push protection in both files never actually read
     `AGENT_BRANCH_PREFIX` — only the branch-naming rule does. Both hooks
     previously exited before reaching the push check at all whenever the
     variable was unset, which is the actual mechanism behind the silent
     allow. Push protection is now fully decoupled from that variable and
     stays enforced (`deny`/`ask`, exactly as when configured) regardless of
     whether `AGENT_BRANCH_PREFIX` is set.

  The misleading comment directly above the old unset-handling code (which
  asserted a safety property — "refusing to guess is the point" — that the
  code did not have) is rewritten to describe what the code actually does.

  `heavy-cmd-hook.sh`'s unrelated advisory degrade-open behavior (an unset
  or unresolvable `HEAVY_CMD_PREFLIGHT_COMMAND` prints a warning and
  continues) is unchanged and now carries a comment recording why: it is a
  resource-discipline preflight, not a protection boundary, so continuing on
  missing configuration is the correct default there — the difference from
  the two hooks above is a recorded decision, not two scripts that happen to
  differ.

## [0.2.0] - Unreleased

### Added

- Skill registry `scope` is now a closed, three-value enum: `account`
  (operates on one account's own repository inventory), `repo` (operates
  inside a single repository), and `third-party` (vendored from an external
  source; has no owning account). There is deliberately no fourth,
  "machine" or plane-spanning, tier — a skill encodes judgment about a
  specific inventory someone actually reviewed, and "the machine" has no
  inventory of its own to have judgment about. See
  `conventions/documents/skill-grammar.md` and
  `conventions/documents/skill-registry.md`.
- Three new adapter files under `./conventions/adapters/*`:
  `heavy-cmd-hook.sh` (resource-discipline preflight hook),
  `scoped-main-push.sh` (default-branch protection and branch provenance
  inside a discovered canonical workspace tree), and `workspace-shell.zsh`
  (generic interactive workspace-navigation helpers). All three are
  account-neutral: configured entirely through the environment, with no
  operator path, account name, or topology baked in.

### Changed

- **Breaking:** the registry validator now hard-rejects two previously
  accepted `scope` values instead of silently normalizing or vaguely
  rejecting them. `"plane"` (this registry's own former name for the tier
  now called `"account"`) and `"workspace"` (an independent name a
  different consuming account had settled on for the identical concept)
  both now fail validation with a `registry/legacy-scope` finding whose
  message names `"account"` as the replacement. The former `"repository"`
  value is rejected the same way, naming `"repo"`. `RegisteredSkill` also
  drops the separate `thirdParty` boolean now that `scope: "third-party"`
  carries the same fact in the one field that already decided a skill's
  identity.

## [0.1.0] - Unreleased

### Added

- First release of `@vespeneventures/controller`, formed by merging three
  packages into one (issue #282, program issue #281): `@vespeneventures/governance`
  (`0.15.0`) — package lifecycle, catalog, gates, release, repository,
  review, cleanup, and composition — `@vespeneventures/conventions`
  (`0.8.0`) — account-neutral agent conventions — and
  `@vespeneventures/policy` (`0.1.0`) — the content-addressed binding
  primitive. Every subpath previously reachable under the three old package
  names resolves unchanged under `@vespeneventures/controller`: this is a
  rename and a merge, not a rewrite, and no public API was redesigned.
- New subpaths: `./conventions` (governance's own `./gates`, `./repository`,
  etc. carry over unchanged), `./conventions/documents/*`,
  `./conventions/adapters/*`, and `./policy`.
> **Current lifecycle note:** the predecessor packages named below are now
> retired. This release entry records their state at the time of 0.1.0; the
> lifecycle contract is authoritative for current availability.

- `@vespeneventures/governance`, `@vespeneventures/conventions`, and
  `@vespeneventures/policy` are deprecated. `governance` and `policy` remain
  published as thin compatibility stubs forwarding here (their own
  compatibility-shim consumers — `catalog`, `gates`, `release`,
  `repository`, `review`, and, outside this program, `ledger` and
  `verify-standards` — would otherwise be stranded); `conventions` had no
  installed consumer and is retired outright, with no compatibility stub.
  See [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller).
  Issue #288 removes the `governance` and `policy` stubs once the migration
  window closes.

See `@vespeneventures/governance`'s own historical changelog (this package's
former name, before issue #282) for this source's history before the merge.
