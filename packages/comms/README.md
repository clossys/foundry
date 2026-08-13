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

> **`dispatch()` never rejects on a transport failure.** A genuine send
> failure still resolves the returned promise — as `state: "failed"` with a
> populated `failure`, not a thrown error. **A resolved promise is not
> success.** `await dispatch(message)` completing tells you nothing on its
> own; you must branch on `result.state` before reading `result.acceptance`
> or treating the message as sent. Code that only does
> `await dispatch(message)` and moves on silently drops failed sends.

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

`complete` is called for every claimed attempt, including failed ones, with
the full `CommunicationDispatchResult` — so `result.failure.retryable` is
available at that call and `complete` must act on it:

- `state: "accepted"`, `state: "skipped"`, `state: "duplicate"`, or
  `state: "failed"` with `failure.retryable === false` are **terminal**.
  `complete` must record the id as permanently done so a later `claim` for
  the same id returns `duplicate`.
- `state: "failed"` with `failure.retryable === true` is **not** terminal.
  `complete` must leave the id reclaimable — a future `claim()` for the same
  id must be able to succeed again — instead of recording it as permanently
  complete. A host that marks a retryable failure complete the same way it
  marks a success complete permanently blocks the retry: `claim`'s dedup
  check will report every subsequent attempt as `duplicate`, and the message
  never sends.

This interacts with lease/TTL reclamation: whatever mechanism reclaims an
abandoned claim (see below) is also what makes a retryable failure claimable
again, if `complete` releases the claim rather than tracking retry
eligibility itself. Either way, a TTL shorter than the time a retryable
failure needs to actually be retried races the retry — the lease can expire
and be reclaimed by a second worker while the first worker's retry is still
in flight, producing a duplicate send instead of a clean retry. Size TTLs
against the slowest realistic retry path, not the common case.

`DeliveryEventLedger.apply` is deliberately one atomic operation: deduplicate
the provider-scoped `(provider, eventId)`, append the event, and advance the current message state
only when its provider timestamp wins the host's ordering rule. Providers may
deliver the same webhook more than once and out of order.

## Reference ledger implementation

This package ships no ledger implementation — both ports are host-owned by
design (see Boundaries). The sketch below is a **reference only**, to make
the atomicity and retryable-handling requirements above concrete; it is not
exported, not tested by this package, and not something you can import. Copy
the shape, adapt it to your database, and cover it with your own host-side
tests.

### Schema sketch (Postgres)

```sql
create table communication_dispatch_claims (
  message_id   text primary key,
  lease_id     text not null,
  status       text not null check (status in ('claimed', 'complete')),
  retryable    boolean,               -- null until a terminal outcome lands
  claimed_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table delivery_events (
  provider           text not null,
  event_id           text not null,
  provider_message_id text not null,
  occurred_at        timestamptz not null,
  type                text not null,
  primary key (provider, event_id)    -- makes apply()'s dedup atomic
);

create table delivery_state (
  provider_message_id text primary key,
  current_type         text not null,
  current_occurred_at  timestamptz not null
);
```

The `communication_dispatch_claims.message_id` primary key is what makes
`claim()` atomic: a second worker's insert for the same id either fails
(row already exists) or, once a row is `status = 'complete'`, is rejected by
the application check before it ever races a real write. The
`delivery_events` primary key on `(provider, event_id)` does the equivalent
job for `apply()`.

### `CommunicationDispatchLedger`

```ts
const ledger: CommunicationDispatchLedger = {
  async claim(message) {
    return db.transaction(async (tx) => {
      const existing = await tx.query(
        "select status, retryable from communication_dispatch_claims where message_id = $1 for update",
        [message.id],
      );
      // A prior attempt is only reclaimable if it failed retryably; a
      // terminal row (success, non-retryable failure, skip, or an earlier
      // duplicate) is a hard stop.
      if (existing && (existing.status === "complete" && existing.retryable !== true)) {
        return { outcome: "duplicate" as const };
      }
      const leaseId = crypto.randomUUID();
      await tx.query(
        `insert into communication_dispatch_claims (message_id, lease_id, status)
         values ($1, $2, 'claimed')
         on conflict (message_id) do update set lease_id = excluded.lease_id, status = 'claimed', claimed_at = now()`,
        [message.id, leaseId],
      );
      return { outcome: "claimed" as const, leaseId };
    });
  },

  async complete(claim, result) {
    const isTerminal =
      result.state === "accepted" ||
      result.state === "skipped" ||
      result.state === "duplicate" ||
      (result.state === "failed" && result.failure.retryable === false);

    await db.query(
      `update communication_dispatch_claims
       set status = $1, retryable = $2, completed_at = now()
       where message_id = $3 and lease_id = $4`,
      [
        isTerminal ? "complete" : "claimed", // retryable failure: leave reclaimable
        result.state === "failed" ? result.failure.retryable : null,
        result.messageId,
        claim.leaseId,
      ],
    );
    // A stale worker's lease_id no longer matches — the update above
    // affects zero rows, so a newer attempt's result is never overwritten.
  },
};
```

A separate reclaim sweep (a scheduled job, or a check inside `claim` itself)
releases rows whose `status = 'claimed'` and `claimed_at` is older than the
TTL, so a worker that crashed mid-delivery does not strand the id forever.
Size that TTL against the slowest realistic retry, per the note above — an
in-flight retryable-failure retry must not still be running when the TTL
reclaims its row out from under it.

### `DeliveryEventLedger`

```ts
const deliveryLedger: DeliveryEventLedger = {
  async apply(event) {
    return db.transaction(async (tx) => {
      const inserted = await tx.query(
        `insert into delivery_events (provider, event_id, provider_message_id, occurred_at, type)
         values ($1, $2, $3, $4, $5)
         on conflict (provider, event_id) do nothing
         returning provider_message_id`,
        [event.provider, event.eventId, event.providerMessageId, event.occurredAt, event.type],
      );
      if (inserted.rowCount === 0) return "duplicate" as const;

      // Advance current state only if this event is not older than what's
      // recorded — providers may redeliver out of order.
      await tx.query(
        `insert into delivery_state (provider_message_id, current_type, current_occurred_at)
         values ($1, $2, $3)
         on conflict (provider_message_id) do update
           set current_type = excluded.current_type,
               current_occurred_at = excluded.current_occurred_at
           where delivery_state.current_occurred_at <= excluded.current_occurred_at`,
        [event.providerMessageId, event.type, event.occurredAt],
      );
      return "applied" as const;
    });
  },
};
```

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

Node 20+. ESM only. The root contracts have no runtime dependency and do no
I/O. `./resend` needs the official `resend` SDK installed as a peer
dependency (`peerDependenciesMeta` marks it optional) — install it only if
you import `./resend`; a consumer that stays on the provider-neutral root
never installs it.

## Licence

MIT
