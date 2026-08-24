# `@vespeneventures/influencer`

Influencer operates a declared organization or product presence and improves
independently verified qualified audience response. This package is currently
**source-only and unpublished**.

The durable job question is:

> Is this governed outbound presence producing qualified audience responses at
> the declared rate?

The package does not manufacture a persona, impersonate a person, generate or
approve content, hold credentials, or define what a qualified response means.
`PresenceSubjectKind` contains only `organization` and `product`, and every
installation must set `impersonationProhibited: true`.

## Metric and loop

Influencer's canonical primary loop mode is **optimize** and its secondary
loop mode is **fulfill**. Optimize owns the content/channel/cadence learning
cycle; fulfill is the internal action mechanism that makes one bounded presence
intent real.

```text
qualified response yield per thousand
= 1,000 × independently observed qualified responses
  / independently observed eligible exposures
```

The unit is qualified responses per 1,000 exposures and the desired direction
is up. Each response must have a unique event id, match a consumer-declared
qualified action kind, join exactly to its experiment/content/publication, and
occur inside the declared measurement window. A readable response source that
found no events is a measured zero. No due window, insufficient exposure, an
unreadable source, or unjoinable evidence is indeterminate—not a clean result.

The five universal stages are concrete here:

1. **Sense:** read the installed strategy/audience revision, approved content
   candidates, channel readiness, cadence history, publication join keys, and
   independent exposure/response evidence.
2. **Judge:** validate the current intent-bound authority and zero-spend
   guardrail, then apply the consumer's decision policy to a bounded
   audience/channel/content/cadence hypothesis.
3. **Act:** atomically claim and execute `configure-presence`, `publish`, or
   `reply` through the injected `PresenceActuator`; replies require an opaque
   inbound-admission evidence id.
4. **Verify:** durably complete the action, re-read external outcomes, and
   compute response yield against the installed setpoint.
5. **Learn or escalate:** persist a superseding experiment, close, pause, or
   hand off. The package may propose upstream changes but never rewrites
   strategy, copy, design, or authority by itself.

## Consumer binding

`validatePresenceInstallation()` requires the values that make the role an
installed position rather than an empty mission document:

- business metric node and causal hypothesis;
- organization/product subject, audience, strategy revision, channels, and
  channel-readiness evidence;
- qualified action vocabulary, setpoint, sample floor, attribution window,
  evaluation cadence, and exposure/response evidence sources;
- allowed actions and current authority source;
- content-policy, cadence, and anti-impersonation guardrails;
- durable experiment, action, and outcome stores; and
- responsible owner and escalation route.

`paidSpendCeiling` is the literal value `0` in both `PresenceInstallation` and
`PresenceAuthorityEvidence`. V1 cannot express, validate, or execute paid
distribution. Paid media requires later requalification; no provider adapter
or credential resolver ships here.

## Action runtime

```ts
import {
  createInfluencer,
  type PresenceActionLedger,
  type PublishIntent,
} from "@vespeneventures/influencer";

declare const ledger: PresenceActionLedger;

const influencer = createInfluencer({
  ledger,
  authority: async () => ({ state: "authorized" }),
  actuator: {
    async execute(intent) {
      // The consumer owns this provider integration and its credentials.
      return {
        provider: "configured-provider",
        remoteActionId: intent.id,
        observedAt: "2026-08-23T10:00:01.000Z",
      };
    },
  },
});

const intent: PublishIntent = {
  id: "intent-one",
  installationId: "presence-one",
  subjectId: "product-one",
  experimentId: "experiment-one",
  channelId: "channel-one",
  actionKind: "publish",
  requestedAt: "2026-08-23T10:00:00.000Z",
  authority: {
    id: "authority-one",
    intentId: "intent-one",
    subjectId: "product-one",
    actorId: "agent-one",
    humanOwnerId: "owner-one",
    allowedActions: ["publish"],
    channelIds: ["channel-one"],
    issuedAt: "2026-08-23T09:00:00.000Z",
    expiresAt: "2026-08-23T11:00:00.000Z",
    paidSpendCeiling: 0,
  },
  contentId: "approved-content-one",
  publicationId: "publication-one",
};

const result = await influencer.act(intent);
```

Claiming happens before the current authority read. A denial is durably
completed as `skipped`. An explicit `unverifiable` result, a thrown authority
read, or a malformed decision never invokes the actuator and leaves the lease
uncompleted for host-governed reclamation. `applied` proves only that the
injected actuator returned a valid observed receipt; it is not audience
response evidence.

