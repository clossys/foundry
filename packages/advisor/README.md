# @clossys/advisor

`@clossys/advisor` is a zero-runtime-dependency, provider-neutral engine for the human sponsor of a Foundry engagement. Its primary mode is **reconcile**; a consumer connector may use it to interact, and it assures only when supplied evidence justifies the result.

It does not register or launch any conversational product, obtain OAuth, access providers or repositories, install packages, clear authority blockers, or mutate customer state. Those operations remain consumer-owned integrations. The package is pure TypeScript: no network or filesystem I/O.

After a compatible hosted connector has been enabled in Claude, a nontechnical sponsor can paste the exported `SPONSOR_ENTRY_PROMPT` (replacing its URL placeholder). It explicitly covers both new onboarding and resuming a current engagement. Public source visibility does not enable that connector, authenticate the sponsor, or select a trusted release; the connector must do those jobs and pin this package and its offering catalogue immutably.

## Install

```bash
npm install @clossys/advisor
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installing it needs no authentication: no npm token, no `.npmrc` registry
override, and no GitHub credential of any kind.

## Fixed assessment standards

Fit and readiness are derived from the complete v1 criteria exported as `REQUIRED_FIT_CRITERIA` and `REQUIRED_READINESS_CRITERIA`; arbitrary one-item arrays cannot pass. An unknown criterion yields an explicit sponsor question. Organization category is evidence only, never a categorical fit decision.

Fit requires evidence for sponsor mandate, material need, operating compatibility, expected value versus burden, adoption capacity, and legal, ethical, and safety constraints. Readiness requires scope and repository inventory, read access, authority, initiative/mutation/dependency inventory, immutable artifact access, baseline, an independent outcome owner, and a rollback/review window.

## First-wave pre-work and exact plan binding

Every first-wave repository requires both baseline and conflict coverage. A pre-work item includes current evidence, impact, one accountable and due next action, escalation route, dependency/mutation surfaces, and—in the satisfied case—independent authority-owned clearance. Each unknown readiness criterion must have a matching owned `indeterminate` item; each violated criterion must have a matching owned `unresolved` item. Every derived initiative collision additionally requires an unresolved or indeterminate conflict item bound to the exact initiative pair through `initiativeOverlapIds`; a generic or already-satisfied conflict row cannot stand in for that work. Unresolved or indeterminate work cannot carry clearance and produces `stabilize-first` or `indeterminate`. Delivery and independent-outcome owners are compared case-insensitively, so a case-only spelling difference never manufactures independence.

Each first-wave work item binds an initiative and target repository to an exact package name, semver version, npm SHA-512 SRI value, invocation, placement, timestamped metric baseline, completion definition, independent outcome owner, evidence source, direction, setpoint, review window, mutation scope, and rollback procedure. Installation is never represented as a successful outcome on its own. Optional `act` is `install` (the default), `remove`, or `relocate`, so over-install and wrong placement are typed first-wave work rather than free-text pre-work. Matching `remove` and `relocate` pre-work kinds exist for the same defects when they are still blockers.

Optional `placementEvidence` is a caller-supplied `schemaVersion: 1` document of missing, stale, wrong-wiring, over-install, and hub-versus-product cells. A consumer connector fills it from hub-tree observations; this package does not read the tree, does not walk sister product repositories, and does not invent a new role. Each cell must be addressed by a matching first-wave act or by `prerequisite` (missing/stale), `remove` (over-install), or `relocate` (wrong-wiring and hub-versus-product) pre-work. Omitting the document leaves existing assessments valid.

Assessment bases require SHA-256 content-addressed references for snapshots, grants, catalog, plan, blockers, clearances, conflicts, baselines, and completion definitions, with explicit `assessedAt` and `freshUntil` times. The assessment's explicit `asOf` time must fall inside that window.

## Conflict reconciliation

Advisor reconciles caller-declared exclusive conflict keys across workstream, dependency, mutation, authority, schedule, and data/outcome metric dimensions. Sharing an ordinary repository or authority reference is not automatically treated as a collision; the caller must identify the exclusive key being contested. A fully described single initiative has a satisfied no-overlap result; zero active initiatives remains indeterminate.

## Sessions and authorization

Every nonterminal session has one valid accountable next action. There is no pause or HOLD parking state. Closure requires an explicit reason and evidence.

`ExecutionAuthorization` must bind the exact plan and assessment basis, an accountable sponsor reference, approved repository/package/mutation scope, and a valid expiry. `advanceAdvisorSession()` recomputes the assessment from the session's retained input and validates all of that before moving to `ready-for-execution`; a caller-supplied assessment result is never trusted as readiness. `validateExecutionAuthorization()` is the shared validator used by both session transitions and decision-currency measurement.

### Comparison primitives

A caller that independently verifies an authorization, an assessment basis, or a package set against its own retained evidence can reuse the exact primitives `validateExecutionAuthorization()` is built from, rather than re-implementing content-addressed comparison and drifting from this package's contract over a release:

- `BASIS_FIELDS` — every field an `AssessmentBasis` carries, in a stable order: its nine sha256 digest fields followed by `assessedAt` and `freshUntil`.
- `BASIS_DIGEST_FIELDS` — just the nine sha256 digest fields, excluding the two timestamps. Use this when independently deriving a current basis from source material, so the field set stays bound to this package's own contract instead of a hand-copied list.
- `sameBasis(left, right)` — whether two `AssessmentBasis` values are field-for-field identical across every `BASIS_FIELDS` entry. Digests are compared as opaque strings; this does not interpret or re-derive them.
- `sameStrings(left, right)` — whether two string arrays hold the same values, ignoring order, without tolerating an unmatched duplicate on either side. Neither input is mutated.
- `packageKey(ref)` — the canonical identity key for an `ImmutablePackageRef`: `name@version#integrity`. Two references with the same key are the exact same install candidate. Combine with `sameStrings` to compare arrays of package references — for example, an authorization's `permittedPackages` against an approved work-item set — without writing a bespoke deep-equality check.

