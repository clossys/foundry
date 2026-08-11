# @vespeneventures/comms

Provider-neutral contracts for sending finished communications. The package
owns validation, policy, atomic dispatch claims, provider acceptance outcomes,
and normalized delivery events. It owns no provider SDK, credential, sender
identity, recipient directory, consent store, template, route or database.

```bash
npm install @vespeneventures/comms
```

## Usage

```ts
import { createCommunicationDispatcher, type CommunicationDispatchLedger } from "@vespeneventures/comms";

const ledger: CommunicationDispatchLedger = createDurableLedger(database);
const dispatcher = createCommunicationDispatcher({
  adapters: { email: emailAdapter },
  policy: (message) => consentAllows(message)
    ? { outcome: "allow" }
    : { outcome: "deny", reason: "consent_withdrawn" },
  ledger,
});

const result = await dispatcher.dispatch({
  id: "account-invitation/user-123",
  event: "account.invitation.created",
  category: "security",
  channel: "email",
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "You are invited",
  text: "Open the invitation.",
  html: "<p>Open the invitation.</p>",
  tags: [{ name: "event", value: "account-invitation-created" }],
});

if (result.state === "accepted") {
  console.log(result.acceptance.messageId);
}
```

`accepted` means the provider accepted responsibility for the request. It does
not mean delivery to a recipient's mail server or inbox. Final lifecycle state
arrives later as a verified `DeliveryEvent` and belongs in a durable
`DeliveryEventLedger`.

## Boundaries

- The host resolves recipients, renders/localizes content, chooses a sender,
  evaluates consent and preferences, injects credentials, and implements both
  durable ledgers.
- A provider adapter maps the finished `EmailMessage`, returns a non-empty
  `ProviderAcceptance`, and normalizes provider failures.
- This package calls policy before the ledger or adapter. A denied message is
  `skipped`; missing adapters and transport failures are explicit `failed`
  results. There is no empty or fail-silent success state.
- `EmailMessage.context` is host-only observability data. Adapters must not
  transmit it implicitly. Avoid recipient addresses and message bodies in
  logs; prefer `id`, `event`, `category`, provider ids and safe tags.

One dispatch call carries exactly one channel-ready message. A product that
wants email and SMS creates two messages with channel-scoped stable ids. This
keeps retry checkpoints independent instead of forcing untyped channel data
through a shared metadata bag.

## Ledger semantics

`CommunicationDispatchLedger.claim` must atomically return either a unique
`CommunicationDispatchClaim` lease or `CommunicationDuplicateClaim`. Its
opaque `leaseId` lets `complete` reject stale workers after a claim expires.
The durable implementation decides when failed or abandoned work becomes
claimable again. Provider idempotency is a second line of defense, not a
replacement for this ledger.

`DeliveryEventLedger.apply` is deliberately one atomic operation: deduplicate
the provider-scoped `(provider, eventId)`, append the event, and advance the current message state
only when its provider timestamp wins the host's ordering rule. Providers may
deliver the same webhook more than once and out of order.

Test-only single-process fakes are available from a separate subpath:

```ts
import { createMemoryDeliveryEventLedger, createMemoryDispatchLedger } from "@vespeneventures/comms/testing";
```

`MemoryDispatchLedger` exposes recorded results and retries failures;
`MemoryDeliveryEventLedger` exposes recorded events and deduplicates provider-scoped event ids.
Neither is durable or suitable for production.

| Testing subpath export | Purpose |
| --- | --- |
| `createMemoryDispatchLedger()` / `MemoryDispatchLedger` | Single-process retry and deduplication fake. |
| `createMemoryDeliveryEventLedger()` / `MemoryDeliveryEventLedger` | Single-process provider-event fake. |

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createCommunicationDispatcher(config)` | function | Builds the policy, claim, adapter, completion and observability pipeline. |
| `validateCommunicationMessage(message)` | function | Returns `CommunicationFinding` values without doing I/O. |
| `assertValidCommunicationMessage(message)` | function | Throws `CommunicationValidationError` when validation finds a problem. |
| `CommunicationDeliveryError` | class | Provider-neutral adapter error with code, retryability and optional provider. |
| `CommunicationValidationError` | class | Structured message-validation error carrying all findings. |
| `EmailMessage` / `EmailAttachment` / `CommunicationTag` | types | The finished email contract and its portable parts. |
| `CommunicationMessage` / `CommunicationChannel` | types | The currently supported message union and channel vocabulary. |
| `CommunicationAdapter` / `ProviderAcceptance` | types | Provider adapter port and explicit acceptance evidence. |
| `CommunicationPolicy` / `CommunicationPolicyDecision` | types | Host consent, preference and sender-policy seam. |
| `CommunicationDispatcher` / `CommunicationDispatcherConfig` | types | Dispatcher instance and construction contract. |
| `CommunicationDispatchLedger` / `CommunicationDispatchClaim` / `CommunicationDuplicateClaim` | types | Durable atomic claim, lease and completion port. |
| `CommunicationDispatchResult` / `CommunicationDispatchState` / `CommunicationFailure` | types | Structured terminal dispatch outcome. |
| `CommunicationFinding` | type | One validation issue with a field and message. |
| `DeliveryEvent` / `DeliveryEventType` / `DeliveryEventLedger` | types | Provider-neutral final-delivery lifecycle and atomic durable apply port. |
| `InboundCommunicationEvent` | type | Privacy-minimal signal that a provider received a message; retrieval stays host-owned. |

## Requirements

Node 20+. ESM only. No runtime dependencies and no I/O.

## Licence

MIT
