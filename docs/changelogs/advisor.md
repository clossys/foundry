# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.0 - 2026-09-24

- `EngagementBrief` gains an optional `context` snapshot of the engagement context, `toEngagementBrief()` accepts it, and the new `contextFromBrief()` reads it back as a copy with one entry per field, treating an absent snapshot or a missing field as unknown. This is how a role running in a product repository reads what the founder already answered. Because the brief is committed in every staffed repository, `toEngagementBrief()` writes one entry per field id and throws on a duplicate field id or on a known field whose value is not one of that field's fixed choice ids, so founder text, slugified or not, never enters it. Because `clossys/brief.json` is committed JSON a person can hand-edit, `contextFromBrief()` applies that same check on read: an entry with an invalid or missing value, extra keys, a duplicated id, or a non-array `fields` reads as unknown instead of being trusted or throwing.
- The capability catalogue now reads `needs`, `solves`, `feeds` and `fit` in
exactly the shape the package-framework contract defines. A `solves` entry
carries `statement` and an optional `capability`, and its `evidence` may be
`designed`, `qualified` or `proven`. A `needs` edge carries the declared
`producerRole` (a scoped package name). Each role exposes its own
`declaredFeeds` verbatim and in declared order, and its declared
`capabilities` (id, inputs, outputs). `feeds` now lists only the producer's
side of met needs. `fit` lists the signal ids from the declared fit-signal
file. New exported types: `CapabilityInput`, `DeclaredCapability` and
`DeclaredFeed`. `CapabilitySolves.statement` and
`RoleCapability.declaredFeeds` are new required fields. A declared need now
counts as met only when its producer declares a `feeds` entry for that
artifact, which is the framework gate's rule, so a declared need its
producer does not feed is now unmet. `needIsMet` is exported. An unmet need
is reported in `unsatisfiedNeeds`, and its producer is still pulled in.
- The packed capability catalogue now carries the `needs` and `solves` that
Customer, Writer, Designer, Publisher, and Strategist declare in their own
manifests. Before, it used the fallbacks it derives when those fields are
absent. Each of the five had a `solves` entry that restated the role's job
question and cited no proof case. Publisher's edges came from its package
dependencies and the first-wave order. The launch kit now composes from the
declared edges, and each declared `solves` entry names its own proof case
and capability. All five are at `designed` evidence.
- `composeKit` now judges needs cycles per capability, following the
contract's cycle decision, and `judgeNeedsCycles` is exported. A cycle among
capabilities is a deadlock and stays `indeterminate`. A role-level loop with
no capability cycle behind it, such as the Customer/Publisher keep loop,
now composes, and its new `roleCycles` field lists the loop. A cycle the
capability graph cannot account for now composes too, and the new
`unjudgedCycle` field names it. That covers a cycle only visible through a
role with no capability map, and a role loop closed by an inferred fallback
need that names no capability; before this change, that last case was
`indeterminate`. `composeKitFromProblems` passes both fields through. So
does `recommendKit`: a `KitVerdict` now has `roleCycles` and
`unjudgedCycle`, and the skill tells the client about an unjudged cycle. A
verdict's citation `statement` is now the role's own `solves` statement.
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).

