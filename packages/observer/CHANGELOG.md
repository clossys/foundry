# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release. `observer` measures what actually happened: telemetry
  contracts, retention, redaction, and gate efficacy — never the gate
  package it measures.
- **Telemetry contract** (`telemetry.ts`): `TelemetryEvent` shape, a
  declared 90-day retention window (`TELEMETRY_RETENTION_WINDOW_DAYS`,
  `isWithinRetentionWindow`), and `validateTelemetryEvent`.
- **`liveStateSurface`** (`live-state.ts`), adopted from issue #255:
  `LiveStateSurface`, `validateLiveStateSurface`, the generalized
  `liveStateFindingKinds` vocabulary including `declared-but-not-verifiable`,
  and this package's own honest declaration,
  `OBSERVER_TELEMETRY_LOG_SURFACE`, stating that it owns no telemetry store
  of its own.
- **Redaction as a tested contract** (`redaction.ts`): `redactEvent` and
  three serialization forms (`serializeEventAsJSON`,
  `serializeEventAsLogLine`, `serializeEventAsCsvRow`) that redact
  internally before producing any output, plus `redaction.test.ts` — a test
  that constructs an event with a secret-shaped value in a redacted field,
  serializes it every way this package can, and asserts the value is not a
  substring of any output.
- **Gate efficacy over caller-supplied run history** (`gate-efficacy.ts`):
  the `RunHistoryReader` port (no implementation shipped — this package
  performs no I/O and calls no API), and `computeGateEfficacy`, which tallies
  whether a gate ran and what it concluded, purely from what the injected
  reader returns.
- **Escape rate** (`escape-rate.ts`): `computeEscapeRate`, the number that
  closes a gate's loop — changes that reached the default branch and
  violated a rule, divided by changes that landed — computed from
  independently caller-sourced `LandedChangeOutcome` ground truth, never
  from a gate's own verdict.
- **Unobserved surface** (`unobserved-surface.ts`): `computeUnobservedSurface`,
  which sorts declared subjects into observed / unobserved / could-not-read,
  treating a subject with no read supplied at all as `could-not-read` —
  never silently as `unobserved`.
- **Three-state read result enforced in the types**
  (`observation.ts`): every read in this package returns an
  `Observation<T>` discriminated union — `"could-not-read"` requires a
  `note` and cannot carry the observed payload; `"observed"` cannot omit
  it. A narrower or looser result does not type-check.
- **The two metrics reported separately, provably** (`metrics.check.ts`,
  `metrics-non-combination.test.ts`): `EscapeRateMetric` and
  `UnobservedSurfaceMetric` share no field name beside their `kind`
  discriminant, checked at compile time; no exported function accepts both,
  checked at runtime.
- Zero runtime dependencies. Zero I/O.
