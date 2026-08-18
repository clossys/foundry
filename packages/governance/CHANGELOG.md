# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.0] - 2026-08-17

### Changed

- **`foundry-check` now exits `2` when it could not evaluate the tree
  (behavioural, affects any CI job reading its exit code).** The CLI's exit
  code is no longer picked by hand from a findings count — `main` builds a
  `GateResult` via the new `foundationGateResult` and projects it through
  `gateResultToExitCode`, so the ternary and the exit code can no longer
  drift apart. Retrofitting it exposed the defect it was meant to catch:
  the run printed a loud `!!! COVERAGE INCOMPLETE ... this report does NOT
  verify a clean tree !!!` banner and then returned `0`, because every
  `unusable` skip (`packages-dir-missing`, `unparseable-manifest`,
  `manifest-not-object`, `manifest-missing-name-or-version`) is
  warning-severity and the exit code was computed from error-severity
  findings alone. A banner is read by a human; an exit code is what CI
  consumes. Three changes follow:
  - Incomplete coverage (`report.complete === false`, any skip at all)
    is now `indeterminate` — reason `"incomplete-coverage"` — and exits
    `2` instead of `0`.
  - A tree read completely but containing **no packages** now exits `2`
    with reason `"no-packages-catalogued"` instead of reporting a pass
    with nothing evaluated behind it.
  - An `unreadable` skip, which was error-severity and therefore exited
    `1`, now exits `2`: it is "could not evaluate", not "evaluated and
    found a violation".

  Nothing that failed before passes now — every reclassification moves
  toward the stricter code, and finding severities themselves are
  unchanged. A consumer running `foundry-check` against a repository with
  no `packages/` directory, or an empty one, previously saw a green check
  that had verified nothing and will now see a red one; that is the fix,
  not a regression.

- **`RatchetResult` carries the shared ternary and names its indeterminate
  cause (additive).** Every member gains `verdict` (`"satisfied"` /
  `"violated"` / `"indeterminate"`), assigned alongside `status` so the two
  cannot disagree; `status`, `ok`, `improved`, and `findings` are unchanged
  and the contract is still written in terms of `status`. The `invalid`
  member additionally gains a required `reason` drawn from a declared
  vocabulary (`RatchetIndeterminateReason`): `"ratchet-current-invalid"`,
  `"ratchet-baseline-missing"`, or `"ratchet-baseline-invalid"`. These are
  three different operator actions — fix the counter, create the baseline,
  repair the baseline — that `gateResultFromRatchet` previously flattened
  into one opaque `"ratchet-invalid-input"`; that value is retained as the
  fallback for a hand-built ratchet-shaped value carrying no `reason`, so
  an existing structural caller is unaffected. Any caller asserting on the
  whole result object with a deep equality will see the new fields.

### Added

- `foundationGateResult`, `FOUNDRY_CHECK_REASONS`, and
  `FoundryCheckIndeterminateReason` exported from `./gates` — the pure fold
  from a `FoundationReport` to a `GateResult`, unit-testable without
  spawning the CLI, plus the finite vocabulary of reasons `foundry-check`
  may report as indeterminate.
- `RatchetIndeterminateReason` exported from `./gates`.

### Fixed

- `result.ts`'s own header claimed `@vespeneventures/strategy`'s
  `checkFactsTraceability` maintained an `unchecked` list alongside
  `@vespeneventures/ui` and `@vespeneventures/copy`. It does not, and never
  has — `FactsGateResult` has no such field. `strategy-facts-check` does
  implement the ternary correctly by other means (an unloadable `facts.json`
  and a zero-file scan both exit `2`). The header now says so rather than
  citing a third list that does not exist.

## [0.14.0] - 2026-08-16

### Added

- **`./gates` gate-result ternary.** New, additive exports —
  `GateResult`/`GateVerdict`, `gateSatisfied`/`gateViolated`/
  `gateIndeterminate`, `createGateReasons`, `foldGateResults`,
  `gateResultToExitCode`, `assertNeverVacuouslySatisfied`, and
  `gateResultFromRatchet` — naming the three-state contract (`satisfied` /
  `violated` / `indeterminate`) that `foundry-check`'s own CLI exit codes,
  `evaluateRatchet`'s `status`, and the `unchecked` lists in
  `@vespeneventures/ui`/`copy`/`strategy` had each already independently
  reinvented. `gateSatisfied` refuses to construct a passing result unless
  at least one input was actually evaluated — the mechanical form of the
  meta-check that motivated this: a gate whose implementation can return a
  passing result on a code path that performed no evaluation is itself a
  defect. No existing export's return type changed; retrofitting an
  existing gate onto this shared type directly (rather than being
  convertible to/from it, as `gateResultFromRatchet` demonstrates for
  `evaluateRatchet`) is left for its own follow-up.

