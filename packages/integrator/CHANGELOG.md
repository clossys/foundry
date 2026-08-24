# Changelog

All notable changes to `@vespeneventures/integrator` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-08-24

### Fixed

- Repointed the README's injected-port guidance from retired Provisioning to
  active Builder.

## [0.6.0] - 2026-08-22

### Changed

- **A registry `404` from a working credential is now `indeterminate`, not
  `unreachable`.** `ReachabilityVerdict` gained a fourth arm,
  `{ kind: "indeterminate", reason: ReachabilityIndeterminateReason }`, and
  `resolveReachability` returns it where it previously returned
  `{ kind: "unreachable" }` for a `not-found` alongside at least one `known`
  lookup.

  `unreachable` means the registry could not be reached. In this case it was
  reached and it answered. The module's own comment already called the case
  "genuinely undecidable" — the defect was that the vocabulary had no word for
  undecidable, so the nearest neighbour was borrowed, and a caller could no
  longer distinguish a transport failure from a definitive answer. A caller
  acting on `unreachable` waits and retries; for a name that is deliberately
  retired the retry never succeeds, so the correct response (drop the stale
  entitlement) was indistinguishable from the wrong one.

  The all-`404` case is unchanged and still resolves to `unauthenticated`: a
  blind credential explains an entire batch of misses better than an entire
  entitled slice never having been published.

  Deliberately **not** a verdict asserting the name is absent. GitHub Packages
  access control is per package, so a credential can legitimately read some
  names and `404` on one it has no grant for — "never published",
  "deliberately retired" and "not visible to this credential" remain
  indistinguishable from the transport layer alone. Resolving that ambiguity
  needs the lifecycle contract, which belongs to the caller.

- **`judgeCurrency` reports the same case as
  `{ state: "indeterminate", reason: "registry-name-not-found" }`**, a new
  member of `CurrencyIndeterminateReason`, rather than
  `{ state: "unreachable" }`.

### Migration

A caller exhaustively switching on `ReachabilityVerdict["kind"]` or
`CurrencyIndeterminateReason` gains one arm each. Callers testing
`verdict.kind !== "known"` — the shape `checkAdmission` uses — need no change
and stay fail-closed.

## [0.5.0] - 2026-08-21

### Added

- **`readInstalledInventoryReport(fs, options)`, a pnpm-aware, never-throwing
  sibling to `readInstalledInventory` (issue #330).** `readInstalledInventory`
  reads only an npm-shaped `package-lock.json`, so a pnpm-based consumer
  repository had no way to build an `InstalledInventory` from this package at
  all — it had to hand-write its own roughly sixty-line reader against
  `pnpm-lock.yaml` instead, with everything downstream (`judgeCurrency`,
  `upgradeSet`, `optOutGaps`, `computeCurrencyMetric`) working unmodified for
  that consumer. The new function reads either lockfile format: the caller
  supplies both candidate lockfile paths, and it reports which one it
  actually found (`lockfileFormat: "npm" | "pnpm"`), never assuming or being
  told. It never throws — every failure mode is folded into an explicit
  `{ kind: "indeterminate", reason, detail? }` result, following
  `detectSupersession`'s own documented discipline (`src/supersession.ts`'s
  header) rather than escaping as a thrown error or, worse, silently
  reporting an empty "nothing installed" inventory: a lockfile that is
  PRESENT but fails to parse in its own format is `"lockfile-invalid"`,
  never the same silence as a genuinely absent lockfile
  (`"lockfile-not-found"`) — collapsing those two facts into one is exactly
  the ambiguity this issue exists to remove. Both lockfiles present at once
  is its own reported state too (`"ambiguous-lockfile-format"`), never a
  silent pick of one over the other.
  `readInstalledInventory` itself is UNCHANGED — still npm-only, still
  throws — this is a deliberately additive, separate entry point.
- **`pnpm-lock.yaml` support (`src/pnpm-lockfile.ts`) is a small internal
  parser, not a new runtime dependency.** This package declares no runtime
  dependencies, deliberately, and a full YAML parser is far more than this
  reader needs: it reads exactly one shape, the current `importers`-based
  lockfile's root (`"."`) importer `dependencies` / `devDependencies` /
  `optionalDependencies` blocks, and nothing else in the document (in
  particular, never the `packages:` block, which uses flow-style YAML this
  parser does not support and does not need to). See that module's own doc
  comment for the exact supported subset and its limits. This is a decision
  worth a second look — see this package's own README ("Installed-inventory
  reader") and the pull request that introduced this entry for the full
  reasoning.

## [0.4.1] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.4.0] - 2026-08-20

### Added

