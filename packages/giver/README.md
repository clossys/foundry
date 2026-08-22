# @vespeneventures/giver

**Everything about what you get — what you asked for, and what we owe you.**

The question this role answers, and no other role does:

> Did this person get what they asked for, or a reason, or a human — and
> everything we owed them, on time?

Ships the schema and the checkers; every consumer authors its own values.

## The loop this closes

What is permitted and what is owed are the setpoints. Delivering, refusing
or handing off is the act. Delivery proofs and placement records are the
observation. Comparison against the declared service level and the declared
window is the check. Re-sending, escalating and recording lateness are the
correction.

A request answered and never joined to a record of what the person actually
got has no observation and no comparison. It is an open loop, and closing
it is the reason this package exists.

## The defect this exists to repay

A send path in this workspace reads its policy collaborator like this:

```ts
const policy = (await config.policy?.(message)) ?? { outcome: "allow" };
```

An optional collaborator defaulting to a positive outcome. A host that
wires nothing sends everything to everyone, and nothing errors — the
absence of a signal is indistinguishable from a passing one. Two rules
follow here, and both are structural rather than advisory.

**1. No collaborator is optional, and no absence has a positive default.**
Every field `decideOutcome` needs is required. "Nothing is owed" is written
`owed: null`; "no human is free" is written
`{ available: false, namedReason }`. There is no `?.` and no `??` anywhere
in the decision path, and `src/collaborators.check.ts` fails the build if
a single `?` is ever added to the input type.

**2. Neither collapse is expressible.** An indeterminate read cannot become
a delivery, because every `DeliveryBasis` variant is a positive, named
reason to send — there is no variant meaning "we could not tell". It also
cannot become a bare refusal, because every `VerdictRefusalGrounds` variant
is either the person's own standing decision or a hand-off that could not
be placed, and the second carries the hand-off record with it.

The second collapse is the more dangerous one, and it is the reason the
type is shaped that way rather than merely documented. Rounding "could not
decide" down to "refuse" looks like discipline: the refusal metrics stay
healthy while real requests are quietly dropped and nobody is ever handed
the thing that needed a person.

## The verdict is a ternary

`delivered` / `refused` / `handed off`. Never a binary. A binary cannot
tell a request given to a person apart from a request that went nowhere.

**Hand-off is the only outcome that requires a human.** If no human is
available, the outcome is a **refusal with a named reason, recorded as a
hand-off that could not be placed** — never a delivery. The hand-off record
does not evaporate into the refusal: `handoffRecordFor` returns it, the
placement gate reads it, and it is reported as raised and never picked up.

## The inverted rule

On a standing refusal, this package refuses — **except for something we
owe**, which it must still send, with the send recorded against the
denial.

That precedence rule lives in `decideOutcome` and nowhere else. An
obligation is owed regardless of what the standing record says; that is
what distinguishes it from anything else we might send. When a refusal is
on record the send still happens and the basis becomes
`owed-against-standing-refusal`, carrying the policy version and date of
the refusal it overrode. The refusal is not overwritten and not ignored —
it travels with the send, which is the only form in which "we sent this to
someone who told us not to" is auditable afterwards.

## The `butler` seam is a document, not an import

Whether a person has a standing instruction on file is owned by the
`butler` role. This package **does not import it**, does not depend on it,
and does not restate its evaluation logic. It reads a **document**:

- a declared filename — `STANDING_DECISIONS_DOCUMENT_FILENAME`, exported
  from `./record`, currently `standing-decisions.json`, relative to
  whatever directory the consumer nominates;
- a declared schema — `StandingDecisionDocument`, a `schemaVersion`, a
  `producedAt`, and a list of `{ subjectId, topic, status, ... }` entries
  whose four statuses (`granted`, `denied`, `absent`, `stale`) mirror what
  the producing role reports;
- and JSON in between.

That choice costs something, so here is why it is worth it. An import would
couple the send path to another package's release cadence and make "the
standing answer could not be determined" an exception rather than a value.
The document seam makes the failure mode explicit instead: a file that is
missing, unparseable, or does not validate becomes
`unreadableStandingDecision(reason)` — a first-class read with status
`"unreadable"` that `decideOutcome` routes to a person. There is no code
path from an unreadable document to a delivery, and no way to write one.

```ts
import { readStandingDecision, unreadableStandingDecision, validateStandingDecisionDocument } from "@vespeneventures/giver/record";
```

A document announcing a `schemaVersion` this reader does not know is
refused, not read optimistically. Two independently-maintained copies of a
vocabulary agree only by luck, so the seam declares what it agreed on.

## The `keeper` seam is a document owned here

The grounds retained behind a refusal remain a `giver` record, because this
is the role that requires them. `keeper` does not duplicate or import that
record; its visibility gate reads the versioned JSON document at
`RETAINED_GROUNDS_DOCUMENT_FILENAME` (`retained-grounds.json`, relative to
the consumer-nominated directory). Each ground carries the opaque
`subjectId` of the person the decision concerns, which lets a disclosure
route be checked without putting the grounds into `keeper`'s holding store.