## [0.13.0] - 2026-08-15

### Changed

- **`./review` schema bumped to version 3 (breaking).** `REVIEW_EVIDENCE_VERSION`
  is now `3`; a version-1 or version-2 bundle is rejected outright with a
  `"schema-version"` finding naming the problem, never coerced or silently
  upgraded. `ReviewRecord` gains a required `instanceId` (non-empty string,
  `"review-instance-id"` finding rule) and a required `depth: ReviewDepth`
  (`"primary" | "secondary" | "secondary-incomplete"`, `"review-depth"`
  finding rule). Fixes two defects found by operating the system: (1)
  `validateReviews` grouped decisive state by `reviewerId` and applied
  latest-wins across it, which is correct for one reviewer revising their own
  decision but silently collapsed two genuinely independent review sessions
  into one whenever they shared a `reviewerId` (an identity-agnostic
  consuming model can emit the same login for every audit it runs, and
  `provider` does not disambiguate either — both independent reviews can
  record the same provider). Latest-wins now applies per `instanceId`
  instead: an account-owned, caller-assigned identifier unique per review
  session. (2) A record could report a decisive, clean `state` while its
  reviewing party correctly could not complete a policy-demanded secondary
  pass, and the consuming gate read only `state` — passing anyway. `depth`
  makes that fact structurally visible: only an instance whose *latest*
  decisive record is both `depth: "secondary"` and a clean state can ever
  satisfy `ReviewPolicy.requireSecondaryReview` (new, required, no default,
  same discipline as `requireApproval`/`decisionUse`); a
  `"secondary-incomplete"` record never silently upgrades itself.
  `requireSecondaryReview: true` combined with `decisionUse: "advisory"` is
  rejected as an `"advisory-secondary-conflict"` finding, the same way
  `requireApproval: true` already is. `./review/github`'s
  `normalizeGitHubReviewEvidence` reads `instanceId` and `depth` only from
  what the caller already attached to a review node (GitHub has no native
  concept of either) — never inferred, same discipline as `provider`.

### Added

- **`ReviewEvidenceBundle.patchId`** (optional string) — a caller-supplied
  identity for the change itself (the diff, not the commit), stable across a
  base-only advance the way `headSha` is not. Fixes a third defect: evidence
  binds to an exact `headSha`, so a consumer whose branch-protection requires
  branches be current before merging voids a clean, unchanged-diff audit
  every time a queued PR merges ahead of it — observed three times in one
  day, and quadratic in the size of a merge queue. Git's `patch-id` is the
  established analogue; this package never computes one (that requires
  reading a repository) and never constrains `patchId` to `headSha`/`baseSha`'s
  40-lowercase-hex shape, since assuming one scheme's output format would
  assume every caller uses that scheme. `./review/github` reads it only from
  a caller-attached `pullRequest.patchId` (GitHub exposes no such field) and
  omits the key entirely when absent, rather than normalizing to an empty
  string, since `patchId` is genuinely optional.
- **`isRevalidatableReviewEvidence(evidence, currentPatchId)`** — a pure,
  separately exported predicate (not a `validateReviewEvidence` finding rule
  or parameter) answering whether stale-by-head evidence remains usable: true
  only when `evidence.patchId` and `currentPatchId` are both non-empty and
  equal. It never mutates or re-derives evidence and never decides whether a
  caller should actually treat revalidated evidence as current for a merge —
  that remains the caller's own policy decision. Kept separate from
  `validateReviewEvidence` because every `headSha` comparison inside that
  function is a within-bundle consistency check (do this bundle's own
  checks/reviews/threads match its own `headSha`), never a comparison against
  some other, live head — that comparison already happens entirely on the
  caller's side, before evidence would ever be handed to
  `validateReviewEvidence` again, and revalidation is the same shape of
  external comparison.

## [0.12.0] - 2026-08-15

### Changed

