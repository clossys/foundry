# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-08-14

### Added

- **Repository requirements schema v2 and pure evaluation** under
  `./repository` (#237). A v2 `RepositoryProfile` adds a strict, ordered
  `requirements` declaration with neutral `repository`, `workspace`, and
  `machine` scopes plus `present` and caller-enumerated `one-of`
  constraints. Foundry supplies no requirement values or defaults.
- `evaluateRepositoryRequirements` and
  `validateRepositoryRequirementsEvaluationInput` accept caller-associated
  declarations and caller-normalized observations, then report every
  `satisfied`, `unsatisfied`, `conflicting`, or `unknown` requirement. Missing
  and explicitly unknown evidence both fail closed. Shared constraints are
  intersected without selecting a value or interpreting version syntax;
  repository-scoped requirements remain independent by source.
- New declaration, constraint, scope, observation, evaluation, status, and
  finding types are exported from `@vespeneventures/governance/repository`.
  The evaluator performs no filesystem, Git, GitHub, provider, scheduler,
  credential, installation, or mutation I/O.

### Changed

- **Breaking for exhaustive type consumers:** `REPOSITORY_PROFILE_VERSION`
  is now `2`, and `RepositoryProfile` is the explicit
  `RepositoryProfileV1 | RepositoryProfileV2` union. The original closed v1
  shape remains accepted deliberately through `RepositoryProfileV1` and
  `LEGACY_REPOSITORY_PROFILE_VERSION`; a v1 profile cannot silently add v2
  fields.

## [0.8.1] - 2026-08-14

### Changed

- **Documented effective install behaviour on the GitHub Packages
  registry.** `typescript` is correctly declared `optional: true` in
  `peerDependenciesMeta`, but `npm.pkg.github.com`'s packument omits that
  field entirely, so an installer resolving against this registry treats
  it as required the moment this package is installed at all, including
  for a consumer who only ever imports the root and never touches
  `./gates`. No `peerDependenciesMeta` block changed; see the README's
  "Requirements" section and
  [issue #226](https://github.com/vespeneventures/foundry/issues/226) for
  the full evidence and decision.

## [0.8.0] - 2026-08-14

### Added

- **`./cleanup` subpath**: `classifyCleanupCandidate(candidate)` — a pure,
  deterministic workspace-cleanup classifier: the shared decision core
  behind every account-plane cleanup skill (#215). It performs no Git,
  filesystem, GitHub, scheduler, credential, network, or deletion I/O — it
  classifies caller-normalized inventory and observations, nothing more,
  and exports no deletion API of any kind.
  - Returns exactly one `CleanupProposal` per candidate: a stable
    `"owned"` / `"safe-candidate"` / `"blocked"` status plus every
    applicable machine-readable reason code, in a fixed, tested precedence
    order. `"owned"` is checked first and is unconditional (a canonical
    clone or a default-branch checkout is never a cleanup candidate,
    regardless of any other evidence); `"blocked"` runs every remaining
    check and collects every reason that applies, never stopping at the
    first; `"safe-candidate"` is reached only when every check passed on
    complete evidence.
  - Missing evidence and structurally incomplete evidence (a field
    claiming to be known whose value is absent) are treated identically —
    both block, with a distinct `*-evidence-missing` reason code — the
    same "a check that cannot run must fail, never pass" discipline this
    package's own `FoundationReport.complete` and `Catalog.skipped`
    already follow (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
  - `"safe-candidate"` is documented, on the type itself, as a proposal
    only — never deletion authorization. See the README's `./cleanup`
    section for the full contract, the precedence order, and thin-adapter
    guidance for a consuming skill.

## [0.7.0] - 2026-08-13

### Added

- **`./artifacts` subpath**: `verifyGovernedArtifact(manifest, content,
  options)` and `verifyGovernedArtifacts(entries, options)` — a reusable
  contract for verifying a consumer-owned governed artifact that combines a
  declared kind + schema version, an exact-content checksum, and structural
  source/revision provenance, in one deterministic, fail-closed order (#195).
  - Verification runs five fixed stages, each short-circuiting on its first
    error: caller options, manifest structure (including provenance shape),
    artifact kind, schema version, then — last, and only once kind and
    schema version are both accepted — the exact-content checksum. Checking
    the checksum last closes #195's core complaint: a checksum could
    previously pass while the schema version was unsupported, or provenance
    could be attached without ever being checked. See the README's
    "Governed artifact verification" section for the full order and
    reasoning.
  - Digest comparison is delegated entirely to `@vespeneventures/policy`'s
    own `validateBindingShape`/`verifyBinding` via a small synthetic
    `PolicyBinding` — this subpath reimplements no hashing and no digest
    shape/length logic of its own.
  - Fails closed on every ambiguous input: a non-object or accessor-backed
    manifest, an unknown manifest/checksum/provenance field, a missing or
    blank kind/schemaVersion/provenance field, a malformed digest, an
    unsupported checksum algorithm, an unsupported schema version, a wrong
    artifact kind, and an empty `supportedSchemaVersions` (a caller
    configuration error, never an artifact that trivially passes).
  - `verifyGovernedArtifacts` additionally fails closed on an EMPTY batch —
    `"artifact/empty-batch"`, never a clean `[]` — the same
    "a check that cannot run must fail" discipline as
    `scripts/check-release-readiness.mjs` (fixed in commit `01bd520`).
  - Findings never include artifact bytes, digest values, source, or
    revision values — only stable rule/path/message text.
  - New exports: `verifyGovernedArtifact`, `verifyGovernedArtifacts`,
    `validateGovernedArtifactManifest`, `validateGovernedArtifactOptions`,
    `readGovernedArtifactManifest`, `GovernedArtifactManifest`,
    `GovernedArtifactChecksum`, `GovernedArtifactProvenance`,
    `GovernedArtifactVerificationOptions`, `GovernedArtifactBatchEntry`,
    `GovernedArtifactFindingRule`, `GovernedArtifactManifestRead`.
  - No new runtime dependency: `./artifacts` uses only
    `@vespeneventures/policy`, already this package's sole dependency.

## [0.6.0] - 2026-08-13

### Added

- **`PackRoundTripOptions.tarballPath`.** `packRoundTrip` (`./release`) can
  now be pointed at an already-packed tarball instead of always running its
  own `npm pack` on `packageDir`. A caller that has already packed the exact
  bytes it needs checked — a tarball about to be published, or one fetched
  from a registry — passes it via `tarballPath`, so the round trip checks
  those bytes instead of risking a second, separately-produced pack that
  could silently diverge from them. `packageDir/package.json` still supplies
  the declared `exports` surface to check; only which bytes get installed
  changes.

  This closes a real gap: the publish workflow's post-publish step already
  passed a `tarballPath`-shaped option to `packRoundTrip`, expecting it to
  check the fetched, just-published tarball — but the option did not exist
  on `PackRoundTripOptions`, so it was silently ignored and the function
  always re-packed the current working tree instead. That step never
  actually checked the tarball it claimed to. It does now, and this option
  is also what lets the publish workflow move this proof to *before*
  `npm publish` (see the workflow's own history for the ordering fix this
  enables).

## [0.5.1] - 2026-08-13

### Added

- **`typescript` peer-version guard.** `src/gates/secret-gates.ts` — the
  sole importer of the `typescript` optional peer — now calls
  `assertPeerVersion` (new internal `src/internal/peer-version.ts`) at
  import time, throwing a named, actionable error when `typescript` is
  either not installed or installed outside this package's declared
  `~6.0.0` range — distinct messages for each case. Previously, an absent
  or incompatible `typescript` produced no signal until something inside
  the compiler API itself crashed. See the README's "Requirements"
  section. (#182)

## [0.5.0] - 2026-08-13

### Fixed

- `packRoundTrip` (`./release`) now verifies a **wildcard `exports` subpath**
  instead of resolving it as a literal filesystem path. A manifest declaring
  `"./documents/*": "./documents/*"` previously made the verifier look for a
  file named `documents/*`, never find one, and report a package that shipped
  every promised file as missing its assets — a false
  `round-trip-asset-missing`. Wildcard subpaths are standard Node `exports`
  syntax, and this fired for real on an already-published tarball: the
  publish succeeded and the isolated install proof that runs immediately
  after it failed, which is the worst point in the pipeline to discover a
  verifier defect.

  A wildcard is now **expanded** against the files the installed tarball
  actually shipped, and each expansion is checked exactly like a literal
  subpath — executable matches are imported through Node's own resolver from
  the isolated consumer, static matches are checked for presence, and a
  wildcard declaration target (`"types": "./adapters/*.d.ts"`) expands the
  same way. Expanding a pattern is deliberately not a way to stop checking
  it: a pattern that matches nothing exports nothing to a consumer, and is a
  new `round-trip-pattern-unmatched` error finding. So is a key carrying more
  than one `*`, which Node's resolver can never select for any specifier.

### Changed

- `ImportCheck["mode"]` gained a `"pattern"` member (`./release`), reporting
  the expansion of a wildcard subpath itself; each file it expanded to gets
  its own entry under its concrete subpath and its own mode. Additive, but it
  widens a union a consumer may be switching over exhaustively.
- A package whose wildcard target carries no extension (`"./adapters/*"`)
  now installs declared runtime peers before its exports are checked. The
  expansion could be executable or static and there is no way to know before
  the install, so peers are installed rather than risking a false import
  failure.

## [0.4.0] - 2026-08-13

### Added

- `evaluateRatchet(current, baseline)` (`./gates`): a generic, pure
  "warn-first with a checked-in baseline, ratchet monotonically toward
  zero" primitive. `current <= baseline` passes; `current > baseline` is a
  `"ratchet/regression"` finding; `current < baseline` still passes but is
  reported explicitly via an `improved: true` flag plus a
  `"ratchet/baseline-stale"` warning finding, so real progress is never
  silently dropped. Fails closed — `status: "invalid"` — on a negative or
  non-integer `current`/`baseline`, or a missing (`undefined`/`null`)
  baseline; a missing baseline is "could not run", never "baseline of
  zero". Lowering the baseline is always an explicit, separate action —
  this function never does it automatically.
- `checkOverrideTargetRanges(overrides)` (`./gates`): a package.json
  `overrides` entry's target range must be upper-bounded to the vulnerable
  major, never a bare `>=x.y.z` — an unbounded target lets a resolver hoist
  a dependent across a major version boundary and break it at runtime, a
  class of break a security audit cannot catch (an audit only confirms the
  vulnerable version is gone, never that its replacement stays
  API-compatible). Hand-rolled range parsing, no semver dependency: accepts
  an exact pin, a `~`/`^` range, an explicit space-hyphen-space range, or a
  single/paired `>=`/`>`/`<`/`<=` comparator range; anything it does not
  confidently understand (OR ranges, x-ranges, dist-tags, git/file/workspace
  specifiers, and more) is reported as unparseable rather than assumed safe.
- `checkDependencyScope(catalog, scope, allowlist, options?)` (`./gates`):
  mechanical enforcement of this repository's own contribution policy,
  "Dependencies: the default answer is no" — every `dependencies` entry in
  a workspace's package.json under `packages`
  must be `<scope>/*`-scoped, unless it is named in a small, checked-in
  allowlist entry carrying a non-empty reason and a `reviewBy` date. A
  malformed allowlist document or entry is itself a finding and exempts
  nothing; an entry whose `reviewBy` date has passed stops exempting its
  dependency and is reported as expired. Deliberately scoped small: every
  runtime dependency in this repository was verified by inspection to
  already be first-party, so this is a floor matching that reality, not a
  full admission-and-retirement register.

## [0.3.0] - 2026-08-13

### Changed

- **Breaking:** `typescript` moved from an unconditional `dependencies`
  entry to an optional `peerDependency` (`peerDependenciesMeta` marks it
  optional). It is imported only by `src/gates/secret-gates.ts`, reachable
  only through `./gates`. Issue #152 asked for exactly this; the 0.2.1 fix
  above corrected only the import graph — the root entry stopped
  transitively *loading* TypeScript — and left the manifest unchanged, so
  every consumer, including the five compatibility packages (`catalog`,
  `gates`, `release`, `repository`, `review`) that depend on `governance`,
  still *installed* a full compiler regardless of whether they ever
  imported `./gates`. Under this repo's pre-1.0 semver policy a breaking
  change to a 0.x package is a MINOR bump, not MAJOR.
- **Breaking — action required on upgrade:** the lifecycle schema now
  requires new fields. `forwardsToReplacement` (boolean) is required on
  every `deprecated` entry. A status of `qualified` requires
  `qualifiedEvidence`; a status of `adopted` requires both
  `qualifiedEvidence` and `adoptedEvidence`, each shaped
  `{ reference, date }`. **A consumer validating its own lifecycle file
  against an existing `deprecated` entry will fail validation until it adds
  `forwardsToReplacement`.** Set it to `true` if the deprecated entry's old
  import path still resolves to a working compatibility re-export, `false`
  if it is a hard break.
  - `forwardsToReplacement` exists because a deprecated package that still
    re-exports working code was previously indistinguishable, in the
    machine-readable registry, from one whose source is gone entirely —
    both carried identical `status`/`replacement` fields, and the
    difference existed only in prose one hop away.
  - The evidence fields exist because retiring a package required durable
    evidence while promoting one to "confirmed consumer use" required
    none, and the schema previously rejected any attempt to attach it.
- This repository's own lifecycle registry
  (`docs/contracts/package-lifecycle.json`) now marks `deployment`,
  `domain`, `ledger`, `policy`, and `secrets` as `published` instead of
  `adopted`. No durable public evidence could be cited for the stronger
  `adopted` claim under the new evidence requirement above — an
  unsubstantiated status is worth less than an accurate lower one.

### Added

- `RepositoryProfile`, `ReviewPolicy`, and `ReviewEvidenceBundle` are now
  documented with field tables and worked examples in this package's own
  README. They were previously documented only in the deprecated
  `repository` and `review` compatibility packages, both of which direct
  readers here for the schema — so the two docs pointed at each other and
  neither actually carried it.

## [0.2.1] - 2026-08-13

### Fixed

- The root entry (`import "@vespeneventures/governance"`) no longer
  transitively loads the TypeScript compiler. `governance.ts` and
  `release/preflight.ts` each imported `runFoundationCheck`/
  `computeBuildOrder` from the `./gates/index.js` barrel rather than from
  the specific files those functions live in — and that barrel also
  re-exports `secret-gates.ts`, whose own top-level `import ts from
  "typescript"` rode along with it regardless of which single export a
  caller actually wanted. A plain root import now stays free of the
  compiler itself; a consumer who deliberately imports the public
  `@vespeneventures/governance/gates` subpath still gets everything,
  unchanged, secret-gates included. This is specifically about
  `typescript`: the root already used `node:fs` (workspace discovery) and
  `preflightGovernedPackage` already used `node:child_process` (a real
  tarball pack-and-install check) before this change, for reasons entirely
  unrelated to the barrel-import bug fixed here — see the README's
  "Requirements" section for the precise boundary. Surfaced by a consumer
  integration (#152).

## [0.2.0] - 2026-08-12

### Added

- Explicit lifecycle maturity states for incubating, published, qualified,
  and adopted packages, while retaining legacy `active` records for schema-v1
  compatibility.
- A distinct retired state with dated durable retirement evidence and CLI
  maturity summaries.
- The `catalog`, `gates`, `release`, `repository`, and `review` subpaths,
  including the review GitHub normalizer and established process CLIs.

### Changed

- Governance now owns its package-process implementations and depends only on
  policy plus TypeScript for source-aware gates. The former standalone package
  names are compatibility packages with documented migration paths.

## [0.1.1] - 2026-08-11

### Fixed

- Depend on the publishable `@vespeneventures/release@^0.1.1` closure so an
  isolated consumer can install the governance package.

## [0.1.0] - 2026-08-11

### Added

- A declarative, complete package lifecycle registry with explicit
  deprecation replacements.
- Read-only workspace and package-preflight orchestration over the existing
  catalog, gates, and release packages.
- A deterministic no-write package starter plan. A complete profile is now
  caller-owned and must supply real metadata, tooling, license text, and a
  dated changelog entry; unprofiled plans are private starters, never claimed
  to be publishable.
- Compact CLI reports with JSON and verbose output modes, plus explicit
  lifecycle-file and workspace-root input errors.
- Deprecated-package evidence requirements: either a replacement package and
  semver range or a terminal no-successor reason, plus a date, decision
  reference, and migration reference.
- A shared preflight scope forwarded consistently to both release and
  governance checks.
