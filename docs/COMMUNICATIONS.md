# Communications architecture

## Decision

Foundry owns two packages:

| Owner | Responsibility |
| --- | --- |
| `@vespeneventures/comms` | Finished message contract, validation, consent/policy seam, atomic dispatch claim with an opaque lease, explicit provider-acceptance outcome, normalized delivery/inbound events, durable ledger ports, and test-only memory fakes. |
| `@vespeneventures/comms-resend` | Resend SDK mapping, provider idempotency and tag constraints, strict error normalization, exact raw-body Svix verification, and Resend event mapping. |
| Host application | Product events, recipients and personal data, templates/localization, sender identity, consent/preferences, suppression decisions, credentials, database adapters, route/bootstrap code, retention, logging, provider endpoint registration, domain configuration and deployment settings. |

The split keeps a provider migration from changing the product-level contract
and keeps the core install free of provider SDKs. It also avoids the opposite
failure: a provider-neutral package with an untyped metadata bag that only one
provider can interpret.

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

Templates stay upstream. A caller may use `@vespeneventures/compose` and
`@vespeneventures/render/email`, a framework template system, or plain strings;
the transport sees only a finished `EmailMessage`.

Sender identities, reply paths, recipient resolution, consent and suppression
are business policy and personal data. Foundry supplies typed seams but no
addresses, domains, defaults or policy values.

### Logging and redaction

Prefer stable message ids, event/category, channel, provider ids, safe tags,
state, error code and retryability. Do not log credentials, webhook bodies,
message bodies, attachments or recipient addresses. `EmailMessage.context` is
host-only and adapters must not transmit it implicitly.

## Future packages

- `@vespeneventures/comms-twilio` should introduce an `SmsMessage` in the core
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
   the memory fakes only in unit tests.
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
