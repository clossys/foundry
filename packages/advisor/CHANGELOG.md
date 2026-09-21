# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.8] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).
- `AdvisorAssessment.sponsorSummary` — a derived, founder-facing one-line summary
  from the assessment `state` (`satisfied`, `violated`, or `indeterminate`).
  Callers cannot supply it.
- Sponsor question cards as data: `nextSponsorQuestion()` returns one card at a
  time for the first unknown fit criterion, then the first unknown readiness
  criterion; `applySponsorChoice()` maps a stable choice id to fit or readiness
  state, or signals `something-else` / `unknown-choice`. Exported types:
  `SponsorQuestionCard`, `SponsorQuestionChoice`, `SponsorChoiceApplyResult`,
  and `SponsorQuestionInput`.

## [0.2.7] - 2026-09-19

### Added

- Ships the `clossys-advisor` Agent Skill (`skill/SKILL.md`) next to the
  existing assessment bins `advisor-check` and `advisor-execution-readiness`.
  In Cursor, mention `@clossys-advisor` to invoke that receptionist voice.
  The skill is packed with the package; it does not add runtime exports and
  does not replace the assessment CLIs.

## [0.2.6] - 2026-09-19

### Changed

- Tightened the placement-evidence join. A `HubPlacementCell` may now carry two
  optional fields (schemaVersion 1, additive): `expectedVersion`, an exact
  semver the fix must land, and `expectedPlacement`, the `dependencies` or
  `devDependencies` bucket the pin must land in. A covering install work item
  that does not declare that exact version — a same-version reinstall of a
  stale pin, for example — or that places the package in the other bucket no
  longer closes the cell; it stays open with a `placement-cell-coverage`
  finding. Pre-work covering a cell must now also name the cell's package
  through a new optional `PreWorkItem.packageName` field, so unrelated
  pre-work never closes a cell. Existing cells without the new fields join
  exactly as before.

## [0.2.5] - 2026-09-19

### Changed

- Patch version bump only, to obtain a fresh
  `governance/release-qualifications/` record path. The 0.2.4 record was
  introduced in a commit that also changed an unrelated test file; the
  single-introduction-commit invariant refuses that shape, so 0.2.4 cannot
  be published. No functional change from 0.2.4.

## [0.2.4] - 2026-09-19

### Added

- First-wave work items accept optional `act`: `install` (default), `remove`,
  or `relocate`. Pre-work kinds include `remove` and `relocate`, so taking a
  package off a hub or moving it is typed work rather than free-text.
- Optional caller-supplied `placementEvidence` (`schemaVersion` 1) of missing,
  stale, wrong-wiring, over-install, and hub-versus-product cells. Validation
  joins each cell to a matching first-wave act or to `prerequisite` / `remove`
  / `relocate` pre-work. This package still has no filesystem or GitHub I/O;
  a connector fills the JSON from hub-tree observations.

## [0.2.3] - 2026-09-17

### Added

- Declared `foundry.assessment` against the mapped `advisor-check` bin with
  `invocation: "single-json-input"`, so controller onboarding discovers this
  role's first-day assessment surface from the installed manifest instead of
  inferring one.
- Stated the close condition in the README, matching the charter: independent
  consumer evidence shows the owned metric,
  `engagement-decision-currency-rate` as computed by
  `assessEngagementDecisionCurrency()`, meets its setpoint over the declared
  review cadence. This does not claim the position is closed.

## [0.2.2] - 2026-09-16

### Fixed

- A contradicted fit signal collapsed straight to a `violated` verdict with
  no finding naming which criterion was contradicted. `advisor-check` on a
  schema-valid input with one contradicted fit signal returned `state:
  violated`, `firstWavePlan.state: not-recommended`, and an empty
  `findings` array — a sponsor received a blocking "not recommended"
  result with no stated reason. The weaker `unknown` state already emitted
  a named `sponsor-question` finding; `contradicted`, the only other
  negative `SignalState`, emitted nothing. `assessAdvisorEngagement()` now
  emits one `fit-contradicted` finding per contradicted `fitSignals.<id>`,
  naming the criterion, mirroring the shape `sponsor-question` already uses
  for `unknown`.
- Deleted a hand-copied, silently driftable duplicate of `BASIS_FIELDS` (and
  its `equalBasis` helper) from `currency.ts`; it now imports `BASIS_FIELDS`
  and `sameBasis` from `authorization.ts`, the single source this package's
  own README already tells consumers to reuse instead of hand-copying.
  Deleting a field from the private copy previously left every test and gate
  green while `assessEngagementDecisionCurrency()` silently stopped
  comparing that field. `assessment.ts`'s inline basis-digest field list is
  likewise replaced with the exported `BASIS_DIGEST_FIELDS`.
- Documented installation in the README: the public npm registry
  (`https://registry.npmjs.org`) and that no authentication is required.
  Previously the README had no install instructions at all.

## [0.2.1] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `advisor-check` and `advisor-execution-readiness` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.2.0] - 2026-09-02

### Added

- Export `BASIS_FIELDS` and `BASIS_DIGEST_FIELDS`, the exact field lists an `AssessmentBasis` is built from, so a caller deriving its own current basis from source material can stay bound to this package's own contract instead of a hand-copied field list.
- Export `sameBasis()`, `sameStrings()`, and `packageKey()` — the exact comparison primitives `validateExecutionAuthorization()` is built from — so a caller independently verifying an authorization, a basis, or a package set against its own retained evidence can reuse them instead of re-implementing content-addressed comparison.

## [0.1.6] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.5] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.4] - 2026-08-30

### Changed

- Cut a bounded forward patch from unchanged runtime and API source so the
  exact package can be qualified for npm trusted publishing and provenance.

## [0.1.3] - 2026-08-27

### Added

- Add `advisor-execution-readiness`, which re-derives execution readiness at a
  runner-supplied instant and requires exact current authorization before it
  returns ready.

## [0.1.2] - 2026-08-25

### Fixed

- Require every unknown readiness criterion to have matching, owned
  `indeterminate` pre-work; retain the exact `violated` to `unresolved`
  requirement and reject either status mismatch.
- Compare delivery and independent-outcome owner references case-insensitively
  before accepting independent outcome measurement.

## [0.1.1] - 2026-08-24

### Fixed

- Validate a retained execution authorization during recurring assessment and
  command-line evaluation using the same exact-plan, freshness, sponsor, and
  scope contract used for session approval.

## [0.1.0] - 2026-08-24

### Added

- Provider-neutral sponsor fit, readiness, initiative-overlap, and pre-work assessment engine.
- First-wave plans that gate installation on evidenced baseline and conflict clearance.
- Pure session state machine and connector-facing tool contracts and handlers.
- `advisor-check` for JSON assessment reports with three-state exit semantics.