`RetainedGroundsDocument`, `RETAINED_GROUNDS_SCHEMA_VERSION`, and
`validateRetainedGroundsDocument` are exported from `./record`. An unknown
version or a ground with no subject is unreadable, never silently visible.

## Install

```bash
npm install @vespeneventures/giver
```

Installing from this registry needs a GitHub personal access token with
`read:packages` — see the repository root README.

```ts
import { checkObligationDischarge, decideOutcome } from "@vespeneventures/giver";
```

## The three gates

All three are reachable from one installed bin, `giver-check`, dispatched
on the first argument matching a gate name exactly.

```bash
giver-check handoff-placement ./handoffs.json ./placements.json --at 2026-08-22T12:00:00.000Z
giver-check grounding ./answers.json ./retained-grounds.json
giver-check obligation-discharge ./obligations.json ./proofs.json --at 2026-08-22T12:00:00.000Z
```

### `handoff-placement`

Every hand-off has a placement record inside its declared service level. It
fails on a hand-off whose service level elapsed with no placement at all, on
one picked up after that level had already elapsed, on a placement
timestamped before the hand-off it answers, on a placement naming a
hand-off outside the set being checked, and on a hand-off raised after the
instant the run claims to check at.

**A raised hand-off nobody picked up is a finding, not silence.** That is
the whole gate. This particular failure produces no error, no alert and no
record anywhere else: a person was told someone would get back to them, and
the queue simply never emptied.

A hand-off still inside its own declared service level is counted and
reported as awaiting, never as a finding — and if nothing in the set has
come due, the gate exits `2` rather than reporting a pass it never earned.

### `grounding`

Every delivered answer cites a source, and every refusal retains its
grounds. It joins citations to the grounds the consumer says it still
holds, rather than trusting that a citation exists — a reference to
material that has since been dropped reads exactly like a good citation
right up until someone asks to see it. It fails on a delivery citing
nothing, on a delivery or a refusal citing material no longer retained, and
on a refusal that retained no grounds at all.

The refusal half is the half people forget. **A person may ask why they
were refused and contest it**, which is only possible if the grounds were
retained rather than merely computed. An outcome recorded without its
reasons is a decision nobody, including its author, can revisit.

A handed-off answer is not judged here. It has neither delivered nor
refused anything; whether it was picked up is the first gate's question.

### `obligation-discharge`

Every fired obligation has delivery proof timestamped inside its window. It
fails when the window closed with no proof at all, when every recorded send
against it failed, when a delivery landed outside the window, and on a
proof naming an obligation outside the set being checked.

**An attempt is not a delivery.** A weaker tool checks that a send was
attempted and passes on a record whose own state says the send failed — the
dispatcher this package repays resolves its promise on failure, and its own
documentation says plainly that a resolved promise is not a success.
Counting attempts reports a clean run while nobody was told. This gate
reads the observed state of each proof: `"failed"` is a breach, `"unknown"`
is unprovable, and only `"delivered"` inside the declared window discharges
anything. Three recorded attempts that all failed are three proofs and zero
deliveries.

A send whose outcome was never observed makes the obligation `unprovable`,
which exits `2` — not `0`, and not `1`. On a mixed run, where one
obligation breached and another was never observed, the gate reports the
indeterminate reason and exits `2` while still printing the breach it did
find: the exit code describes the completeness of the answer, the printed
findings are the answer so far.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran against a non-empty record set and found nothing. |
| `1` | Ran and found at least one real violation. |
| `2` | Could not run: a missing, unreadable, unparseable or schema-invalid record store; an empty record set; a set in which nothing has come due; an outcome that could not be established; a required declared value that was not supplied; or no gate selected at all. |

`2` is not a variant of failure. "I checked and it is fine" and "I never
checked" are different answers, and a gate that reports the second as the
first is worse than no gate.

A bare `giver-check` with no subcommand exits `2`, not `0`. Nothing was
selected, so nothing was checked, and a CI step with a dropped argument
must go red rather than green on the strength of having examined nothing.
An explicitly requested `--help` is the one exception, and exits `0`,
because asking for help is a run that did exactly what was asked.

`--at` is required on the two gates that compare against a deadline, and
has no default. A gate that read its own clock could never be replayed, and
whether a record is late would depend on when someone happened to look.

## API

Everything below is exported from the package root.

### Deciding

| Export | What it does |
| --- | --- |
| `decideOutcome` | The one decision. Returns the ternary verdict, and resolves the precedence rule between a standing refusal and a thing we owe. Takes the actor and the subject as separate fields. |
| `evaluateObligation` | Evaluates one obligation against every proof recorded for it. Returns `discharged`, `breached`, or `unprovable`. |

### The gates, as pure functions

| Export | What it does |
| --- | --- |
| `checkHandoffPlacement` | Gate 1, over hand-offs, placements, and the instant to judge at. |
| `checkGrounding` | Gate 2, over answers and the grounds the consumer still retains. |
| `checkObligationDischarge` | Gate 3, over obligations, delivery proofs, and the instant to judge at. |

