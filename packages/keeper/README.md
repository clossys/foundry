# @vespeneventures/keeper

**Everything about what you gave us, and what we understand from it.**

The question this role answers, and no other role does:

> Does everything we hold about this person trace to something they did, and
> can they see it and correct it?

Ships the schema and the checkers; every consumer authors its own values.

## The loop this closes

The consumer's declared retention schedule and attribution rules are the
setpoint. Holding is the act. **Showing the person what is held is the
observation.** Their correction or deletion is the comparison and the
correction.

Without the showing step there is no observation and no comparison, and what
is left is a store rather than a loop. That is the step products skip, and
they skip it because nothing makes them do otherwise: material held and never
shown produces no exception, no alert, and no failing build. The person never
finds out, and neither does anyone working on the system. `keeper-check
visibility` is the thing that fails.

## No person-attributable record is ever written to git

This is the sharpest constraint on this package, and it is not a style
preference.

**Git cannot delete.** A record committed once is in the history, in every
clone, and in every fork, and no later commit removes it. This role's whole
job is disposal — a schedule that runs out, an erasure that leaves no residue,
an account that closes. A store this package wrote into a repository would be
a store it could never empty.

So there is no store here. `HoldingStore`, `DisclosureDirectory` and
`SourceEventLedger` are **host-supplied ports**: this package decides what a
record must contain, the host decides where it durably lives and how it is
really erased, and no implementation of any of them ships. Nothing in this
package writes anything, anywhere. The fixtures in its own tests are synthetic
ids in temporary directories, never a real holding.

`HoldingStore.erase` returns the **observed** effect rather than `void` or a
boolean, for the same reason: a host that cannot confirm the record is gone
must say `"unknown"`, and that answer travels all the way to the disposal
gate's exit code. An erasure nobody verified never reports as done.

## The boundary rule

**An instruction constrains us; an understanding only informs us.**

A belief inferred from behaviour is an understanding. It may inform anything.
The moment it starts **constraining** what happens to a person it has become
an instruction — and an instruction is something they are entitled to have
been asked about first. At that point it belongs to the role that owns
standing instructions, not to this one.

That boundary is a type, not a convention:

```ts
type BeliefUse =
  | { mode: "informs" }
  | { mode: "constrains"; confirmation: BeliefConfirmation | null };
```

The `confirmation` field is **required and explicitly nullable**. Writing
"this belief constrains behaviour" forces the author to confront whether the
person was ever asked: they supply a confirmation, or they write `null` on
purpose. What is impossible is the third shape — a constraint where the
question simply never came up.

`null` stays representable deliberately, because it is the state the gate
exists to find. `keeper-check attribution` reports it as
`belief-constrains-without-confirmation`, and `decideHolding` returns
`unjustifiable` with the fault `belief-used-as-constraint`. It is caught even
when the belief's own source event is impeccable: knowing where an inference
came from is not permission to act on it.

The fix is never to delete the belief. It is to confirm it with the person, at
which point it becomes theirs.

## Two ternaries, and they are not the same ternary

`Holding` is the runtime verdict — `held` / `forgotten` / `unjustifiable`. The
gate results are **judgements** — satisfied, violated, or indeterminate.
Conflating them is the mistake this package is written to avoid.

**A gate must be able to say "I could not check", and must never round that to
satisfied.** All three gates have a per-record indeterminate route as well as
an empty-set one: a provenance the store could not resolve, a disclosure route
that could not say whether the person can see the item, an item whose class
the schedule never declared, a deletion nobody observed. Each exits `2`.
Eliminating "I could not tell" from a judgement is how a gate reports a clean
bill for work it never did.

The **verdict** has no indeterminate variant, and that is not the same
elimination. It **fails closed**: a holding whose source could not be verified
is `unjustifiable`, never `held`. Every route out of indeterminacy goes toward
the adverse answer.

## What cannot be written here

