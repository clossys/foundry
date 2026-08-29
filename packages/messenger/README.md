# `@clossys/messenger`

Messenger delivers authorized, finished communications and closes the loop on
independently observed outcomes.

The durable role charter is deliberately narrower than any one installation:

- Messenger owns transport policy enforcement, retry-safe dispatch, normalized
  outcome evidence, and the timely verified delivery rate.
- The consumer supplies the business metric node, delivery setpoint, current
  authorization policy, evidence source, budget, guardrails, and escalation
  path.
- Message composition, localization, recipient selection, and the decision that
  a message ought to exist happen before this package receives a `DeliveryIntent`.
- Provider acceptance is not delivery. Only independently observed delivery
  evidence can close the role's outcome loop.

## Metric and loop

Messenger operates in **fulfill** mode. Its primary controllable metric is:

```text
timely verified delivery rate
= authorized delivery intents due that were independently observed delivered within their declared window
  / all authorized delivery intents due
```

An intent becomes due when its `windowClosesAt` is at or before `evaluatedAt`.
If no intent is due, the value is `null` and the judgment is `indeterminate`—
never a synthetic 100% pass.

The universal loop is concrete here:

1. **Sense:** accept finished `DeliveryIntent` records and signed provider
   outcome events.
2. **Judge:** validate the intent, require durable authorization evidence,
   atomically claim its stable id, and ask the installation's current
   `AuthorizationPolicy`.
3. **Act:** durably close a denial or invoke the configured provider adapter
   with the stable intent id.
4. **Verify:** normalize independently received outcome events and compare due
   intents with their declared windows.
5. **Learn or escalate:** expose missing, late, and failed intent ids so the
   installation can retry, reroute, change policy, or escalate.

## Install

```bash
npm install @clossys/messenger
```

The package is published to GitHub Packages, so consumers must map the
`@clossys` scope and provide a token with `read:packages` — see the
repository root README.

The provider-neutral root has no runtime dependencies. The optional
`./providers/resend` subpath requires a consumer-installed `resend@^6.19.0`
peer. Importing the root does not import that SDK.

## Dispatch an authorized intent

```ts
import {
  createMessenger,
  type DispatchLedger,
  type DeliveryIntent,
} from "@clossys/messenger";

declare const ledger: DispatchLedger;

const messenger = createMessenger({
  adapters: {
    email: {
      channel: "email",
      async deliver(message) {
        // Call a provider using message.id as its idempotency key.
        return { provider: "configured-provider", messageId: message.id };
      },
    },
  },
  policy: async (intent) =>
    intent.authorization.policy === "transactional-v1"
      ? { outcome: "allow" }
      : { outcome: "deny", reason: "policy-not-current" },
  ledger,
});

const intent: DeliveryIntent = {
  message: {
    id: "order-confirmation-123",
    event: "order.confirmed",
    category: "transactional",
    channel: "email",
    from: "orders@example.com",
    to: ["recipient@example.com"],
    subject: "Order confirmed",
    text: "Your order is confirmed.",
  },
  authorization: {
    id: "authorization-123",
    intentId: "order-confirmation-123",
    policy: "transactional-v1",
    authorizedAt: "2026-08-23T10:00:00.000Z",
  },
  windowOpensAt: "2026-08-23T10:00:00.000Z",
  windowClosesAt: "2026-08-23T10:05:00.000Z",
};

const result = await messenger.dispatch(intent);
if (result.state !== "accepted") {
  // Retry or escalate according to the installation's declared path.
}
```

`policy` and `ledger` are required. There is no default allow and no
best-effort, unrecorded dispatch path. `DispatchLedger.claim()` must be atomic;
Messenger claims before evaluating current policy so a denied attempt can be
durably completed as `skipped`. Reauthorization after that terminal denial
requires a new stable intent id. `complete()` must durably record every claimed
terminal result. A thrown or malformed policy judgment is not a terminal result:
it remains fail-closed and reclaimable under the host's lease rules. A retryable
failure may likewise remain reclaimable, but lease rules must prevent overlapping
attempts.

## Delivery-closure gate

```bash
messenger-check delivery-closure delivery-evidence.json
```

```json
{
  "evaluatedAt": "2026-08-23T10:10:00.000Z",
  "setpoint": 0.99,
  "records": [
    {
      "intentId": "order-confirmation-123",
      "authorization": {
        "id": "authorization-123",
        "intentId": "order-confirmation-123",
        "policy": "transactional-v1",
        "authorizedAt": "2026-08-23T09:59:00.000Z"
      },
      "windowOpensAt": "2026-08-23T10:00:00.000Z",
      "windowClosesAt": "2026-08-23T10:05:00.000Z",
      "observation": {
        "eventId": "provider-event-456",
        "evidenceSource": "signed-provider-webhook",
        "outcome": "delivered",
        "observedAt": "2026-08-23T10:04:01.000Z",
        "deliveredAt": "2026-08-23T10:04:00.000Z"
      }
    }
  ]
}
```

Exit codes are `0` satisfied, `1` violated, and `2` indeterminate or unable to
evaluate. Missing, unreadable, empty, or invalid evidence exits `2`. The pure
`checkDeliveryClosure()` function produces the same judgment without file I/O.

