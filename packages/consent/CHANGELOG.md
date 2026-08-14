# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-13

### Added

- Initial release: a provider-neutral consent record core.
- `ConsentState` (`absent` / `denied` / `granted`), `ConsentPolicyVersion`,
  `ConsentRecord`, `ConsentCategory`, `GpcSignal`.
- `evaluateConsent()` — pure evaluation of a stored record against the
  current policy version, including a required, no-default
  `invalidateDenialOnPolicyBump` policy for the denial-invalidation open
  question left in issue #178.
- `decideConsentChange()` — pure grant/deny/withdraw decision core, kept
  separate from I/O, mirroring `decideInboundAdmission` in `@vespeneventures/comms`.
- `recordReopened()` and `recordPolicySuperseded()` — pure audit-event
  builders for reopening a preference center and for a policy bump
  invalidating a stored answer.
- `ConsentStoragePort` and `ConsentAuditLedger` — host-implemented storage
  and audit ports; no concrete implementation ships.
- Hand-rolled runtime type guards: `isConsentCategory`, `isConsentPolicyVersion`,
  `isGpcSignal`, `isConsentAction`.
- `./web` subpath: `ConsentGate` (an SSR-safe gate component with a tested
  server/first-client-render parity contract) and `useConsentPreferences`
  (a preference-management hook with `grant`/`deny`/`withdraw`, all sharing
  one call shape). `react`/`react-dom` are optional peers of this subpath
  only.
