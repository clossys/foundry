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

Optional `placementEvidence` is a caller-supplied `schemaVersion: 1` document of missing, stale, wrong-wiring, over-install, and hub-versus-product cells. A consumer connector fills it from hub-tree observations; this package does not read the tree, does not walk sister product repositories, and does not invent a new role. Each cell must be addressed by a matching first-wave act or by `prerequisite` (missing/stale), `remove` (over-install), or `relocate` (wrong-wiring and hub-versus-product) pre-work. A cell may additionally declare two optional expectations, and the join enforces both when present:

- `expectedVersion` — the concrete exact semver the fix must land. A covering install work item that declares any other version (for example, a same-version reinstall of a stale pin) does not close the cell; it stays open with a `placement-cell-coverage` finding.
- `expectedPlacement` — the dependency bucket, `dependencies` or `devDependencies`, the pin must land in. A covering work item whose `placement` names the other bucket does not close the cell.

Pre-work that covers a cell must also reference the cell's package through its own `packageName` field; pre-work for an unrelated package never closes a cell. Omitting the document leaves existing assessments valid.

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

`assessAdvisorEngagement()` adds a derived `sponsorSummary` on every `AdvisorAssessment` from the top-level `state`; callers cannot supply it. `nextSponsorQuestion()` and `applySponsorChoice()` expose sponsor-fit and readiness prompts as stable multiple-choice cards (one unknown criterion at a time, fit before readiness).

The remaining top-level runtime API is `ADVISOR_CHARTER`, `SPONSOR_ENTRY_PROMPT`, `validateAdvisorAssessmentInput()`, `shouldReassess()`, `advanceAdvisorSession()`, `validateExecutionAuthorization()`, `assessAdvisorExecutionReadiness()`, `assessEngagementDecisionCurrency()`, `resolveEngagementActionDisposition()`, `BASIS_FIELDS`, `BASIS_DIGEST_FIELDS`, `sameBasis()`, `sameStrings()`, and `packageKey()`. Exported TypeScript contracts include `AdvisorAssessmentInput`, `AdvisorAssessment`, `AdvisorExecutionReadiness`, `AssessmentBasis`, `BaselineDefinition`, `FirstWaveWorkItem`, `FirstWaveAct`, `PreWorkItem`, `HubPlacementEvidence`, `HubPlacementCell`, `Initiative`, `ExecutionAuthorization`, `SponsorQuestionCard`, `SponsorQuestionChoice`, `SponsorChoiceApplyResult`, `SponsorQuestionInput`, and their supporting state and finding types.

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

This package also ships the `clossys-advisor` Agent Skill at `skill/SKILL.md`.
In Cursor, mention `@clossys-advisor` to talk to that receptionist voice next
to the assessment bins below. The skill is a chat voice, not a second engine,
and it does not replace `advisor-check` or `advisor-execution-readiness`.

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

## Capability catalogue and kit composition

`CAPABILITY_CATALOGUE` is this package's own generated, build-time-frozen
map of every role in this repository's role-loop archetypes: each role's
job question, primary mode, metric, boundary, `solves` claims, fit
signals, `needs`/`feeds` handoff edges, and declared `capabilities`. Each
package's `needs`, `solves`, `feeds` and `fit` are read in exactly the
shape this repository's package-framework contract defines (a `needs`
entry names its `producerRole` by scoped package name; a `solves` entry
carries `statement`, `metric`, `proofCase` and `evidence`). It is generated, never
hand-grouped, and reading it performs no file or network I/O — it is a
plain exported constant. `kitCatalogueDigest` is the deterministic sha256
over that frozen catalogue (stable key order); a connector may bind it
into `AssessmentBasis.catalogDigest` so a reassessment can detect that the
catalogue a plan was built against has since changed.

`KIT_PRESETS` is a curated set of starting-point kits — fallbacks and
best-sellers Advisor can offer when a client's stated problem matches one
closely — never an exhaustive partition of the package catalogue. For
every other problem, Advisor composes a custom kit instead.

