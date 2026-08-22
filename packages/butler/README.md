# @vespeneventures/butler

**Everything about what a person wants — now, and standing.**

The question this role answers, and no other role does:

> Do we have what this person wants — this request in their own
> confirmation, and their standing instructions, still current?

Ships the schema and the checkers; every consumer authors its own values.

## The loop this closes

A stated want is the setpoint. Acting on it is the act. Reading the
interpretation back, and asking whether the standing answer is still
current, is the observation. Unconfirmed intents and expired instructions
are the comparison. Re-asking is the correction.

A preference written to a row and never re-checked has no observation and
no comparison. It is an open loop, and closing it is the reason this
package exists.

## The defect this exists to prevent

A weaker tool checks that a consent row **exists**. It passes on a row
three policy versions old, and on a row a year past the window its own
author declared, because a boolean read of "granted" cannot see age.
Presence is not currency.

Two rules follow, and both are structural here rather than advisory:

1. **Consent is three states, never two.** `absent` (never asked) is a
   distinct value from `denied` (asked, refused), and neither is a boolean.
   Absence can therefore never be read as permission — including when the
   record store is unreachable, when the subject was never asked, and when
   the only thing on file is an inference nobody confirmed.
2. **A gate that cannot run must say so.** `butler-check` exits `2` when
   the record store cannot be read or there was nothing to scan, and `2` is
   never collapsed into `0` or `1`.

## Install

```bash
npm install @vespeneventures/butler
```

Installing from this registry needs a GitHub personal access token with
`read:packages` — see the repository root README.

```ts
import { checkCurrency, evaluateStandingInstruction } from "@vespeneventures/butler";
```

## The three gates

All three are reachable from one installed bin, `butler-check`, dispatched
on the first argument matching a gate name exactly.

```bash
butler-check confirmation-completeness ./intents.json ./confirmations.json --floor 0.8
butler-check currency ./instructions.json ./usages.json --invalidate-denial-on-policy-bump false
butler-check withdrawal-parity ./paths.json
```

### `confirmation-completeness`

Every acted-on intent has the subject's own confirmation record, or an
explicit below-floor hand-off. It fails on an intent dispositioned `acted`
with no confirmation at all, on one acted against a `misread` or `unclear`
read-back, on a reading below the declared floor acted on with neither a
hand-off nor a confirmation, and on a read-back answering an intent outside
the set being checked.

`--floor` is required and has no default. The number below which a reading
is too weak to act on is one of the consumer's own values.

### `currency`

No standing instruction is used past its declared window. It reads
**usages**, not instructions alone: a set of instructions nobody relies on
proves nothing, while a usage record is the loop actually being closed or
not. Each usage carries the policy version in force at the moment it
happened, so the gate replays a real decision rather than re-deriving one
against today's policy. It fails on a usage past the window, on a usage
after the answered policy version was superseded, on a usage of an
instruction with no answer on record — including an unconfirmed inference —
and on a usage naming an instruction outside the set being checked.

`--invalidate-denial-on-policy-bump` is required and has no default in
either direction. Whether a policy bump also invalidates a prior refusal is
a jurisdiction judgment this package does not make.

### `withdrawal-parity`

Withdrawing is no harder than granting. It compares the grant route and the
withdraw route a consumer measured itself, using three coarse countable
facts rather than a score, and fails when withdrawing takes more steps,
demands contacting a human that granting did not, demands an account that
granting did not, or is not offered at all.

Reopening is not a degraded path, and this gate is only the measurement
half of that. The API half is structural and lives in `./web`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran against a non-empty record set and found nothing. |
| `1` | Ran and found at least one real violation. |
| `2` | Could not run: a missing, unreadable, unparseable or schema-invalid record store; an empty record set; or a required declared value that was not supplied. |

`2` is not a variant of failure. "I checked and it is fine" and "I never
checked" are different answers, and a gate that reports the second as the
first is worse than no gate.

## API

Everything below is exported from the package root.

### Evaluating and deciding

| Export | What it does |
| --- | --- |
| `evaluateStandingInstruction` | Compares one stored answer against the policy version in force and the clock. Returns `granted`, `denied`, `absent`, or `stale`. |
| `decideStandingChange` | The pure decision core for one change: returns the new instruction and its audit event. Takes the actor and the subject as separate arguments. |
| `recordReopened` | Builds the audit event for a subject reopening their preference surface, independent of any decision made inside it. |
| `recordStaleness` | Builds the audit event for an answer found stale, with the reason as the event type. |

### The gates, as pure functions

| Export | What it does |
| --- | --- |
| `checkConfirmationCompleteness` | Gate 1, over intents, confirmations, and a declared floor. |
| `checkCurrency` | Gate 2, over instructions, usages, and the caller's denial-invalidation decision. |
| `checkWithdrawalParity` | Gate 3, over measured preference paths. |

### Validators and guards