## [0.4.1] - 2026-09-23

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.2.8
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version. Renumbered repeatedly as main moved ahead during this restack's
  disk-incident hold (0.2.9 -> 0.4.1): main independently shipped advisor
  wave 2 (STATUS renderer, kit verdicts, managed engagements, budget
  preference) as 0.4.0, ahead of this test-only bump (version-collision
  rule, issue #1187).

## [0.4.0] - 2026-09-22

### Added

- `renderAdvisorStatus()`, `validateAdvisorPlan()`, and the
  `advisor-render-status` CLI: a pure renderer (plus its validator) for
  the STATUS document at `clossys/advisor/STATUS` (a `.md` file), with
  five fixed sections (Mandate, Where we are, Recommended next,
  Decisions, Blockers), from an `AdvisorPlan` record. Structured so
  Controller's loop engine (#1195) can take over rendering later
  without a vocabulary change (issue #1175). `AdvisorPlanBlocker` is
  field-for-field the same shape as Controller's own `Blocker`
  (`capabilityId`, `kind`, `owner`, `nextAction: { who, how, byWhen }`,
  `since`) per the owner direction on #1187 (2026-09-23) against local
  copies of shared definitions (issue #1237).
- `recommendKit()`: per-kit verdicts on the composed kit from #1176 —
  each role's why, confirmed-problem citations, goal, handoffs, and
  deliverable — attributing the verdict to a matching curated preset
  when one's own closure equals the composition (issue #1177).
- `EngagementMode`, `validateManagedEngagement()`, and
  `proposalReadyForClient()`: self-serve and managed as grant shapes on
  the same engine, with the operator-review hook that holds a proposed
  kit back from the client in managed mode until the engaged operator
  approves it (issue #1044).
- `nextStepInstruction()`: host-specific phrasing for opening the next
  repository and calling the next role, for Claude Code, Cursor, and a
  generic fallback (issue #1180, Advisor side).
- `BUDGET_PREFERENCE_CARD`, `applyBudgetPreferenceChoice()`, and
  `toPreferencesFile()`: the one-question budget-preference card and its
  `clossys/preferences.json` shape, using the fixed tier names from
  #1219. Advisor names no model anywhere (issue #1219, Advisor side).

## [0.3.0] - 2026-09-22

### Added

- Generated capability catalogue (issue #1176): `CAPABILITY_CATALOGUE` and
  `kitCatalogueDigest`, packed at build time (mirroring the launcher's own
  skill-catalogue packer) from this repository's role-loop archetypes, each
  package's own `foundry` manifest fields, and — while no package yet
  declares them (issue #1172 is in progress) — a documented fallback over
  first-party runtime dependencies and this repository's committed
  non-runtime closed-loop order. Connectors may bind `kitCatalogueDigest`
  into `AssessmentBasis.catalogDigest`.
- `composeKit()`: pure closure-and-ordering composition over the
  catalogue's `needs`/`feeds` graph. An unknown role or a needs cycle
  reports `indeterminate`, never a guess.
- `CLIENT_PROBLEMS` (issue #1176): a vocabulary of client problems the
  client confirms — they never pick a package.
  `nextProblemQuestion()`/`applyProblemChoice()` offer one problem card at
  a time, reusing the same card pattern as every other question here.
- `composeKitFromProblems()`: deterministically maps confirmed problems to
  roles via each role's own `solves[].problem`. Guardrails: exactly one
  confirmed problem must be `primary`; a composed role count over
  `FIRST_ENGAGEMENT_ROLE_CAP` (5) requires a stated `overCapReason` or
  comes back `"over-cap"` instead of silently over-staffing a first
  engagement.
- `validateKitProposal()`: checks a skill-proposed kit against what
  `composeKitFromProblems()` itself would justify from the same confirmed
  problems — every role must trace to a confirmed problem it solves, or to
  a role that needs it; an unlinked role is reported as a removal
  candidate, never silently kept.
- `KIT_PRESETS` (issue #1176): curated starting compositions (Launch, Grow,
  Ship Safely, Operate at Scale, Customer Ops) — fallbacks and
  best-sellers Advisor can offer, never an exhaustive partition of the
  package catalogue.
- `EVIDENCE_LEVELS`, `evidenceAtLeast()`, `presetEvidenceFindings()`: the
  `designed`/`qualified`/`proven` evidence tiers behind every `solves`
  claim. Every current claim is `designed` (a documented placeholder)
  until issue #1172 lands real evidence for a role.
- `toEngagementBrief()` (issue #1176): the kit output shape — problem,
  staffed roles with why and goals, handoff sequence, and deliverables
  grounded in each role's own `boundary.owns`. Type-and-schema only in this
  release; writing it to a repository's brief file is wave 2 (issues
  #1175, #1178).
- Shared engagement context (issue #1173): `EngagementContext` types, and
  `nextContextQuestion()`/`applyContextChoice()`, extending the existing
  `nextSponsorQuestion()`/`applySponsorChoice()` card pattern to capture
  business, product, audience, stage, intent, and constraints once. An
  unanswered field stays `unknown`; only questions a non-technical founder
  can answer are asked here — technical facts come from reading the
  repository. The duplicate-question gate against role intakes needs issue
  #1172's intake declarations, which do not exist yet, and is
  intentionally left out of this release.
- This repository's own offering-kits gate (issue #1176): every preset
  names only real, current role packages, every `addOnTo` resolves to a
  real preset id, and every preset composes cleanly against the generated
  catalogue.

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