- **`foldCurrencyDelta(input)`, in a new `currency-fold.ts` module** — one
  fold, two scopes, fixing a real fleet-wide bug: every consumer wiring
  `currencyVerdict` into a pull-request gate was grading that pull request's
  ABSOLUTE currency, so a pull request touching no dependency at all could be
  (and was) blocked by drift an earlier, unrelated change had already
  introduced — observed the same day on a release-workflow change and a
  security fix, each blocked by several unrelated major-version drifts
  neither one touched. Worse, a registry's `latest` dist-tag moves during the
  workday, so the absolute verdict a pull request was graded against was
  never even a fixed target.
  - `scope: "absolute"` is `currencyVerdict`'s existing semantics,
    generalized: any `behind` whose `severity` is in a caller-supplied
    `blockingSeverities` set is a violation, rather than `"major"` being
    hardcoded. For a trunk or scheduled run, where there is no "before" to
    compare against.
  - `scope: "introduced"` grades only what a change made worse, against a
    `baseline` — a second `PackageCurrency[]` snapshot from the merge base.
    For a pull-request run. Reports `introduced` (this change's own doing,
    blocking) separately from `inherited` (pre-existing drift, reported so a
    pull request can still see the fleet's drift, but never blocking on it —
    an untouched dependency whose `latestVersion` moved on its own during the
    workday is `inherited`, never `introduced`; an upgrade that still leaves
    the package behind is `inherited` too, because partial progress must
    never be punished the same as a regression).
  - **The rule this fold is uncompromising about:** a `baseline` the caller
    could not read — omitted outright, or passed as an explicit
    `{ kind: "unreadable", reason }` marker for a shallow clone with no
    merge-base commit, say — is `indeterminate`, naming the reason. It is
    never folded into "nothing was introduced" (failing OPEN, inverting
    `classifyCurrencyDistance`'s own law that an ungradable input is its own
    `indeterminate` state) and never silently answered with `absolute`
    grading instead (which would quietly answer a different question under
    the `introduced` name, reintroducing this exact bug inside its own fix).
  - `indeterminate` / `unreachable` / `unauthenticated`, on either the
    current run or the relevant baseline entry, make the whole fold
    `indeterminate` — the same "not judged, not judged-and-clean" precedence
    `currencyVerdict` already applies, one level removed.
  - `currencyFoldResultToExitCode`, the same fold-to-exit-code convention
    `currencyVerdictToExitCode` and `supersessionResultToExitCode` already
    establish.
  - New file, not a change to `currency.ts` — `classifyCurrencyDistance` and
    `judgeCurrency` still own grading; this module owns exactly the one
    question they don't answer: grading a set of judgments against another
    set of judgments.

## [0.3.0] - 2026-08-19

### Added

- **`detectSupersession(manifest, supersessionMap)`** — a pure, hermetic
  detector for a manifest that holds both a package published from this
  repository and a name that package supersedes. No version conflict makes
  this loud on its own: the names differ, so a lockfile resolves both
  happily, and two visual systems, two auth surfaces, or two copies of the
  same contract end up installed side by side with nothing to catch it.
  Ships no map and no consumer package names, exactly as this package's
  blindness rule requires everywhere else — `SupersessionMap` is entirely
  caller-supplied, the same way `EntitlementDeclaration` and
  `AdmissionContract` are. Scans every dependency position —
  `dependencies`, `devDependencies`, `peerDependencies`,
  `optionalDependencies`, and npm's `overrides` / yarn's `resolutions`
  blocks, recursively where either can nest a name — so a superseding
  package declared in one position and the superseded name pinned only in
  another is still reported. Every comparison is exact string equality
  against a validated package name, never a substring test: a superseded
  `foo` never matches an installed `foo-utils`, and a scoped name never
  cross-matches its unscoped-looking counterpart. Reports `satisfied` /
  `violated` / `indeterminate`, the fold this fleet's gates already share
  (see `currencyVerdict`) — a manifest or map this function cannot trust is
  always `indeterminate` with a named reason, never silently `satisfied`
  and never a silently empty pair count. `violated` names every confirmed
  pair, never stopping at the first, and carries an explicit `count` — the
  falling count over time is the artifact this gate is built to make
  visible.
- **`integrator-supersession-check`**, this package's first shipped CLI —
  reads a manifest and a private supersession-map file, runs
  `detectSupersession`, and prints the report. **Report-only by default**:
  without `--block` it always exits `0`, so a plane can wire it into CI and
  watch the count fall before it ever blocks a merge. `--block` enforces
  the real `0` / `1` / `2` result.
- `supersessionResultToExitCode`, the same fold-to-exit-code convention
  `currencyVerdictToExitCode` already established.

## [0.2.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/vespeneventures/foundry/issues/273). No runtime behavior changed.