## Usage

```ts
import {
  assessAdvisorEngagement,
  createAdvisorSession,
  REQUIRED_FIT_CRITERIA,
  REQUIRED_READINESS_CRITERIA,
} from "@clossys/advisor";

const report = assessAdvisorEngagement(connectorSuppliedEvidence);
const session = createAdvisorSession("opaque-session-id", nextAction);
```

`ADVISOR_TOOL_CONTRACTS` and `handleAdvisorTool()` provide pure, connector-facing contracts. They do not themselves authenticate, persist, or contact providers.

The remaining top-level runtime API is `ADVISOR_CHARTER`, `SPONSOR_ENTRY_PROMPT`, `validateAdvisorAssessmentInput()`, `shouldReassess()`, `advanceAdvisorSession()`, `validateExecutionAuthorization()`, `assessAdvisorExecutionReadiness()`, `assessEngagementDecisionCurrency()`, `resolveEngagementActionDisposition()`, `BASIS_FIELDS`, `BASIS_DIGEST_FIELDS`, `sameBasis()`, `sameStrings()`, and `packageKey()`. Exported TypeScript contracts include `AdvisorAssessmentInput`, `AdvisorAssessment`, `AdvisorExecutionReadiness`, `AssessmentBasis`, `BaselineDefinition`, `FirstWaveWorkItem`, `FirstWaveAct`, `PreWorkItem`, `HubPlacementEvidence`, `HubPlacementCell`, `Initiative`, `ExecutionAuthorization`, and their supporting state and finding types.

## Engagement decision currency

The primary metric, computed by `assessEngagementDecisionCurrency()`, re-derives each assessment from supplied evidence input rather than trusting a caller-created assessment result. It is:

```text
active engagements with a fresh assessment basis, one accountable and due
next action, and exact-plan-bound execution authorization where applicable
÷ active engagements evaluated
```

The desired direction is increase. With no active engagements the result is `indeterminate`, never a perfect rate. `resolveEngagementActionDisposition()` turns a passed deadline into `reassess-required`; the caller owns any escalation.

## Close condition

Independent consumer evidence shows the position's owned metric meets its setpoint over the declared review cadence. The owned metric is `engagement-decision-currency-rate`, computed by `assessEngagementDecisionCurrency()`. This package does not measure that evidence and does not close the loop; a consumer binds the condition against their own engagements. A green run of this package's tests is not a close.

## CLI

```bash
advisor-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and `2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in its own manifest:

```json
"foundry": { "assessment": { "bin": "advisor-check", "invocation": "single-json-input" } }
```

Controller onboarding discovers that declaration from the installed manifest and never infers a surface.

```bash
advisor-execution-readiness assessment.json 2026-08-24T14:00:00Z
```

This execution-only command re-derives the assessment from the evidence at the
runner-supplied current instant; it never treats `assessment.json`'s `asOf` as
the time of execution. It exits `0` only when the derived plan is
`ready-for-sponsor-approval`, all pre-work is satisfied, and the retained
authorization exactly matches its plan, basis, repositories, packages, and
mutation surfaces at that instant. It exits `1` for a concrete readiness or
authorization violation, and `2` for unreadable, malformed, or indeterminate
evidence.

## Evolution

The package evolves through normal versioned releases. Keep source evidence and content-addressed bases in the consumer's durable control plane, then reassess when scope, evidence, initiatives, readiness observations, or cadence changes.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