### Validators and guards

| Export | What it does |
| --- | --- |
| `validateHandoffRecord` | Validates one untyped hand-off. |
| `validateHandoffRecords` | Validates an untyped array of them. |
| `validatePlacementRecords` | Validates an untyped array of placement records. |
| `validateAnswerRecord` | Validates one untyped answer, including its ternary outcome. |
| `validateAnswerRecords` | Validates an untyped array of them. |
| `validateRetainedGrounds` | Validates an untyped array of retained grounds. |
| `validateObligationRecord` | Validates one untyped obligation. |
| `validateObligationRecords` | Validates an untyped array of them. |
| `validateDeliveryProofs` | Validates an untyped array of delivery proofs. |
| `isHandoffRecord` | Boolean guard over `validateHandoffRecord`. |
| `isAnswerRecord` | Boolean guard over `validateAnswerRecord`. |
| `isObligationRecord` | Boolean guard over `validateObligationRecord`. |

### Vocabularies

`VERDICT_KINDS`, `ANSWER_OUTCOME_KINDS`, `HANDOFF_REASONS`,
`DELIVERY_STATES`, `STANDING_READ_STATUSES`,
`INDETERMINATE_STANDING_STATUSES` and
`INDETERMINATE_DISCHARGE_FINDING_KINDS` are the closed lists a caller
validating untyped input, or deriving an exit code, needs.

### Types

The record types are `HandoffRecord`, `HandoffSla`, `HandoffReason`,
`PlacementRecord`, `AnswerRecord`, `AnswerOutcome`, `GroundCitation`,
`RetainedGround`, `ObligationRecord`, `ObligationWindow`, `DeliveryProof`,
`DeliveryState`, `PolicyVersion` and `StandingRead`.

The decision types are `OutcomeInputs`, `OwedObligation`,
`HumanAvailability`, `GroundsReadiness`, `Verdict`, `DeliveryBasis`,
`VerdictRefusalGrounds`, `UnplacedHandoff`, `ObligationStatus` and
`ObligationBreachReason`.

Each gate returns its own result type — `HandoffPlacementResult`,
`GroundingResult`, `ObligationDischargeResult` — carrying findings typed as
`HandoffPlacementFinding`, `GroundingFinding` and
`ObligationDischargeFinding`, whose kinds are
`HandoffPlacementFindingKind`, `GroundingFindingKind` and
`ObligationDischargeFindingKind`, and whose non-clean outcomes are named by
`HandoffPlacementFailureReason`, `GroundingFailureReason` and
`ObligationDischargeFailureReason`.

Validation surfaces `ValidationIssue`, `ValidationResult` and `Validator`.

## The `./record` subpath

Two things live here, and they are the same idea from both ends.

The **document seams** described above: `STANDING_DECISIONS_DOCUMENT_FILENAME`,
`STANDING_DECISIONS_SCHEMA_VERSION`, `STANDING_DECISION_STATUSES`,
`validateStandingDecisionDocument`, `readStandingDecision`, and
`unreadableStandingDecision`. A subject with no entry reads `absent`, which
is indeterminate and routes to a person — never a grant, and never a
refusal either. "Nobody ever asked them" and "they said no" stay different
answers all the way through. The same subpath exports
`RETAINED_GROUNDS_DOCUMENT_FILENAME`, `RETAINED_GROUNDS_SCHEMA_VERSION`,
`RetainedGroundsDocument`, and `validateRetainedGroundsDocument` for the
person-facing grounds register that `keeper` reads without importing this
package.

The **emitters**: `answerRecordFor` and `handoffRecordFor` turn one verdict
into exactly the records the gates read back. They exist so the decision
and the evidence of it cannot drift apart — a consumer hand-writing its own
records could record a delivery for a verdict that refused, and nothing
downstream would ever know. `handoffRecordFor` returns a record for a
hand-off that was placed **and** for a refusal that could not place one,
which is what keeps an unanswered person from becoming a clean row.

## Requirements

Node 20 or newer. Zero runtime dependencies.

## What this package is not

- It carries no obligation, no register, no category, no service level, no
  window and no jurisdiction logic. Every one of those is a value, and
  values belong in each consumer's own repository — **the consumer declares
  its own obligation register.**
- It makes **no claim of legal compliance**. It is record machinery, not
  advice.
- It holds no content. No record here carries the text of a request, an
  answer, a refusal, or a message; grounds are referenced by opaque id and
  proofs by an opaque transport reference. A gate can run over a whole
  record set with no person-attributable content passing through it, and no
  such record is ever written into this repository.
- `subjectId` and `actorId` are opaque host-owned references. Neither ever
  carries an email address, a name, a phone number, an address, or an IP,
  and they are separate identifiers in every signature — an actor answering
  on a person's behalf and the person themselves must stay
  distinguishable.

## Licence

MIT. See [LICENSE](LICENSE).
