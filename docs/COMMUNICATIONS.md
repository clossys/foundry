# Communications architecture

## Decision

Foundry owns one package with provider subpaths:

| Owner | Responsibility |
| --- | --- |
| `@vespeneventures/comms` | Finished message contract, validation, consent/policy seam, atomic dispatch claim with an opaque lease, explicit provider-acceptance outcome, normalized delivery/inbound events, and durable ledger ports. |
| `@vespeneventures/comms/resend` | Resend SDK mapping, provider idempotency and tag constraints, strict error normalization, exact raw-body Svix verification, and Resend event mapping. |
| Host application | Product events, recipients and personal data, templates/localization, sender identity, consent/preferences, suppression decisions, credentials, database adapters, route/bootstrap code, retention, logging, provider endpoint registration, domain configuration and deployment settings. |

The root/subpath boundary keeps a provider migration from changing the
product-level contract without making consumers coordinate separate package
versions. The package owns no provider configuration or environment reads and
avoids an untyped metadata bag that only one provider can interpret.

## Pipeline

```text
product event
  -> host recipient lookup + policy inputs
  -> host template/rendering
  -> one finished channel message
  -> policy decision
  -> atomic dispatch claim (opaque lease)
  -> provider adapter
  -> provider acceptance result
  -> durable dispatch completion

provider webhook (exact raw body)
  -> provider signature verification
  -> normalized delivery or inbound signal
  -> host's one-operation durable apply
  -> suppression, retry and operator workflows
```

Provider acceptance is intentionally named `accepted`, never `sent` or
`delivered`. Inbox delivery can only be learned later from a verified lifecycle
event.

## Key choices

### `dispatch()` never rejects on transport failure

`CommunicationDispatcher.dispatch` resolves for every outcome, including a
genuine send failure, as `state: "failed"` with a populated `failure`. This
is intentional: a rejected promise would force every caller into a
try/catch just to reach the same discriminated union `dispatch` already
returns. The consequence a host must design for is that **a resolved
promise is not evidence of success.** `await dispatch(message)` completing
without a thrown error tells you nothing by itself; the caller must inspect
`result.state` before reading `result.acceptance` or recording the message
as sent. Code that awaits `dispatch` and moves on without checking `state`
will treat a failed send as delivered.

### One message per channel

Email and SMS do not share a useful finished-content shape. The current core
therefore dispatches one typed message at a time. Multi-channel notification
orchestration creates a channel-scoped stable id per message and dispatches
each independently. Successful channels then checkpoint naturally in the
ledger without a partial fan-out state machine or adapter-specific `meta`.

### Idempotency and leases

The durable dispatch ledger is the primary deduplication boundary. `claim`
must atomically grant one worker an opaque lease; `complete` receives that
lease so stale workers cannot overwrite a newer attempt. Implementations own
claim expiry, failed-attempt retry and abandoned-work recovery.

`complete` runs on every claimed attempt, including failed ones — the
dispatcher passes it the full `CommunicationDispatchResult`, so
`result.failure.retryable` is available at that hook and the ledger contract
depends on it: only a terminal outcome (`accepted`, `skipped`, `duplicate`,
or `failed` with `retryable: false`) may be recorded as permanently
complete. A `failed` result with `retryable: true` must leave the id
reclaimable by a future `claim()`. Recording a retryable failure the same
way as a terminal one silently and permanently blocks that message from
ever being retried, because `claim`'s own dedup check will report it as
`duplicate` forever after. This is the same lease/TTL machinery that
recovers abandoned work; picking a TTL that is too short for the retry path
races the in-flight retry and re-strands the claim into a second, duplicate
attempt instead of a clean single retry.

The Resend adapter additionally forwards the stable message id as the provider
idempotency key. That is a bounded provider-window defense for ambiguous
timeouts, not a durable outbox.

### Webhook storage

Delivery providers may send events at least once and out of order. The core
therefore exposes one `DeliveryEventLedger.apply` operation rather than a
separate claim/record pair. A host implementation atomically deduplicates the
provider event id, appends the event, and advances current delivery state only
when its timestamp and state-transition rules permit.

Correctly signed duplicates and unowned event types should be acknowledged.
Signature failures should be rejected. Unavailable durable storage should
produce a retryable server response. HTTP details remain host-owned so the
package is not coupled to a web framework.

### Templates and identity

Templates stay upstream. A caller may use `@vespeneventures/surface/core` and
`@vespeneventures/surface/email`, a framework template system, or plain strings;
the transport sees only a finished `EmailMessage`.

Sender identities, reply paths, recipient resolution, consent and suppression
are business policy and personal data. Foundry supplies typed seams but no
addresses, domains, defaults or policy values.

### Logging and redaction

Prefer stable message ids, event/category, channel, provider ids, safe tags,
state, error code and retryability. Do not log credentials, webhook bodies,
message bodies, attachments or recipient addresses. `EmailMessage.context` is
host-only and adapters must not transmit it implicitly.

## Future extensions

- A future `@vespeneventures/comms/twilio` subpath should introduce an `SmsMessage` in the core
  and implement the same adapter/error/event boundaries. Provider account
  configuration stays in each host.
- Inbound email currently maps to a privacy-minimal signal containing provider
  ids and time. Content retrieval, parsing, storage and retention wait for a
  concrete cross-host requirement.
- A database-specific ledger package should only be added if multiple hosts
  truly share one storage engine and migration lifecycle. Until then, ledger
  adapters remain host-owned.
- A shared template package should only be added after multiple products share
  a real template contract. Brand copy and visual defaults never belong in the
  transport packages.

## Adoption plan

No provider cutover is required to adopt these packages.

1. Inventory each host's direct SDK calls and wrappers. Freeze existing sender,
   recipient, template and deployment behavior.
2. Convert one rendered transactional email into `EmailMessage`; preserve its
   existing stable occurrence id or introduce one without using body content or
   personal data.
3. Implement the durable dispatch ledger and policy seam in the host. Exercise
   that host's own unit and contract fixtures against the public interfaces.
4. Replace the wrapper with `createResendAdapter` behind the existing call
   boundary. Keep provider dashboard, DNS, domains, credentials and deployment
   variables unchanged.
5. Add a raw-body webhook route that calls `verifyResendWebhook`, then atomically
   applies delivery events. Initially observe only; introduce suppression and
   retry actions under host policy after the ledger is proven.
6. Migrate remaining email paths one at a time. Delete a legacy wrapper only
   after parity tests cover payload, idempotency, failures and webhook
   correlation.
7. Adopt SMS later through a separate adapter and independently typed message,
   not through Resend-specific fields or a generic metadata bag.

Live-send tests remain opt-in and host-owned. Package tests inject a narrow
client and never contact a provider.
