# @vespeneventures/comms

Contracts and provider adapters for sending finished communications. The root
export owns validation, policy, atomic dispatch claims, provider acceptance
outcomes, and normalized delivery events. The `./resend` export owns the
strict Resend mapping and webhook normalization. The package owns no
credential, sender identity, recipient directory, consent store, template,
route, or database.

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

## Resend

```ts
import { createResendAdapter, verifyResendWebhook } from "@vespeneventures/comms/resend";

const adapter = createResendAdapter({
  apiKey: () => process.env.RESEND_API_KEY,
  timeoutMs: 8_000,
});
```

Pass `adapter` as the `email` entry of `createCommunicationDispatcher`, or
call `deliver` directly with a validated `EmailMessage`. `ResendAdapterConfig`
requires an explicit API key or resolver; it has no hidden environment fallback
and no fail-silent mode.

The adapter forwards `EmailMessage.id` as Resend's idempotency key. The key
must be 1–256 characters and identify one exact payload. It is only a
provider-window defense; a durable dispatch ledger remains required for
long-lived deduplication and recovery. `timeoutMs`, when set, must be a
positive finite number; it bounds the caller's wait, not the provider's
eventual processing, so retry the same id and payload after a timeout.

`headers`, `cc`, `bcc`, `replyTo`, HTML/text bodies, and attachments map
directly. Provider tags are normalized to ASCII letters, numbers, underscores,
and dashes. Two names that collide after normalization fail explicitly. Host-only
`EmailMessage.context` is never transmitted.

Provider and configuration failures throw `ResendCommunicationError`, a
provider-specific subclass of `CommunicationDeliveryError`. Configuration and
validation failures are not retryable; timeouts, network failures, rate limits,
and server errors are retryable. Preserve the same id and payload when retrying.

### Resend webhooks

```ts
const verified = await verifyResendWebhook({
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
  payload: await request.text(),
  headers: {
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  },
});

if (verified.kind === "delivery") {
  await durableDeliveryLedger.apply(verified.event);
}
```

Verification must receive the exact raw body. Parse or mutate nothing first;
verification is local and does not require a sending API key. Results are
`delivery` (a normalized `DeliveryEvent`), `inbound` (a privacy-minimal
`InboundCommunicationEvent` for `email.received`), or `ignored` (a correctly
signed event this package does not own). Hosts should acknowledge ignored and
duplicate events so providers do not retry them.

The host route owns HTTP status mapping and storage. Fail closed when the
webhook secret or durable ledger is unavailable; return a retryable server
error when durable apply fails. Endpoint registration, event subscriptions,
credentials, domains, and sender identities remain provider settings owned by
the deploying host.

## Root API

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

## `./resend` API

Import the following from `@vespeneventures/comms/resend`.

| Export | Kind | Purpose |
| --- | --- | --- |
| `createResendAdapter(config)` | function | Creates the strict outbound Resend email adapter. |
| `verifyResendWebhook(input)` | function | Verifies the exact raw Svix body and returns a mapped signed event. |
| `ResendCommunicationError` | class | Provider-specific normalized error with retryability and optional status code. |
| `ResendAdapterConfig` / `ResendApiKey` | types | Explicit outbound credential, timeout, and client-construction contract. |
| `ResendClient` / `ResendClientFactory` / `ResendWebhookClientFactory` / `ResendEmailPayload` / `ResendApiError` | types | Narrow SDK seams for testing and alternate construction. |
| `VerifyResendWebhookInput` / `ResendWebhookHeaders` / `ResendWebhookEvent` | types | Raw-body webhook verification input and result. |

## Requirements

Node 20+. ESM only. Runtime dependency: the official `resend` SDK. The root
contracts do no I/O; the `./resend` adapter performs provider calls only when
the host invokes it.

## Licence

MIT