`composeKit()` takes a set of `selectedRoles` and the catalogue, pulls in
every role a selected role's `needs` edge names that was not already
selected, orders roles so a producer always precedes its consumer, and
reports every need that is not met. `needIsMet()` applies the same rule as
this repository's package-framework gate: a declared `needs` entry is met
only when its producer declares a `feeds` entry for that artifact
(`declaredFeeds`, kept verbatim and in declared order). An unknown
selected role comes back `indeterminate`, never guessed past.

Needs cycles are judged per capability, not per role, following the
package-framework contract's cycle decision. `judgeNeedsCycles()` builds that
graph for a set of roles. A cycle among capabilities is a deadlock, and
`composeKit()` returns `indeterminate`. A role-level loop with no
capability cycle behind it is legitimate, such as the Customer/Publisher
keep loop. The kit composes, and `roleCycles` lists the loop. Some cycles
the capability graph cannot account for, so they cannot be judged: a cycle
only visible through a role with no capability map, or a role loop closed
by an inferred fallback need that names no capability. The kit composes,
and `unjudgedCycle` names the cycle rather than passing it silently.
`recommendKit()` carries both `roleCycles` and `unjudgedCycle`
into its verdict.

`composeKitFromProblems()` is the problem-confirmed entry point (the
client confirms PROBLEM cards, never picks packages): it deterministically
maps confirmed problem ids to roles via each role's own `solves[].problem`
entries, then reuses `composeKit()` for closure and ordering. Exactly one
confirmed problem must be marked `primary`; a closed, composed role count
over `FIRST_ENGAGEMENT_ROLE_CAP` (5) requires a caller-supplied
`overCapReason`, or the result comes back `"over-cap"` instead of
`"composed"`.

`validateKitProposal()` checks a skill-proposed kit against the
deterministic mapping `composeKitFromProblems()` itself would produce from
the same confirmed problems. Every proposed role must trace to either a
direct solver of a confirmed problem or a role another direct solver's
`needs` requires; a role that traces to neither comes back as a removal
candidate in `removalCandidates`, so the skill (or a human) makes that
call rather than it being silently dropped.

`EVIDENCE_LEVELS` is the ordered evidence-level vocabulary
(`"designed" < "qualified" < "proven"`), and `evidenceAtLeast(evidence,
floor)` compares one evidence level against a floor along that order.
`presetEvidenceFindings()` checks presets against an evidence floor
(`"qualified"` by default) and is advisory only: most roles still carry
only the `designed` fallback `solves` entry, so this never fails a preset
the owner already approved — it stays visible and testable so it is ready
to enforce once real evidence exists.