`evidenceSource` names the consumer-bound independent source. A dispatch return
value must not be used as that source: `state: "accepted"` means only that the
provider accepted responsibility for transport.

## Resend provider

```ts
import {
  createResendAdapter,
  verifyResendWebhook,
  type ResendWebhookHeaders,
} from "@clossys/messenger/providers/resend";
```

`createResendAdapter()` accepts an explicit API key or resolver and forwards
the stable message id as the provider idempotency key. It never reads process
environment implicitly. `verifyResendWebhook()` requires the exact raw body,
the signed headers, and an explicit webhook secret; it emits privacy-minimal
`DeliveryEvent` records or an ignored result for events outside Messenger's
delivery ownership. Apply normalized events through a host-owned
`DeliveryEventLedger` keyed by provider plus event id.

## Migration from `comms`

Messenger is a job-shaped successor, not a forwarding rename:

| Donor capability | Messenger disposition |
| --- | --- |
| Finished email contract and validation | Moved to `EmailMessage`, `validateMessage()`, and `assertValidMessage()` |
| Provider-neutral dispatch | Moved to `createMessenger()` around an authorized `DeliveryIntent` |
| Atomic claim and completion | Moved to required `DispatchLedger` |
| Optional policy / default allow | Replaced by required `AuthorizationPolicy`; malformed decisions fail closed |
| Optional ledger / unrecorded delivery | Removed; durable ledger is mandatory |
| Normalized outcome events | Moved to `DeliveryEvent` and `DeliveryEventLedger` |
| Resend adapter and signed webhooks | Moved to `./providers/resend` |
| Generic inbound request admission | Omitted; person-request admission belongs to Butler |
| Reserved unimplemented channels | Omitted; the public channel type names only implemented message shapes |

There is no dependency on `comms` and no forwarding compatibility layer.
Consumers migrate deliberately, provide authorization and ledger bindings, and
switch their provider import to the new subpath.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `MessengerDeliveryError` | class | Normalized transport failure with retryability and provider context |
| `MessengerValidationError` | class | Structured invalid-message or invalid-intent error |
| `checkDeliveryClosure` | function | Compute the primary metric and ternary judgment |
| `validateDeliveryClosureInput` | function | Validate gate evidence without turning bad input into a metric failure |
| `createMessenger` | function | Build the mandatory policy, claim, transport, and completion pipeline |
| `assertValidDeliveryIntent` | function | Throw for invalid authorization, message, or window data |
| `assertValidMessage` | function | Throw for invalid finished-message data |
| `validateDeliveryIntent` | function | Return intent validation findings |
| `validateMessage` | function | Return message validation findings |
| `AuthorizationDecision` | type | Current policy allow or deny result |
| `AuthorizationEvidence` | type | Durable upstream authorization reference |
| `AuthorizationPolicy` | type | Required current-policy judgment |
| `DeliveryClosureInput` | type | Metric evaluation setpoint, instant, and evidence records |
| `DeliveryClosureRecord` | type | One intent, its full intent-bound authorization evidence, and optional independent outcome observation |
| `DeliveryClosureResult` | type | Metric value, components, state, and failure sets |
| `DeliveryEvent` | type | Privacy-minimal normalized provider outcome |
| `DeliveryEventLedger` | type | Host-owned atomic outcome-event persistence |
| `DeliveryEventType` | type | Normalized provider outcome vocabulary |
| `DeliveryFailure` | type | Normalized transport failure |
| `DeliveryIntent` | type | Authorized finished message and declared delivery window |
| `DeliveryObservation` | type | Independent outcome evidence used by the metric |
| `DispatchClaim` | type | Opaque ownership lease for an in-flight attempt |
| `DispatchLedger` | type | Required atomic claim and durable completion contract |
| `DispatchResult` | type | Accepted, failed, skipped, or duplicate transport result |
| `DuplicateClaim` | type | Ledger decision that prevents duplicate transport |
| `EmailAttachment` | type | Provider-neutral attachment content |
| `EmailMessage` | type | Finished email message shape |
| `Message` | type | Currently implemented finished-message union |
| `MessageAdapter` | type | Provider transport boundary |
| `MessageChannel` | type | Currently implemented channel vocabulary |
| `MessageTag` | type | Provider-neutral correlation tag |
| `Messenger` | type | Runtime dispatch interface |
| `MessengerConfig` | type | Required policy, ledger, adapters, and optional observer |
| `ProviderAcceptance` | type | Provider transport acceptance handle |
| `ValidationFinding` | type | Structured validation result |

The `./providers/resend` subpath exports `RESEND_DECLARED_RANGE`,
`ResendMessengerError`, `createResendAdapter`, `verifyResendWebhook`,
`ResendAdapterConfig`, `ResendApiError`, `ResendApiKey`, `ResendClient`,
`ResendClientFactory`, `ResendEmailPayload`, `ResendWebhookClientFactory`,
`ResendWebhookEvent`, `ResendWebhookHeaders`, and
`VerifyResendWebhookInput`.
