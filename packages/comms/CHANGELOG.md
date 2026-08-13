# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