- **`./review` schema bumped to version 2 (breaking).** `REVIEW_EVIDENCE_VERSION`
  is now `2`; a version-1 bundle is rejected outright with a `"schema-version"`
  finding naming the problem, never coerced or silently accepted.
  `ReviewEvidenceBundle` gains a required `baseSha` (40 lowercase hex,
  `"base-sha"` finding rule), so evidence is bound to the exact base commit a
  merge would target, not just the head. `ReviewRecord` gains a required
  `provider` (opaque, caller-supplied, `"review-provider"` finding rule) —
  which analyzer produced the record, with no vendor enum, allowlist, or
  notion of a "trusted" provider defined anywhere in this package.
  `./review/github`'s `normalizeGitHubReviewEvidence` now reads
  `pullRequest.baseRefOid` for `baseSha` and reads `provider` only from
  whatever the caller already attached to a review node — never inferred from
  `author.login` or any other GitHub-shaped field.
- **`ReviewPolicy` gains a required `decisionUse: "advisory" | "authoritative"`
  (breaking).** Whether `requireApproval` is merge-blocking clearance or an
  audit signal only. No default in either direction: an omitted or
  unsupported value is a `"decision-use"` finding, and
  `requireApproval: true` combined with `decisionUse: "advisory"` is rejected
  as an `"advisory-approval-conflict"` finding at policy-validation time,
  before any evidence is read.

### Added

- **`isReviewPolicyAdoptionState` / `isReviewPolicyCoverageState`** and their
  types `ReviewPolicyAdoptionState` (`"adopted" | "not-adopted" |
  "assessment-pending"`) / `ReviewPolicyCoverageState` (`"verified" |
  "not-verified" | "assessment-pending"`) — a shared, tri-state,
  structurally independent vocabulary for account-control repositories to
  declare, per repository, whether a review policy is adopted and whether
  real pull requests were actually reviewed under it. The two vocabularies
  are disjoint by construction (neither guard accepts the other's pass/fail
  values) so coverage can never be satisfied merely by declaring adoption.
  Foundry supplies the vocabulary and its validators only; the per-repository
  values are each consuming account's own data.

## [0.11.0] - 2026-08-14

### Added

- **Pure cross-plane composition** under `./composition` (#241). The new
  schema-v1 contract accepts only caller-owned requirement, policy,
  preference, explicit capability supply, operator decision, exception,
  timestamp, scope, value, and provenance data. `evaluateComposition` emits a
  canonical `effective`, `exception-mediated`, `conflicting`, `unknown`, or
  `invalid` result without discovery, I/O, implicit precedence, installation,
  provisioning, mutation, or clock reads.
- Strict hostile-input validation rejects unknown fields, accessors, polluted
  prototypes, behavior-shadowed or sparse arrays, duplicate identifiers and
  references, malformed provenance and timestamps, orphan evidence,
  cross-scope exceptions, and unsupported schema versions.
- The composition subpath preserves, but does not import, translate, or
  conflate, `./repository` profile-v2 requirements and profile-v3 exact-root
  semantics.

## [0.10.1] - 2026-08-14

### Fixed

- Restored the `./repository` no-I/O import boundary (#243). The importable
  repository CLI API no longer performs executable-main detection during
  module evaluation; an executable-only wrapper now invokes
  `repository-check`, including through npm-created bin symlinks. Repository
  profile v1, v2, and v3 validation and evaluation semantics are unchanged.

## [0.10.0] - 2026-08-14

### Added

- **Exact repository-root declarations and pure evaluation** under
  `./repository` (#238). Profile schema v3 adds caller-owned `rootEntries`;
  every direct-child name carries an explicit `canonical`, `extension`,
  `exception`, `compatibility-alias`, or `legacy-artifact` classification and
  a separate `required`, `allowed`, or `prohibited` disposition.
- `evaluateRepositoryRoot` and `validateRepositoryRootEvaluationInput` compare
  caller-normalized direct-child observations with that vocabulary. Missing
  required entries, observed prohibited entries, and every undeclared direct
  child fail closed. Malformed input returns no partial proof.
- New root-entry, evaluation, status, and finding types are exported from
  `@vespeneventures/governance/repository`. The API performs no filesystem
  discovery, alias resolution, retention decision, or mutation.

### Changed

- **Breaking for exhaustive type consumers:** `REPOSITORY_PROFILE_VERSION` is
  now `3`, and `RepositoryProfile` adds `RepositoryProfileV3` to its explicit
  union. Closed v1 and v2 profiles remain supported; v2 is identified by
  `PREVIOUS_REPOSITORY_PROFILE_VERSION` and cannot silently add root entries.
- Repository-root vocabulary remains in `./repository`; account-container
  discovery and multi-plane composition remain caller-owned, so no broad
  `./workspace` subpath was added.

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