Every `HoldingBasis` variant — every reason for keeping something — carries a
`sourceEventId`. There is no basis meaning "we could not tell", "legacy", or
"it was already there". A reason to keep something that does not name a thing
the person did is **unconstructable**, not merely discouraged.

`src/justification.check.ts` proves that at compile time, along with the
boundary rule and the zero-optional-keys property of `HeldItem` and
`HoldingInputs`. It also pins indeterminacy **in**: every could-not-tell value
must remain writable, so a future simplification cannot quietly delete the
answer this package needs most.

## Install

```bash
npm install @vespeneventures/keeper
```

Installing from this registry needs a GitHub personal access token with
`read:packages` — see the repository root README.

```ts
import { checkDisposal, decideHolding } from "@vespeneventures/keeper";
```

## The three gates

All three are reachable from one installed bin, `keeper-check`, dispatched on
the first argument matching a gate name exactly.

```bash
keeper-check attribution ./items.json ./source-events.json
keeper-check visibility ./items.json ./disclosures.json ./retained-grounds.json
keeper-check disposal ./items.json ./retention-schedule.json ./deletions.json --at 2026-08-22T12:00:00.000Z
```

### `attribution`

Every held item names the source event it came from. It **joins** each item's
provenance to the events the consumer says it still retains, rather than
trusting that an id is present: a reference to an event that has since been
dropped reads exactly like a good one, right up until somebody asks why.

It fails on a holding that names no source event, on an inferred belief that
names none, on a named event that is not retained, on one belonging to a
different person, on one that occurred after the item was already held, on a
belief that constrains behaviour with no confirmation, and on a confirmation
naming an event nobody retains.

**An inferred belief with no source event is the central finding**, and it has
its own finding kind rather than being folded in with the rest. It is the
holding a person is least likely to know exists, least able to guess at, and
most likely to be wrong about — and a report saying "3 unattributed items"
hides whether any of them were things nobody ever told the person we believed.

An item whose provenance the store could not resolve is `source-unverifiable`,
which exits `2`.

### `visibility`

Every held item, plus every decision ground retained in `giver`'s declared
`retained-grounds.json` document, is reachable by the person it is about and
correctable by them. It fails on material with no disclosure route at all, on
material every route reports hidden, on material whose only routes belong to
somebody else, and on material that can be read but not changed.

The grounds remain owned by `giver`; they are not copied into this package's
holding store. `keeper` independently validates the versioned JSON shape and
joins it to disclosure routes. `retained-ground-unreachable` is distinct from
an ordinary unreachable holding, so the report names which register needs a
route. The packages do not import one another.

The join is on the **subject**, not just the item. A route for an item that
points at a different person is reported as `disclosed-to-another-subject`
rather than counted as visibility — "somebody can see this" was never the
question.

`correctable` is checked separately from reach, because **reading is not
correcting**. A surface that shows a person a belief about them they cannot
change looks like transparency and is not.

A route that could not say either way is `reach-unverifiable`, which exits `2`.

### `disposal`

Nothing outlives the retention its own class declared, and a deletion leaves
no residue.

**The adversarial case.** A weaker tool checks that a retention policy
*exists*. It reads the schedule, finds it well formed, and passes — while
three records sit 400 days into a 90-day policy, because nothing ever compared
the declaration against the data. Declaration present, drift unmeasured. That
is not a gap in coverage; it is a gate grading the wrong noun. A policy is a
claim about records, and the only way to check a claim about records is to
read the records.

This gate joins each item to the rule its own class declared and compares ages
in days. A deletion is checked the same way — by the record it claims to have
removed, not by the call that claimed to remove it. A deletion recorded as
erased whose item is still in the held set is `deletion-residue`; one recorded
as failed is `deletion-failed`. A deletion naming an item that is *not* in the
held set is the success case and is not a finding: that is the shape a working
erasure actually has. Residue reports under its own reason,
`deletions-left-residue`, rather than borrowing the retention one.