## Response-yield gate

```bash
influencer-check response-yield response-evidence.json
```

The input is one JSON `ResponseYieldInput`: `evaluatedAt`, a positive
`setpointPerThousand`, positive `minimumExposureCount`, non-empty
`qualifiedActionKinds`, and non-empty `records`. Every record carries exact
experiment/content/publication join keys, full intent-bound
`PresenceAuthorityEvidence`, its window, and ternary `exposures` and
`responses` reads.

Exit codes are `0` satisfied, `1` measured below setpoint, and `2`
indeterminate or unable to evaluate. The pure `checkResponseYield()` produces
the same judgment without file I/O; `validateResponseYieldInput()` keeps bad
evidence separate from a measured violation.

## Boundaries

- **Strategist** owns audience, positioning, governed claims, and the business
  causal hypothesis. Influencer references their revisions.
- **Writer and Designer** own language and visual quality. Influencer selects
  approved content; it does not approve its own work.
- **Publisher** resolves, renders, and records what shipped. Influencer selects
  channel/cadence experiments and consumes publication join evidence; it ships
  no renderer or publication ledger.
- **Messenger** owns directed finished-message transport. Public algorithmic
  exposure is not recipient delivery.
- **Butler** owns person-request admission and current wants. A reply must cite
  admitted inbound evidence rather than bypass that boundary.
- **Observer** remains an independent measurer. Influencer accepts host-owned
  evidence but cannot call its own action receipt an independent outcome.
- Authorization, credential custody, topology, and provider provisioning remain
  outside this package and enter through explicit consumer ports and evidence.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `InfluencerActionError` | class | Normalized actuator failure |
| `InfluencerValidationError` | class | Structured invalid-input error |
| `createInfluencer` | function | Build claim, authority, action, and completion orchestration |
| `checkResponseYield` | function | Compute the primary metric and ternary judgment |
| `validateResponseYieldInput` | function | Validate metric evidence |
| `PRESENCE_ACTION_KINDS` | const | Closed v1 action vocabulary |
| `PRESENCE_SUBJECT_KINDS` | const | Organization/product subject vocabulary |
| `assertValidPresenceActionIntent` | function | Throw for invalid action authority or payload |
| `validatePresenceActionIntent` | function | Validate one action intent |
| `validatePresenceExperiment` | function | Validate one versioned experiment |
| `validatePresenceInstallation` | function | Validate the complete consumer binding |
| `AudienceResponseEvent` | type | Independently observed joined audience response |
| `CompletedPresenceActionResult` | type | Durable applied, failed, or skipped result |
| `ConfigurePresenceIntent` | type | Desired-presence revision action |
| `CountObservation` | type | Ternary exposure evidence |
| `Influencer` | type | Action runtime interface |
| `InfluencerConfig` | type | Required authority, actuator, and ledger ports |
| `PresenceActionClaim` | type | Opaque action lease |
| `PresenceActionDuplicate` | type | Duplicate claim result |
| `PresenceActionFailure` | type | Normalized action failure |
| `PresenceActionIntent` | type | Closed v1 action-intent union |
| `PresenceActionKind` | type | Configure, publish, or reply action |
| `PresenceActionLedger` | type | Atomic claim and durable completion port |
| `PresenceActionReceipt` | type | Injected actuator's observed receipt |
| `PresenceActionResult` | type | Applied, failed, skipped, duplicate, or unverifiable result |
| `PresenceActuator` | type | Consumer-owned provider action port |
| `PresenceAuthorityDecision` | type | Authorized, denied, or unverifiable judgment |
| `PresenceAuthorityEvidence` | type | Intent-bound zero-spend delegated authority |
| `PresenceAuthorityPolicy` | type | Required current authority reader |
| `PresenceChannelBinding` | type | Consumer channel/account/readiness binding |
| `PresenceExperiment` | type | Versioned audience/channel/content/cadence hypothesis |
| `PresenceInstallation` | type | Complete consumer-specific position binding |
| `PresenceSubjectKind` | type | Organization or product only |
| `PublishIntent` | type | Approved-content publication action |
| `ReplyIntent` | type | Admitted-inbound reply action |
| `ResponseObservation` | type | Ternary independent response evidence |
| `ResponseYieldInput` | type | Gate input and metric setpoint |
| `ResponseYieldRecord` | type | Governed publication evidence window |
| `ResponseYieldResult` | type | Metric components and ternary result |
| `ValidationFinding` | type | Structured validation finding |

Node 20 or newer. Zero runtime dependencies. MIT licensed.
