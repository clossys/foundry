# Communications architecture

## Role ownership and current lifecycle

| Owner | Responsibility |
| --- | --- |
| `@vespeneventures/butler` | Admission and confirmation of inbound person requests and standing instructions. |
| `@vespeneventures/messenger` | Published role for authorized finished-message transport, explicit provider acceptance, signed delivery-status normalization, and timely verified delivery assessment. |
| `@vespeneventures/messenger/providers/resend` | Provider mapping, idempotency constraints, strict error normalization, signature verification, and delivery-status event mapping. |
| `@vespeneventures/giver` | Whether an answer, refusal, handoff, or delivery discharged the semantic obligation owed to the person. |
| Host application | Authorization evidence, recipients and personal data, templates/localization, sender identity, consent/preferences, suppression decisions, credentials, durable stores, routes, retention, logging, provider endpoint registration, domain configuration, and deployment settings. |

The role boundary is semantic, not a repository or provider boundary. Butler
owns inbound admission, messenger owns transport and delivery-status evidence,
and giver owns obligation discharge. Provider acceptance never proves either
delivery or semantic discharge.

The following mechanics describe the transport behavior preserved by the
target role. Exact source APIs live in the package README rather than being
restated here. The package owns no provider configuration or environment
reads.

## Pipeline

```text
product event
  -> host recipient lookup + policy inputs
  -> host template/rendering
  -> one finished channel message + bound authorization evidence
  -> atomic dispatch claim (opaque lease)
  -> current authorization policy decision
  -> durable skipped completion if denied
  -> provider adapter
  -> provider acceptance result
  -> durable dispatch completion

delivery-status webhook (exact raw body)
  -> provider signature verification
  -> normalized delivery-status signal
  -> host's one-operation durable apply
  -> suppression, retry and operator workflows

inbound person request
  -> butler admission and confirmation
  -> authorized downstream work
```

Provider acceptance is intentionally named `accepted`, never `sent` or
`delivered`. Inbox delivery can only be learned later from a verified lifecycle
event.

## Key choices

### `dispatch()` never rejects on transport failure

`Messenger.dispatch` resolves for every outcome, including a
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

`complete` runs on every claimed attempt that reaches a dispatch result,
including denied and failed ones — the dispatcher passes it the full
`DispatchResult`, so
`result.failure.retryable` is available at that hook and the ledger contract
depends on it: only a terminal outcome (`accepted`, `skipped`, or `failed`
with `retryable: false`) may be recorded as permanently
complete. A `failed` result with `retryable: true` must leave the id
reclaimable by a future `claim()`. Recording a retryable failure the same
way as a terminal one silently and permanently blocks that message from
ever being retried, because `claim`'s own dedup check will report it as
`duplicate` forever after. This is the same lease/TTL machinery that
recovers abandoned work; picking a TTL that is too short for the retry path
races the in-flight retry and re-strands the claim into a second, duplicate
attempt instead of a clean single retry.

A denied intent is durably completed as `skipped`; it is not merely reported
through best-effort observability. If a later policy change authorizes the
work, the host creates a new stable intent id and new bound authorization
evidence rather than reopening a terminal denial under the old identity.

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

- A future `@vespeneventures/messenger/providers/twilio` subpath should introduce an `SmsMessage` in the core
  and implement the same adapter/error/event boundaries. Provider account
  configuration stays in each host.
- Inbound email admission does not belong in messenger. A provider-specific
  receiver may normalize transport evidence, but person-request admission and
  confirmation remain with butler.
- A database-specific ledger package should only be added if multiple hosts
  truly share one storage engine and migration lifecycle. Until then, ledger
  adapters remain host-owned.
- A shared template package should only be added after multiple products share
  a real template contract. Brand copy and visual defaults never belong in the
  transport packages.

## Replacement-only migration

Source parity is not adoption. The migration order is:

`@vespeneventures/messenger@0.1.0` is public and its root, provider, and CLI
surfaces passed an isolated registry install. The `comms` donor is retired and
absent from both this source tree and GitHub Packages. Consumer work is now:

1. Inventory each consumer's former comms imports, direct provider calls, webhook
   handling, durable dispatch state, and inbound admission.
2. Move only authorized finished-message transport and delivery-status
   verification to messenger. Move inbound person-request admission to butler;
   keep semantic obligation checks with giver.
3. Preserve provider configuration, identities, templates, routes, durable
   storage, and credentials while proving dispatch and event correlation.
4. Prove the consumer inventory can detect and eliminate every retained donor
   pin before claiming the installed Messenger position is current.

Live-send tests remain opt-in and host-owned. Package tests inject a narrow
client and never contact a provider.