An item whose class the schedule **never declared** is `retention-undeclared`,
which exits `2` — the answer a weaker tool cannot give. A schedule with a hole
in it looks exactly like a schedule without one, until something is held under
the hole. A deletion nobody observed the effect of is `deletion-unobserved`,
and an item whose own `heldSince` cannot be read is `held-since-unreadable`;
both exit `2` for the same reason.

That last one is the arithmetic version of the same rule. Every comparison in
this package is a strictly-greater test, and `NaN > n` is `false` — so an
unreadable instant flowing through the maths would read as "inside its
schedule" and count toward the satisfied answer. The validators refuse an
unparseable timestamp at the JSON boundary, but the checkers are exported and
take any record a host builds directly, so the rule lives in the arithmetic
too.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran against a non-empty holding set and found nothing. |
| `1` | Ran and found at least one real violation. |
| `2` | Could not run: a missing, unreadable, unparseable or schema-invalid record store; an empty holding set; an answer that could not be established; a required declared value that was not supplied; or no gate selected at all. |

`2` is not a variant of failure. "I checked and it is fine" and "I never
checked" are different answers, and a gate that reports the second as the
first is worse than no gate.

A bare `keeper-check` with no subcommand exits `2`, not `0`. Nothing was
selected, so nothing was checked, and a CI step with a dropped argument must
go red rather than green on the strength of having examined nothing. An
explicitly requested `--help` is the one exception, and exits `0`.

On a mixed run — one item genuinely in violation and another that could not be
checked — the gate reports the indeterminate reason and exits `2` while still
printing the violation it did find. The exit code describes the completeness
of the answer; the printed findings are the answer so far.

`--at` is required on `disposal` and has no default. A gate that read its own
clock could never be replayed, and whether a record has outlived its schedule
would depend on when someone happened to look.

## API

Everything below is exported from the package root.

### Deciding

| Export | What it does |
| --- | --- |
| `decideHolding` | The one decision. Returns the ternary verdict, resolves the precedence between an erasure request, a closed account, an elapsed retention, and a holding nobody can justify, and fails closed on every could-not-tell input. Takes the actor and the subject as separate values. |

### The gates, as pure functions

| Export | What it does |
| --- | --- |
| `checkAttribution` | Gate 1, over held items and the source events the consumer still retains. |
| `checkVisibility` | Gate 2, over held items, `giver`'s retained-grounds document, and the disclosure routes that reach both. |
| `checkDisposal` | Gate 3, over held items, the consumer's declared retention schedule, the deletions recorded against them, and the instant to judge at. |

### Validators and guards

| Export | What it does |
| --- | --- |
| `validateHeldItem` | Validates one untyped held item, including its provenance and belief. |
| `validateHeldItems` | Validates an untyped array of them. |
| `validateSourceEvent` | Validates one untyped source event. |
| `validateSourceEvents` | Validates an untyped array of them. |
| `validateDisclosureRecords` | Validates an untyped array of disclosure routes. |
| `validateRetentionRules` | Validates an untyped array of the consumer's own retention rules. |
| `validateDeletionRecords` | Validates an untyped array of deletion records. |
| `validateGiverRetainedGroundsDocument` | Independently validates the versioned JSON document read from `giver`'s declared retained-grounds path. |
| `isHeldItem` | Boolean guard over `validateHeldItem`. |
| `isSourceEvent` | Boolean guard over `validateSourceEvent`. |

### Vocabularies

`HOLDING_KINDS`, `PROVENANCE_KINDS`, `HOLDING_ORIGINS`, `BELIEF_USE_MODES`,
`DISCLOSURE_REACHES`, `DELETION_EFFECTS`,
`INDETERMINATE_PROVENANCE_KINDS`,
`INDETERMINATE_ATTRIBUTION_FINDING_KINDS`,
`INDETERMINATE_VISIBILITY_FINDING_KINDS`,
`INDETERMINATE_DISPOSAL_FINDING_KINDS` and `DISPOSAL_VIOLATION_REASONS` are
the closed lists a caller validating untyped input, or deriving an exit code,
needs.