| Export | What it does |
| --- | --- |
| `validateStandingInstruction` | Validates one untyped standing instruction. |
| `validateStandingInstructions` | Validates an untyped array of them. |
| `validateIntentRecord` | Validates one untyped intent. |
| `validateIntentRecords` | Validates an untyped array of them. |
| `validateConfirmationRecord` | Validates one untyped read-back answer. |
| `validateConfirmationRecords` | Validates an untyped array of them. |
| `validateInstructionUsages` | Validates an untyped array of usage records. |
| `validatePreferencePaths` | Validates an untyped array of measured preference paths. |
| `validateConfidenceFloor` | Validates a declared confidence floor. |
| `validatePolicyVersion` | Validates a policy-version reference. |
| `isStandingInstruction` | Boolean guard over `validateStandingInstruction`. |
| `isIntentRecord` | Boolean guard over `validateIntentRecord`. |
| `isConfirmationRecord` | Boolean guard over `validateConfirmationRecord`. |

### Vocabularies

`STANDING_PROVENANCES`, `INTENT_DISPOSITIONS`, `CONFIRMATION_VERDICTS`, and
`STANDING_AUDIT_EVENT_TYPES` are the closed lists a caller validating
untyped input needs.

### Types

The record types are `StandingInstruction`, `StandingState`,
`StandingTopic`, `StandingProvenance`, `CurrencyWindow`, `PolicyVersion`,
`IntentRecord`, `IntentDisposition`, `ConfirmationRecord`,
`ConfirmationVerdict`, `ConfidenceFloor`, `InstructionUsage`,
`PreferencePath` and `PathCost`.

The evaluation and decision types are `StandingEvaluation`,
`StandingEvaluationPolicy`, `StandingAction`, `StandingAuditEvent` and
`StandingAuditEventType`.

The host-implemented ports are `StandingInstructionStore` and
`StandingAuditLedger`. No implementation of either ships here.

Each gate returns its own result type — `ConfirmationCompletenessResult`,
`CurrencyResult`, `WithdrawalParityResult` — carrying findings typed as
`ConfirmationFinding`, `CurrencyFinding` and `WithdrawalParityFinding`,
whose kinds are `ConfirmationFindingKind`, `CurrencyFindingKind` and
`WithdrawalParityFindingKind`, and whose non-clean outcomes are named by
`ConfirmationFailureReason`, `CurrencyFailureReason` and
`WithdrawalParityFailureReason`.

Validation surfaces `ValidationIssue`, `ValidationResult` and `Validator`.

## The `./inbound` subpath

Admission on any channel, and deliberately not an HTTP handler. The
consumer owns the route, the raw body, and signature verification —
signature schemes are provider-specific and this package must not pretend
to verify what it cannot exercise. This package owns the admission
decision: dedupe, ack/reject doctrine, replay tolerance, and ordering
tolerance, as a pure function of the caller's own verification result plus
a host ledger's dedupe answer.

```ts
import { admitInboundEvent } from "@vespeneventures/butler/inbound";
```

The decision is never a bare boolean: acknowledging and processing are two
separate questions. A replay is an acknowledgement with `action: "ignore"`,
never an error. A rejection is reserved for a failed signature, so a
provider is never told to keep retrying data that will never become
processable. And a throwing ledger rejects the promise rather than
acknowledging — if durable dedupe could not run, nothing was durably
accepted, and saying otherwise would silently discard an event.

## The `./web` subpath

`useStandingWants` is a currency-aware preference-surface hook: it reads
every stored instruction for a subject once, then evaluates each requested
topic against the policy version in force and a caller-supplied `now`. An
instruction that exists, and was granted, and is past its own window comes
back `stale`, so a surface rendered from it re-asks rather than quietly
continuing.

```ts
import { useStandingWants } from "@vespeneventures/butler/web";
```

`withdraw` shares `grant`'s and `deny`'s exact call shape — one topic, one
promise, one function on the same object. That is withdrawal parity
enforced structurally at the API surface rather than asserted in prose.

React and React DOM are optional peers of this subpath specifically.
Importing the package root or `./inbound` never pulls in React. Importing
`./web` asserts the installed version against the declared range at import
time, so an absent or incompatible React fails loudly, by name, instead of
crashing later inside a hook with no version named as the cause.

## Requirements

Node 20 or newer. Zero runtime dependencies. React and React DOM are
optional peers, needed only by the `./web` subpath.

## What this package is not

- It carries no topics, no confidence floor, no currency window, no
  jurisdiction logic, and no obligations. Every one of those is a value,
  and values belong in each consumer's own repository.
- It makes **no claim of legal compliance**. It is record machinery, not
  advice.
- It ships no storage and no audit implementation. Both are ports the host
  implements, and no person-attributable record is written into this
  repository.
- `subjectId` and `actorId` are opaque host-owned references. Neither ever
  carries an email address, a name, a phone number, an address, or an IP,
  and they are separate identifiers in every signature — an actor recording
  a subject's own decision and an actor deciding on a subject's behalf must
  stay distinguishable in the audit trail.

## Licence

MIT. See [LICENSE](LICENSE).