## [0.2.1]

### Fixed

- `currencyVerdict` now folds `absent-without-reason` to `violated` rather than
  `indeterminate`. Nothing about an unexplained absence is unexamined: the
  package is entitled, it is not installed, and no opt-out records a decision to
  leave it out. That is a complete evaluation reaching a negative answer, and
  reporting it as indeterminate demoted a settled violation into "could not
  tell". Because indeterminate outranks violated in the fold, it could also mask
  a genuine major gap appearing alongside it. `unreachable`, `unauthenticated`
  and `indeterminate` are unchanged — those are the states where something
  genuinely could not be determined.

## [0.2.0] - Unreleased

### Added

- **Breaking: `judgeCurrency`'s `behind` state is now graded by semver distance
  instead of being one undifferentiated "drift" finding.** `behind` carries
  a new `severity: "patch" | "minor" | "major"`, computed by the new
  `classifyCurrencyDistance(installedVersion, latestVersion)`: a patch gap
  is `"patch"`, a minor gap is `"minor"`, a major gap is `"major"` — and a
  pre-1.0 (`0.y.z`) minor gap also grades `"major"`, since semver explicitly
  permits a `0.y` minor bump to break. `upgradeSet`'s entries carry the same
  `severity`. A version this package cannot safely grade at all —
  unparseable, or carrying a prerelease identifier on either side — is a new
  `indeterminate` state (`PackageCurrency` now has seven states, not six),
  with a machine-readable `reason` (`"version-unparseable"` or
  `"version-not-comparable"`); it is never folded into `current` or
  `behind`. This closes the gap a consuming plane previously had no choice
  but to hand-roll its own version of: uniformly treating every currency
  finding as equally blocking trains a consumer to read a currency gate's
  red as "go bump something" rather than "something is wrong," and buries
  the one distance semver actually promises may break (major, including
  pre-1.0 minor) under the noise of routine patches. This package grades;
  it does not decide policy — folding `severity` into a pass/fail gate
  contract remains the caller's own decision, same as always.

### Documentation

- **README states a consuming plane's currency-gate loop-close condition
  (issue #286's acceptance criterion), and honestly discloses issue #330 —
  the pnpm-lockfile reading gap — as an open loop item rather than glossing
  over it.** Closes when the gate reports green only by currency or by
  recorded opt-out, never by silence; reopens on any drift a gate now
  catches that a consumer previously had to write its own evaluation logic
  to find. No code change.

## [0.1.0] - 2026-08-18

### Added

- `loadEntitlementDeclaration` for offline validation of what catalogue a
  plane is entitled to, and its per-package opt-outs. Every opt-out requires a
  non-empty `reason` — an opt-out with none is rejected outright, since a
  recorded reason is what turns an absence into a decision instead of drift.
- `readInstalledInventory` and `createNodeInventoryFileSystem` for reading a
  plane's own manifest and lockfile through an injected `InventoryFileSystemPort`,
  following `@vespeneventures/provisioning`'s injected-port pattern. Reports
  only what actually resolves in the lockfile, not merely what is declared.
- `probeReachability` and `resolveReachability` for a registry reachability
  probe over an injected `Transport`. Resolves the `unreachable` vs
  `unauthenticated` ambiguity a single `404` cannot answer by itself, using
  the same aggregate-batch reasoning as this repository's own
  `scripts/check-package-visibility.mjs`: if nothing in a probed batch comes
  back known, a blind credential explains every `404` in it better than an
  entire entitled catalogue slice having never been published.
- `judgeCurrency` for the version reconciler: combines entitlement, installed
  inventory, and reachability into `PackageCurrency[]`, a discriminated union
  enforcing exactly the six required states — `current`, `behind`,
  `absent-with-reason`, `absent-without-reason`, `unreachable`,
  `unauthenticated` — so that a narrower or malformed result cannot
  type-check.
- `upgradeSet` and `optOutGaps` for the loop's act step: the upgrade set and
  the entitled-absent-unexplained gaps.
- `computeCurrencyMetric` for this package's stated metric: the share of
  entitled packages installed and at the latest published version, plus,
  reported separately, the count entitled-and-absent with no recorded
  opt-out.
- `loadAdmissionContract` and `evaluateAdmission` for the admission contract:
  `must-be-entitled`, `must-not-be-opted-out`, `requires-known-reachability`,
  and `minimum-version` rules, composed entirely from data this package
  already models rather than a new external source.
- `parseVersion` and `compareVersions`, a minimal dependency-free semantic
  version parser and comparator.
- `IntegratorValidationError` with a stable `IntegratorErrorCode`, thrown by
  every offline validator in this package.

[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/integrator-v0.1.0
