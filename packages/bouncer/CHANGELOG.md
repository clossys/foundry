# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-08-22

First release. This package is the bouncer role: everything about who you
are, what you can do, and how that changes over time.

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing —
to a reader who arrives at this package first.

### Added

- **A three-state runtime verdict.** `evaluateGrant` returns `authorized`,
  `denied`, or `unverifiable`. The third is not a flavour of the second:
  fold "the provider did not answer" into `denied` and every provider
  outage becomes a mass revocation, fold it into `authorized` and the same
  outage becomes a silent blanket grant.
- **A grant schema in which a session proves nothing.** `Grant` carries an
  optional `sessionId` that no checker ever reads as evidence, because the
  defect this package exists for is a well-formed session outliving the
  authority behind it by an hour.
- **A provider observation whose reachability is a field, not an
  inference.** "The provider says nothing is backed" and "the provider did
  not answer" produce an identical empty list, so `ProviderAssertion`
  carries `reachability` explicitly and the validator refuses a record
  whose two halves disagree, in both directions.
- Three gates, all reachable from the single `bouncer-check` bin:
  `authority-reconciliation`, `delegation-ceiling`, and
  `provider-contract`. Each dispatches on `argv[0]` matching exactly —
  never on `basename(process.argv[1])`, which would see `cli.js` and
  silently run the wrong command wherever a gate is invoked by compiled
  path.
- The `0` / `1` / `2` exit contract, with `2` reachable on every gate by
  more than one route — an unreadable or invalid record store, an empty
  record set, a provider that could not be reached, a provider shape that
  was never supplied, and no gate selected at all — and each route tested.
  A bare `bouncer-check` exits `2` with its usage on **stderr**: nothing
  was selected, so nothing was checked. Only an explicitly requested
  `--help` exits `0`.
- **An `./agent` subpath** for delegated machine actors: lifecycle
  classification, a fail-closed tool-scope guard, and a monetary-authority
  guard, all provider- and framework-neutral.
- **Provider adapters isolated behind `./providers/*`.** The Clerk adapter
  ships as `./providers/clerk` plus `./providers/clerk/web`, `/web/client`,
  `/web/server`, and `/web/proxy`, split so importing the edge-safe proxy
  entry never pulls `next/headers`, `next/navigation`, React, or client
  components. The root imports none of them.
- `assertPeerVersion`, ported rather than shared, guarding every optional
  peer at import time. An absent peer and an out-of-range peer throw
  different messages; an installed version the guard cannot parse is
  treated as indeterminate and warns rather than blocking a build.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`: a consumer reading the installed package should not have
  to leave it to find out what changed.

### Design notes

- **An unreachable provider exits `2`, never `0` and never `1`.** A
  comparison that did not happen is not a comparison that passed, and it is
  not a denial either — the two have different corrections. Inside a single
  run, indeterminate wins over violated: a caller handed "1, here are the
  findings" reasonably reads it as "and there are no others", and when a
  provider was unreachable there may well be.
- **A machine actor's spend ceiling has three distinguishable states.** A
  number is a declared ceiling, `null` is "no monetary surface", and ABSENT
  is nobody having decided. The schema keeps absent absent through
  validation rather than collapsing it to `null`, because collapsing it
  would delete the finding before the checker ever ran. There is an opt-out
  for a deliberate `null` — `unlimitedSpendIsDeclared` — and none at all
  for absent: you cannot declare deliberate a question nobody asked.
- **The gate and the runtime disagree about `null`, on purpose.**
  `assertAgentMonetaryAuthority` reads it as unlimited amount authority and
  proceeds, which is right at the moment of a call. `checkDelegationCeiling`
  reports it, which is right at review. Different times, different
  questions.
- **An under-declared actor validates and is reported; it is not a parse
  error.** `toolScope` and `responsibleHumanId` are optional in the gate's
  schema and required by the runtime context type, so an actor that answers
  to nobody produces a nameable finding rather than an anonymous "the file
  was malformed".
- **`provider-contract` is checked in both directions.** An adapter reading
  a field the provider dropped and a provider emitting an event the adapter
  ignores are two different silences, and only one of them is visible from
  either side alone.
- **No provider schema is ever fetched.** A gate needing network access,
  credentials and a per-provider client could not run in the offline,
  hermetic position where a gate belongs. Transcription is the consumer's
  job; keeping the transcription honest is the gate's.

### Not included

- No roles, tiers, entitlements, ceilings, currencies, providers, or
  policies of our own. No role vocabulary and no jurisdiction logic. Every
  declaration is authored by the consumer.
- Storage and audit are host-supplied ports and no implementation of either
  ships here. This package writes nothing and stores nothing.
- No person-attributable record is written into this repository.
  `actorId`, `subjectId`, and `responsibleHumanId` are opaque host-owned
  references carrying no email, name, phone number, address, or IP — and
  actor and subject are never merged into one identifier.