`GIVER_RETAINED_GROUNDS_SCHEMA_VERSION` is the document version this package
can read across the `giver` seam.

`disposal` has **two** violation reasons — `items-retained-past-schedule` and
`deletions-left-residue` — and they are kept apart deliberately. A set whose
only fault is erasure residue did not outlive its schedule, and reporting it
under that name would send a reader to inspect a schedule that is working.

### Types

The record types are `HeldItem`, `HoldingOrigin`, `Provenance`,
`InferredBelief`, `BeliefUse`, `BeliefConfirmation`, `SourceEvent`,
`DisclosureRecord`, `DisclosureReach`, `RetentionRule`, `DeletionRecord` and
`DeletionEffect`. The external seam types are `GiverRetainedGround` and
`GiverRetainedGroundsDocument`.

The host-supplied ports are `HoldingStore`, `DisclosureDirectory` and
`SourceEventLedger`. All three are interfaces; no implementation ships here.

The decision types are `HoldingInputs`, `RetentionRead`, `ReachRead`,
`SourceRead`, `DispositionRead`, `SuccessionClaim`, `Holding`, `HoldingBasis`,
`ForgettingGrounds` and `UnjustifiableFault`.

Each gate returns its own result type — `AttributionResult`,
`VisibilityResult`, `DisposalResult` — carrying findings typed as
`AttributionFinding`, `VisibilityFinding` and `DisposalFinding`, whose kinds
are `AttributionFindingKind`, `VisibilityFindingKind` and
`DisposalFindingKind`, and whose non-clean outcomes are named by
`AttributionFailureReason`, `VisibilityFailureReason` and
`DisposalFailureReason`.

Validation surfaces `ValidationIssue`, `ValidationResult` and `Validator`.

## The `./web` subpath

The showing step, as state. `useHeldRecord` reads everything held about one
person through a client-shaped port, renders a verdict per item using the same
`decideHolding` the gates and the CLI use, and exposes correction and erasure
as identically-shaped async functions on the same object.

```ts
import { useHeldRecord } from "@vespeneventures/keeper/web";
```

Being forgotten is reachable through the same call shape as being shown. A
surface that displays a person their record and makes deletion a support
ticket has observation without correction, and an open loop.

An erasure the host could not confirm **does not remove the row**: only an
observed `"erased"` does, and `failed` and `unknown` leave the item on screen
with the effect reported. Telling someone their data is gone when nobody
checked is the failure this whole role exists to prevent.

Exported here: `useHeldRecord`, `REACT_DECLARED_RANGE`, and the types
`HeldRecordClient`, `HeldRecordEntry`, `HeldRecordRow`, `UseHeldRecordOptions`
and `UseHeldRecordResult`.

`react` and `react-dom` are **optional peers of this subpath only**. Importing
the package root, or running the gates, never pulls React in. This subpath
asserts the installed React version against the declared range at import time,
so an absent or incompatible React fails loudly here with the range named,
rather than crashing later inside a hook with nothing pointing at the cause.
The client port is read on identity, so memoize or hoist it — this hook does
not paper over an unstable one, because doing so would make a runaway read
invisible rather than impossible.

## Requirements

Node 20 or newer. Zero runtime dependencies.

## What this package is not

- It carries no retention period, no holding class, no belief class, no
  disclosure surface and no jurisdiction logic. Every one of those is a value,
  and values belong in each consumer's own repository — **the consumer
  declares its own retention schedule and its own belief classes.**
- It makes **no claim of legal compliance**. It is record machinery, not
  advice.
- It holds no content. No record here carries authored material, saved work,
  or a belief's own wording; everything is an opaque id and a consumer-defined
  label. A gate can run over a whole holding set with no person-attributable
  content passing through it.
- `subjectId` and `actorId` are opaque host-owned references. Neither ever
  carries an email address, a name, a phone number, an address, or an IP, and
  they are separate identifiers on every record — the person acting and the
  person acted about are routinely different, and every join here keys on the
  **subject**.

## Licence

MIT. See [LICENSE](LICENSE).