`toEngagementBrief()` turns a `composed` `ComposeKitResult` into the
client-facing `EngagementBrief`: the client's problem, which roles the kit
staffs and why, the handoff sequence, and one deliverable line per staffed
role, drawn from that role's own `boundary.owns` text in the catalogue —
never invented copy. This package does not write files; `@clossys/launcher`
writes the brief to `clossys/brief.json` in each staffed repository.
`validateEngagementBrief(value)` checks a candidate brief against the
shared brief contract,
[`docs/contracts/engagement-brief.json`](https://github.com/clossys/foundry/blob/main/docs/contracts/engagement-brief.json)
(in the public repository, not shipped in this package), and its
`context` snapshot against `engagement-context.json` (issue #1475).
Launcher validates against the same files where it writes the
brief. Unknown fields are refused, and each finding has the rule
`engagement-brief-contract` and a message that never echoes a value from
the brief. `problem`, each role's `role` and `why`, and each goal's `metric`
must contain a non-whitespace character; an item of `inputsFrom`,
`outputsTo`, `sequence` or `deliverables` must not be empty. Messages name
fields, and a key that is not a plain identifier is shown as an escaped
JSON string.

A brief may carry `staffedHere` (issue #1178): the roles staffed in the one
repository it is written to, in plan order. The hub brief has none;
`toEngagementBrief({ ..., staffedHere })` writes it for one repository and
throws, naming only the position, when the list is empty or an entry is not
one of the composed roles or repeats. `validateEngagementBrief()` applies the
same two rules, once the schema passes: every entry is one of `roles[].role`
(rule `engagement-brief-rule-b1`) and none repeats
(`engagement-brief-rule-b2`). `PUBLIC_PROBLEM_PLACEHOLDER` is the fixed
text, read from the brief contract, that stands in for `problem` in a
repository whose visibility is not private. The contract's description
defines how a repository's brief is derived from the hub brief, so that
every package derives it the same way; this package does not derive or
write it.

## Shared engagement context

`ENGAGEMENT_CONTEXT_FIELD_IDS` lists the shared engagement context fields
in their fixed order — `business`, `product`, `audience`, `stage`,
`intent`, `constraints` — the business questions a non-technical founder
answers once, so no later role intake asks again what this record already
answers. `fieldById()` looks up one field's current state (`known` with a
chosen value, or `unknown`) on an `EngagementContext`. An unanswered field
stays `unknown` and is never invented from anything but the founder's own
answer; technical facts never live here.

`nextContextQuestion()` returns the first unanswered context field's
question card, in the fixed field order, or `null` once every field is
known. `applyContextChoice()` maps a chosen choice id back to the field's
new state: a fixed choice becomes `known`, `"not sure yet"` stays
`unknown`, and `"something else"` is captured separately as the founder's
own freeform answer rather than inventing a stored value.

The context record lives on the hub, but roles run in product
repositories that have no hub checkout. So a role never reads
`clossys/advisor/context.json` directly: `toEngagementBrief()` accepts an
optional `context` and writes a normalized copy into the brief (one
entry per field id, in the fixed field order), which is written to
`clossys/brief.json` in every staffed repository.
`contextFromBrief()` is how a role reads it back — a brief without a
snapshot, or a field missing from one, reads as `unknown`, never an
invented answer — and it returns a copy. The snapshot is refreshed by
re-applying the plan, not edited in place.

The brief is committed in every staffed repository, and a product
repository can be public when the hub is not. So a snapshot carries only
each field's fixed choice ids: `toEngagementBrief()` throws on a known
field whose `value` is not one of them (a founder's own "something else"
sentence, or a slugified form of it), and on a field id that appears
twice, rather than copying it into the brief.

The field ids double as reserved intake question ids: a role's own
intake card may not reuse one, because that question belongs to the
context card above. Foundry's package-framework gate reports a reused
id as `intake-card-duplicates-context-field` (report mode, a warning;
`--enforce`, a finding). Intake and context ids are lowercase slugs, and
the comparison ignores case and surrounding whitespace, so `Audience` or
` audience` is the same reserved id.

## Client problem vocabulary and confirmation

`CLIENT_PROBLEMS` is this package's own generated, build-time-frozen
client problem vocabulary. Advisor offers these as confirmation cards —
the client confirms a problem, never picks a package.
`nextProblemQuestion()` returns the next candidate problem card the
client has not yet answered, in vocabulary order, or `null` once every
candidate has a confirmation recorded. `applyProblemChoice()` maps a
chosen choice id to `confirmed`, `declined`, `unknown`, or
`something-else`; `unknown` and `something-else` never invent a
confirmation.

## Plan record and the STATUS document (issue #1175)

`renderAdvisorStatus(plan)` is a pure markdown renderer for the STATUS
document at `clossys/advisor/STATUS` (a `.md` file, saved with that
extension): five fixed sections in order — Mandate, Where we are,
Recommended next, Decisions, Blockers — matching Controller's own
loop-state shape (#1195) so a later migration to `loop.json` is a
rename, not a redesign. It takes an `AdvisorPlan` record (`schemaVersion`,
`asOf`, `mandate`, `whereWeAre`, `recommendedNext`, `decisions`,
`blockers`); `AdvisorBlockerKind` reuses #1195's five blocker kinds
verbatim. This package performs no file I/O — the caller writes the
rendered text.

`AdvisorPlanBlocker` (`capabilityId`, `kind`, `owner`,
`nextAction: { who, how, byWhen }`, `since`) is field-for-field the same
shape as the Controller role's own `Blocker` record, defined for issue
#1237 in the Controller package's own loop module: the owner direction
on #1187 (2026-09-23) is that an order-dependent change may carry no
local copy of a shared definition once that definition is on `main`,
and a blocker record is exactly that kind of definition.
`validateAdvisorPlan(value)` checks a candidate plan against the shared
plan contract, [`docs/contracts/advisor-plan.json`](https://github.com/clossys/foundry/blob/main/docs/contracts/advisor-plan.json)
(issue #1475; in the public repository, not shipped in this package —
this package packs its content into a generated module at build time).
That file is the one definition of the record: `@clossys/launcher` validates against the same
file before it applies an approved plan, so a plan this package accepts is
a plan Launcher accepts. It checks every field, including each blocker's
`capabilityId`, `owner`, `since`, and full `nextAction`, and `kind`
membership in `AdvisorBlockerKind` (`ADVISOR_BLOCKER_KINDS` lists the five
values in order, and a test keeps it equal to the contract). Blank strings
are refused. Every time must be a real calendar time in ISO 8601 form,
with `Z` or a `±hh:mm` offset on a date-time, checked field by field rather than by shape: month 01-12, a day that month has
(leap years included), hours 00-23, minutes and seconds 00-59, and a time
zone offset of at most 23:59, so `2026-02-30` or `T24:30` is refused
(`recommendedNext.due` and a blocker's `nextAction.byWhen` may be a plain
date). Every object is
closed: a field the contract does not declare is refused, never ignored.
It returns every finding it locates, the same pattern as this package's
other validators; each finding has the rule `advisor-plan-contract`, a
`path` naming the field at fault, when there is one (for example
`blockers[0].nextAction.byWhen`; a plan that is not an object at all has
none), and a message that never echoes the
field's value. A string or object key containing a lone surrogate is
refused too, so every plan that validates has a digest. This package still carries no runtime dependency on the
Controller package: the blocker shape is duplicated structurally, never the
owner-per-kind mapping, which stays owned by Controller.

A plan may also say who works where, and what exactly may be installed
(issue #1178), in four optional fields: `kits` (each `{ id, source, verdict }`,
with `verdict` only `"recommended"` for now), `staffing` (one
`{ repository, roles }` entry per repository, by repository inventory id),
`packages` (exact acts: `install` or `pin-starter`, one exact version with no
prerelease or build suffix, and one `sha512-` integrity value each) and
`resolution` (`{ snapshotDigest }`), typed as `AdvisorPlanKit`,
`AdvisorPlanStaffing`, `AdvisorPlanPackageAct` and `AdvisorPlanResolution`.
A decision (`AdvisorPlanDecision`) may carry `subjectDigest`.
Once the schema passes, `validateAdvisorPlan()` applies the code rules the
contract's description defines, each finding with the rule
`advisor-plan-rule-r1` to `-r8` and a `path`: no repository staffed twice
(ids compare case-insensitively); staffed roles and `mandate.roles` agree in
both directions; every package act names a staffed repository, spelled
exactly the same; no `planItem` repeats; no package appears twice in one
repository; `resolution` is present exactly when `packages` is; no kit id
repeats; and no role repeats within one staffing entry. A plan that breaks
one has no digest. Launcher implements the same rules separately, and both
packages are tested against one shared corpus,
[`docs/contracts/advisor-plan-rules.fixture.json`](https://github.com/clossys/foundry/blob/main/docs/contracts/advisor-plan-rules.fixture.json)
(in the public repository, not shipped in this package).

An approval binds bytes only through its `subjectDigest`, the digest of the
exact change the approver was shown; an approval without one binds nothing.
From an approving decision until apply completes, Advisor changes no field
the plan digest covers: recording the approval appends a decision and may
update `asOf`, which the digest excludes, so the digest at approval equals
the digest at apply.

`planDigest(plan)` is the canonical digest of a plan, the value the
assessment basis's `planDigest` records and an execution authorization must
equal, so that it names exactly which plan is meant:
`sha256:` and the hex SHA-256 of the plan's RFC 8785 canonical JSON,
leaving out `asOf` and `decisions` (`PLAN_DIGEST_EXCLUDED_FIELDS`), because
an approval is itself recorded in `decisions`. It throws for a plan that
does not validate. `canonicalJson(value)` is that serialization on its
own, and refuses a lone surrogate or a non-finite number rather than
repairing it. The definition is
[`docs/contracts/advisor-plan-digest.md`](https://github.com/clossys/foundry/blob/main/docs/contracts/advisor-plan-digest.md)
(in the public repository, not shipped in this package).
Launcher implements it separately, and both packages are tested against
the same fixture corpus, so they compute identical digests.

The `advisor-render-status` CLI wraps this renderer:

```bash
advisor-render-status plan.json
```

It prints the rendered STATUS document to stdout and exits `0`, or exits
`2` for unreadable or malformed input (now via `validateAdvisorPlan`,
so a blocker in the old, local shape is rejected the same way). It reads
the file as strict JSON: bytes that are not valid UTF-8, and an object
that repeats a key at any depth, are refused rather than decoded with a
replacement character or resolved to the last value, and so is a file
that starts with a byte order mark. A syntax error is reported by position
only, never quoting the file's text; a repeated key is named, as an escaped
JSON string, so a control character in it is shown as `\u001b` rather than
reaching the terminal (#1475).

## Kit verdicts (issue #1177)

`recommendKit()` turns confirmed problems into a client-facing verdict:
composes a kit from the confirmed problems (`composeKitFromProblems()`),
then checks whether a curated preset's own closure exactly matches the
resulting role set — if so, the verdict is attributed to that preset for a
friendlier name (`source: "preset"`), while still using the composition's
own citation trace. Each `KitVerdictRole` carries the role's `why`, the
confirmed-problem `citations` that ground it (empty for a role pulled in
only by a `needs` edge), its `goal`, handoffs, and `deliverable` (from the
catalogue's own `boundary.owns`). `readyForClient` reflects the
operator-review hook below — always `true` in self-serve mode.

## Self-serve and managed engagements (issue #1044)

Self-serve and managed are grant shapes on the same engine, not separate
distributions. `EngagementRecord` carries an optional `engagementMode`
(`"self-serve"` when omitted, or `"managed"`) and `operatorRef`.
`validateManagedEngagement()` requires a nonempty `operatorRef` naming a
party other than Advisor itself when the mode is `"managed"`; omitted mode
always validates cleanly, so every existing assessment input stays valid
unchanged. `assessAdvisorEngagement()` runs this validation automatically
alongside execution-authorization validation.

The operator-review hook: `proposalReadyForClient(engagement, review?)` is
`true` in self-serve mode, and in managed mode only once the engaged
operator (matching `operatorRef`) has recorded an `OperatorReview` with
`disposition: "approved"` — the owner-approved design for a managed-mode
operator reviewing Advisor's proposed kit before the client sees it. This
package neither stores that review nor infers a disposition; the caller
retains it and passes it back in.

## Next-step phrasing (issue #1180)

`nextStepInstruction(role, host)` renders one plain-language instruction
for opening the next repository and calling the next role, correct for the
client's own tool (`ClientTool`: `"claude-code"`, `"cursor"`, `"codex"`, or
`"unknown"`) — Claude Code as a slash command, Cursor as an @-mention,
anything else names the skill without inventing an unverified syntax.
Every phrasing carries the `loop` keyword every role is invoked with
(#1194's owner decision: `/clossys-<role> loop` in Claude Code,
`@clossys-<role> loop` in Cursor) — never a bare skill name.
`NextStepHostContext` is a small input type pending Launcher's own
recorded-host shape (#1180's Launcher side); once that lands, a caller
adapts it into this type.

## Budget preference (issue #1219)

`BUDGET_PREFERENCE_CARD` is the single one-question-at-a-time card asking
the client's budget stance, using the fixed tier names from #1219's owner
decision: `cost-conscious`, `balanced`, `max-quality`, or left `unknown`.
`applyBudgetPreferenceChoice()` maps a chosen id to the outcome without
inventing a preference the client did not choose, and `toPreferencesFile()`
produces the exact `clossys/preferences.json` shape. Advisor never names a
model here or anywhere else in this package; a host maps the stance to
models through its own per-host profile.

## Evolution

The package evolves through normal versioned releases. Keep source evidence and content-addressed bases in the consumer's durable control plane, then reassess when scope, evidence, initiatives, readiness observations, or cadence changes.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/advisor.md), kept in the public repository rather than in the installed package.
