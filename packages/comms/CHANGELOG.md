# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-08-14

### Changed

- **Documented effective install behaviour on the GitHub Packages
  registry.** `resend` is correctly declared `optional: true` in
  `peerDependenciesMeta`, but `npm.pkg.github.com`'s packument omits that
  field entirely, so an installer resolving against this registry treats
  it as required the moment this package is installed at all, including
  for a consumer who only ever imports the provider-neutral root or
  `./inbound` and never touches the Resend adapter. No
  `peerDependenciesMeta` block changed; see the README's "Requirements"
  section and [issue #226](https://github.com/vespeneventures/foundry/issues/226)
  for the full evidence and decision.

## [0.3.1] - 2026-08-13

### Added

- **`resend` peer-version guard.** `src/resend/index.ts` now calls
  `assertPeerVersion` (new internal `src/internal/peer-version.ts`) at
  import time, throwing a named, actionable error when the optional
  `resend` peer is either not installed or installed outside this
  package's declared `^6.19.0` range — distinct messages for each case.
  Previously, an absent or incompatible `resend` produced no signal until
  something inside the SDK itself crashed. See the README's "Requirements"
  section. (#182)

## [0.3.0] - 2026-08-13

### Added

- New `./inbound` subpath: `admitInboundEvent()`, a pure, dependency-free
  inbound-webhook admission decision, plus `decideInboundAdmission()` (its
  synchronously-testable pure core), `InboundEventLedger`,
  `InboundAdmissionInput`, `InboundAdmissionDecision`, and
  `InboundAdmissionIgnoreReason`. Deliberately not an HTTP handler: the
  consumer owns the route, raw-body access, and signature verification; this
  package owns dedupe and the ack/reject doctrine on top of a ledger the
  host implements, mirroring the existing `DeliveryEventLedger` split. Fails
  closed on any malformed input (missing/blank `eventId`, missing
  `provider`, an unparseable `occurredAt`, or a `signature` value other than
  the exact literal `"verified"`) and never returns
  `{ ack: true, action: "process" }` unless the signature was verified and
  the ledger reported the event as new. See the README's
  [Inbound admission](README.md#inbound-admission) section.

### Changed

- **Breaking:** `CommunicationChannel` is now declared independently as
  `"email" | "sms" | "whatsapp"` instead of being derived as
  `CommunicationMessage["channel"]` (which made it exactly `"email"`).
  `CommunicationMessage` is unchanged — still `EmailMessage` only; no new
  message shapes ship. This closes a silent-exhaustiveness trap: any
  consumer's exhaustive `switch` over the old, derived `CommunicationChannel`
  compiled today and would have silently stopped being exhaustive the moment
  a second channel shipped, with no compiler error to catch it. Breaking for
  a consumer that assumed `CommunicationChannel` would only ever contain
  channels this package could already dispatch. Under this repo's pre-1.0
  semver policy a breaking change to a 0.x package is a MINOR bump, not
  MAJOR. Runtime behavior is unchanged: `validateCommunicationMessage`
  already rejected (and still rejects) any message whose `channel` is not
  `"email"`, and `createCommunicationDispatcher` already returned (and still
  returns) an explicit `state: "failed"`,
  `failure: { code: "channel_unconfigured", retryable: false }` result for a
  channel with no registered adapter — reserving a channel name does not
  register an adapter for it. See the README's
  [Channel scope](README.md#channel-scope) section.

## [0.2.0] - 2026-08-13

### Changed

- **Breaking:** `resend` moved from an unconditional `dependencies` entry to
  an optional `peerDependency` (`peerDependenciesMeta` marks it optional).
  Only the `./resend` subpath imports it; a consumer using the
  provider-neutral root contracts previously still had the Resend SDK
  installed transitively regardless. Breaking for anyone relying on that
  transitive install without declaring `resend` themselves. Under this
  repo's pre-1.0 semver policy a breaking change to a 0.x package is a
  MINOR bump, not MAJOR.
- Documented, including in editor-visible doc comments on
  `CommunicationDispatcher.dispatch` and `CommunicationDispatchResult`, that
  `dispatch()` never rejects on a transport failure — a genuine send
  failure still resolves the promise, as `state: "failed"` with a populated
  `failure`. A resolved promise is not success; callers must branch on
  `result.state` before reading `result.acceptance`. The behavior itself is
  unchanged; what changed is that it is now stated prominently, because two
  independent consumer implementers made this exact mistake.
- The ledger contract now states plainly that `complete()` for a
  `state: "failed"` result with `failure.retryable: true` must leave the id
  reclaimable by a later `claim()` — only terminal outcomes (accepted,
  skipped, duplicate, or a non-retryable failure) may be recorded as
  permanently complete. Marking a retryable failure complete the same way a
  success is marked complete permanently blocks the retry through
  `claim()`'s dedup check, causing silent non-delivery. Also documents the
  adjacent trap: a lease TTL short enough to expire and be reclaimed while
  a retryable failure's retry is still in flight re-strands the work as a
  duplicate send.
- `ResendWebhookHeaders`'s generic `id`/`timestamp`/`signature` fields are
  now documented as corresponding directly to the `svix-id`,
  `svix-timestamp`, and `svix-signature` wire headers.

### Added

- Reference implementations for both `CommunicationDispatchLedger` and
  `DeliveryEventLedger`, with a Postgres schema sketch, in the README.
  `DeliveryEventLedger` previously had no implementation anywhere in this
  repository, including tests. Reference only — not exported by this
  package and not covered by its test suite.

## [0.1.0] - 2026-08-10

### Added

- Initial provider-neutral email message, policy, dispatch, lease, acceptance,
  and delivery-event contracts.
- Built-in `./resend` subpath with strict Resend email transport, provider tag
  normalization, raw webhook verification, and delivery/inbound event mapping.
