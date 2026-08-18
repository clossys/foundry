# @vespeneventures/observer

Telemetry contracts, redaction as a tested contract, and gate efficacy
measured from caller-supplied run history. The measurer, never the
measured: this package computes whether a gate is working and never judges
a change itself.

```bash
npm install @vespeneventures/observer
```

## The job

`observer` measures what actually happened — including whether the gates
caught anything. That is four things:

- **Telemetry contracts** — an event shape (`TelemetryEvent`), a declared
  retention window, a redaction rule that ships with a test instead of a
  comment, and an explicit declaration of where the log actually lives.
- **Retention** — a stated window (`TELEMETRY_RETENTION_WINDOW_DAYS`), not
  left to each consuming plane to invent independently.
- **Redaction** — a tested contract (see "Redaction is tested, not
  asserted" below), not a setting configured elsewhere and hoped to apply.
- **Gate efficacy** — for each declared gate: did it run, what did it
  conclude, and did anything reach the default branch that it should have
  stopped.

## Why this package is separate from the gate it measures

The measurer must not be the measured. `inspector` (this catalogue's gate
package) judges a change before it lands; `observer` decides whether that
gate is worth having. Folding audit into the gate would let the system
grade its own homework — the failure that produced a gate printing an
incomplete verdict and exiting `0`, and the reason a five-way consolidation
of this catalogue was rejected on structural grounds rather than taste (see
the program issue for the full argument).

`observer` is independent of `inspector` **by construction**, not by
convention: this package has no dependency on any gate package, imports no
gate's verdict logic, and computes every metric purely from data the caller
supplies. `gate-efficacy.ts` reads run history through an injected
`RunHistoryReader` port — this package ships zero implementations of that
port, calls no API, and touches no live source. A caller wires its own
reader against whatever run-history source its plane actually has.

Escape rate (see below) goes one step further: the ground truth for
whether a landed change actually violated a rule (`LandedChangeOutcome.violation`)
is documented as the caller's own, independently-sourced judgment — an
audit, an incident report, a downstream detector — never the gate's own
recorded verdict for that run. Feeding a gate's verdict back in as ground
truth would make this package measure whether the gate agrees with itself.

## Two metrics, reported separately and never combined

1. **Unobserved surface** (`computeUnobservedSurface`) — declared subjects
   producing no telemetry.
2. **Escape rate** (`computeEscapeRate`) — changes that reached the default
   branch and violated a rule, divided by changes that landed.

Escape rate is the number that closes the gate's loop; `inspector` may not
compute it, which is the whole reason gate efficacy lives here instead.

These two are reported as separate, structurally incompatible shapes —
`EscapeRateMetric` and `UnobservedSurfaceMetric` — and this package exports
no function that accepts both. The two types share no field name besides
their `kind` discriminant, proven at compile time in `metrics.check.ts` and
re-checked at runtime in `metrics-non-combination.test.ts`. A single
blended number would hide exactly the case these two metrics exist to
separate: a gate that is silent because nothing is watching it, which reads
identically to a gate that is silent because nothing goes wrong, unless the
two stay apart.

## The three-state read: `observed` / `unobserved` / `could-not-read`

Every read in this package returns an `Observation<T>` — a discriminated
union enforced in the types, not left to a caller's discipline:

- `observed` — a real read succeeded and found something. Carries the
  observed payload.
- `unobserved` — a real read succeeded and genuinely found nothing.
- `could-not-read` — the read itself failed, or was never possible with the
  credential this run holds. **Required** to carry a `note` explaining why.

`could-not-read` is load-bearing: run history and telemetry stores are
frequently not readable by script without a credential the plane does not
have. It must report as `could-not-read` and never collapse into `observed`
or into a pass — a gate that cannot see is not a gate that saw nothing. The
`Observation<T>` type makes a narrower or looser result fail to compile: you
cannot construct a `could-not-read` with the payload already attached, or an
`observed` with no payload at all — see `observation.test.ts`. The same
principle governs `unobserved-surface.ts`'s handling of a subject with no
read supplied at all: it is treated as `could-not-read`, never as
`unobserved` — "nobody checked" must never silently become "checked, and
found nothing".

## The loop and its close condition

- **aim** — nothing happens unseen, and every gate's value is known.
- **sense** — read run history and the plane's own telemetry store, through
  caller-supplied data and an injected `RunHistoryReader` port.
- **judge** — `observed` / `unobserved` / `could-not-read`.
- **act** — emit efficacy per gate (`computeGateEfficacy`, `computeEscapeRate`)
  and the unobserved surface (`computeUnobservedSurface`).
- **learn** — a gate with a zero catch rate over a long window is either
  redundant or broken, and `computeEscapeRate`'s output over time is what
  makes that distinction testable rather than a hunch.

The loop closes when a gate's `escapeRate` can be computed from real,
independently-sourced landed-change outcomes and that number moves in
response to real gate changes — not when this package's own tests are
green. See `OBSERVER_TELEMETRY_LOG_SURFACE` and the "Redaction is tested,
not asserted" section below for why a green offline check here is
deliberately not treated as evidence of anything beyond this package's own
contract.

## Redaction is tested, not asserted

Redaction has already been found **inert** in a shipped configuration in
this fleet — configured, believed working, doing nothing. A comment
claiming "this field is redacted" cannot catch that; only a test that
inspects the actual output can.

`redactEvent` overwrites every attribute key named in an event's own
`redactedFields` with `REDACTION_PLACEHOLDER`. The three serialization
functions this package ships — `serializeEventAsJSON`,
`serializeEventAsLogLine`, `serializeEventAsCsvRow` — each call `redactEvent`
internally before producing any output, so there is no exported path from
`TelemetryEvent` to text that skips it.

`redaction.test.ts` is the actual proof: it constructs an event with a
secret-shaped value in a redacted field, serializes it through every form
above (`serializeEventAllForms`), and asserts the secret string is not a
substring of any output — checked against the raw text, never by calling
the redaction function again (which would only prove it agrees with
itself). A companion assertion proves the test is not vacuous by confirming
a non-redacted, secret-shaped control value **does** survive serialization
in the same run — ruling out "everything gets blanked" as the reason the
real secret disappears.

## `liveStateSurface`, a deliberate duplicate of controller's canonical copy

`live-state.ts` carries the `liveStateSurface` shape from issue #255:
`store`, `readableByScript` (an explicit boolean, never implicit),
`readableBy` / `reconciledBy`, and a **required** `note` stating that a
green offline check is not evidence the work is live.

The canonical home for this shape is
`@vespeneventures/controller/conventions` (see `live-state-reconciliation.md`
in that package's shipped convention documents). `controller` owns every
rule this repository's tiers share and has no dependency of its own, so
`builder` — which already depends on `controller` — re-exports its copy
rather than keeping a second one. `observer` is the deliberate exception:
this package's own contract is [zero runtime dependencies](#requirements),
and adding `controller` as a dependency to remove five frozen strings and
one small interface would spend that property to dedupe less code than it
takes to explain why the duplication exists — so this file keeps its own
copy on purpose, kept in sync by hand with controller's `LiveStateSurfaceDeclaration`
/ `LIVE_STATE_SURFACE_FINDING_KINDS` / `validateLiveStateSurfaceDeclaration`,
and says so in its own header comment for a reviewer to check future changes
against.

This package ships its own honest declaration,
`OBSERVER_TELEMETRY_LOG_SURFACE`: `observer` defines the event shape, the
retention window, and the redaction rule, but owns no telemetry store of
its own. Where events built to this contract are actually persisted is the
consuming plane's own infrastructure, declared in that plane's own
`liveStateSurface`. `validateLiveStateSurface` checks a declaration's
internal consistency offline; it never asks whether the declared store is
real, because that is exactly the live half a script frequently cannot
read. `liveStateFindingKinds` mirrors the generalized finding-kind
vocabulary controller names once, including `declared-but-not-verifiable` —
the addition that matters most, for a reconciliation surface that cannot
currently read live state.

## Naming note, recorded deliberately

`observer` collides with an established pattern name in this ecosystem —
the observer pattern, and the platform APIs named after it. The collision
was raised, weighed, and accepted: within this catalogue the register is
human jobs, and every sibling name (`controller`, `inspector`, `builder`,
`integrator`, `locksmith`) reads that way too. Recording the decision here
is deliberate, so a future reader finds a decision rather than an
oversight.

## Usage

### Redaction

```ts
import {
  redactEvent,
  serializeEventAsJSON,
  serializeEventAllForms,
  type TelemetryEvent,
} from "@vespeneventures/observer";

const event: TelemetryEvent = {
  id: "evt-1",
  subject: "gate:secret-scan",
  kind: "gate-run",
  occurredAt: new Date().toISOString(),
  attributes: { token: "ghp_...", changeId: "pr-1234" },
  redactedFields: ["token"],
};

serializeEventAsJSON(event); // token never appears in the output
```

### Gate efficacy, over an injected reader

```ts
import {
  computeGateEfficacy,
  type RunHistoryReader,
} from "@vespeneventures/observer";

// You supply this. observer ships no implementation and calls no API.
const reader: RunHistoryReader = {
  readRunHistory: async (gate) => {
    const records = await myPlaneOwnRunHistoryQuery(gate);
    if (records === undefined) {
      return { state: "could-not-read", note: "no read-access to this CI provider's API from this run" };
    }
    return { state: "observed", records };
  },
};

const report = await computeGateEfficacy("secret-scan", reader, landedChangeOutcomes);
```

### The two metrics

```ts
import {
  computeEscapeRate,
  computeUnobservedSurface,
} from "@vespeneventures/observer";

const escapeRate = computeEscapeRate("secret-scan", landedChangeOutcomes);
const unobservedSurface = computeUnobservedSurface(declaredSubjects, presenceReads);

// escapeRate and unobservedSurface are never combined into one number.
```

## API

| Export | Kind | Description |
| --- | --- | --- |
| `ObservationState` | type | `"observed" \| "unobserved" \| "could-not-read"`. |
| `Observation<T>` | type | The discriminated read result every function in this package returns. |
| `isObserved(observation)` | function | Type guard narrowing to the `observed` branch. |
| `isUnobserved(observation)` | function | Type guard narrowing to the `unobserved` branch. |
| `isCouldNotRead(observation)` | function | Type guard narrowing to the `could-not-read` branch. |
| `LiveStateSurface` | type | The `liveStateSurface` shape from issue #255: `store`, `readableByScript`, `readableBy?`, `reconciledBy?`, `note`. |
| `LiveStateFindingKind` | type | One entry of `liveStateFindingKinds`. |
| `liveStateFindingKinds` | value | The generalized finding-kind vocabulary from issue #255, including `declared-but-not-verifiable`. |
| `validateLiveStateSurface(surface)` | function | Offline structural validation of one `LiveStateSurface` declaration. |
| `OBSERVER_TELEMETRY_LOG_SURFACE` | value | This package's own `LiveStateSurface` declaration — it owns no telemetry store. |
| `TelemetryAttributeValue` | type | `string \| number \| boolean \| null`. |
| `TelemetryEvent` | type | The telemetry event shape: `id`, `subject`, `kind`, `occurredAt`, `attributes`, `redactedFields`. |
| `TELEMETRY_RETENTION_WINDOW_DAYS` | value | The declared retention window, `90`. |
| `isWithinRetentionWindow(occurredAt, now?)` | function | Whether a timestamp falls inside the retention window. |
| `validateTelemetryEvent(event)` | function | Offline structural validation of one `TelemetryEvent`. |
| `REDACTION_PLACEHOLDER` | value | The literal string a redacted attribute becomes. |
| `redactEvent(event)` | function | Returns a copy of `event` with every `redactedFields` key overwritten. |
| `serializeEventAsJSON(event)` | function | JSON form. Redacts internally. |
| `serializeEventAsLogLine(event)` | function | Single-line log form. Redacts internally. |
| `serializeEventAsCsvRow(event)` | function | CSV-row form. Redacts internally. |
| `serializeEventAllForms(event)` | function | All three forms above, as an array. |
| `GateRunRecord` | type | One row of caller-supplied run history: `gate`, `changeId`, `ran`, `verdict?`. |
| `GateRunHistoryObserved` | type | The payload an observed `GateRunHistoryRead` carries: `records`. |
| `GateRunHistoryRead` | type | `Observation<GateRunHistoryObserved>`. |
| `RunHistoryReader` | type | The injected port: `readRunHistory(gate)`. No implementation ships here. |
| `GateEfficacyReport` | type | `computeGateEfficacy`'s result: run tallies, verdict counts, and a nested `EscapeRateMetric`. |
| `computeGateEfficacy(gate, reader, outcomes)` | function | Reads run history through `reader`, tallies it, and folds in `computeEscapeRate`. |
| `LandedChangeOutcome` | type | One landed change's caller-sourced ground truth: `gate`, `changeId`, `violation`. |
| `EscapeRateMetric` | type | `computeEscapeRate`'s result: `landedCount`, `escapedCount`, `cleanCount`, `couldNotReadCount`, `rate`. |
| `computeEscapeRate(gate, outcomes)` | function | Escaped ÷ landed, for one gate. |
| `DeclaredSubject` | type | One subject a plane declares it expects telemetry from: `id`, `description?`. |
| `TelemetryPresence` | type | `Observation<{ eventCount: number }>`. |
| `SubjectTelemetryRead` | type | One subject's presence read: `subject`, `presence`. |
| `UnobservedSurfaceMetric` | type | `computeUnobservedSurface`'s result: `declaredCount`, `observed`, `unobserved`, `couldNotRead`. |
| `computeUnobservedSurface(declared, reads)` | function | Sorts declared subjects into observed / unobserved / could-not-read. |

## Non-Goals

- **Does not implement a run-history reader.** `RunHistoryReader` is a port;
  this package ships zero implementations and calls no API, on purpose.
- **Does not implement a telemetry store.** `OBSERVER_TELEMETRY_LOG_SURFACE`
  says so explicitly. This package defines the contract a store would be
  written against, not the store itself.
- **Does not judge changes.** No function here decides whether a change
  violates a rule. `LandedChangeOutcome.violation` is always caller-supplied
  ground truth.
- **Never imports a gate package.** See "Why this package is separate from
  the gate it measures" above.

## Requirements

Node.js >= 20. Zero runtime dependencies. Zero I/O — every function in this
package is a pure function of its arguments.

## License

MIT
