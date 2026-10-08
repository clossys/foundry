# Browser consent and analytics boundaries

Contract for one optional browser purpose, first-party analytics, on public
pre-authentication web surfaces. This document is the specification that
#1938, #1940 and #1941 build against (issue #1560, specification revision 5).
It ships no code. Every package it names is still in the **designed** state
for this capability as [LIFECYCLE.md](LIFECYCLE.md) defines it. Nothing here
is implemented, staged, published or adopted until that package's own
evidence says so.

This is record and gating machinery. It makes no claim of legal compliance.
Which regime applies to which visitor, the expiry length, the policy version
and all wording are host values, never package defaults.

Rule identifiers (`O-n`, `C-n`, `H-n`, `P-n`) are stable so that tickets,
tests and reviews can cite them. Identifiers are never renumbered; a rule
added after the initial draft takes the next free number in its family, so
numbers inside a section are not always consecutive.

## Decisions in this revision

Revision 5 replaces the earlier presentation direction. Where an issue body
still says something different, these decisions control. "Superseded ticket
text" below lists each known conflict.

1. **One compact notice with two equal actions.** There is no preferences
   dialog and no secondary reopen control in the footer. Reopening is a link
   (a fragment anchor, typically inside the privacy policy) or a reopen
   event.
2. **Global Privacy Control is a standing refusal.** A regime input is
   `prompt` or `notice`, and a missing or unknown value is `prompt`. Expiry
   is a fixed number of calendar months, computed once at decision time and
   never renewed by reading. An expired choice is the same as no choice and
   shows no "expired" message. The reopen seam needs no package import
   (#1981).
3. **Calendar-month expiry is one shared rule.** That rule is Butler's pure
   `addCalendarMonthsUtc` and `isWithinWindow` (#1978).
4. **The host controls whether consent is needed at all.** With
   `required={false}` the notice never shows and reopen does nothing.
   `onChange` fires only on a visitor's choice. Hosts read state through a
   hook. Copy is one sentence with separate `prompt` and `notice` leads.
   Escape sets the notice aside in memory for the current page view only.
   A review seam that works on loopback hosts only is separate from the
   fixed-clock preview (#1941).
5. **Server rendering never depends on storage.** A client-mount guard makes
   the server HTML match the no-decision baseline. The assembly mounts no
   toast. The notice is the sole consent surface.
6. **Truthful outcomes.** A simulation is never a durable acknowledgement.
   A withdrawal that fails is reported at the time and never left silent,
   so a grant that survives in storage was never presented as withdrawn.
   Storage that cannot be read is never permission. SDK work is off by
   default and cancellable, and events are redacted. Pure roots never
   initialize an SDK or touch storage.

## Ownership

| Concern | Owner | Location | Unit |
| --- | --- | --- | --- |
| Calendar-month arithmetic and window test | Butler | package root, pure | #1978 |
| Stored record, decision rules, lifecycle, ports | Butler | `packages/butler/src/browser-consent/` | #1938 |
| Browser storage adapter | Butler | `packages/butler/src/browser-consent/adapters/` | #1938 |
| Analytics transport and provider adapter | Observer | `packages/observer/src/browser-analytics/` | #1940 |
| Notice presentation | Designer | `ConsentBanner` block | existing, plus unit D |
| Assembly, hooks, transport binding, reopen, review seam, preview | Publisher | `packages/publisher/src/web/consent/` | #1941 |
| Copy resolution against Writer approval | Publisher | `packages/publisher/src/consent-copy/` | #1941 |
| Butler and Observer subpath exports, structural port conformance | Butler, Observer | manifests and public entry modules | unit E |
| Publisher subpath exports | Publisher | manifest and public entry modules | #1941 |
| Security headers, sign-out storage clearing | Bouncer | `packages/bouncer/src/` | #1947, independent |
| Versions and changelogs for the cohort | release preparation | manifests, changelogs | #1942 |

Unit D and unit E have no ticket yet (see "Unowned work").

- **O-1 Butler owns the lifecycle and nothing visual.** Butler owns the
  record, the decision rules, expiry, withdrawal, the storage port and the
  evidence port. It renders nothing and ships no wording.
- **O-2 Designer owns controlled presentation and no state.** `ConsentBanner`
  stays presentational. It holds no consent state, reads or writes no
  storage, makes no network call and ships no wording. Every state it shows
  arrives through props. The notice is this block, not the atom `Banner`.
- **O-3 Publisher owns assembly through structural ports.** Publisher
  composes the Designer notice with copy it has resolved against Writer.
  It reaches the lifecycle and the transport only through port types that it
  declares structurally (mirrored shapes, not imports). Publisher source
  never imports Butler, Observer or any analytics SDK, ships no consent
  fixtures in a production entry, and never re-implements a decision rule.
  The host composes the real implementations and passes them in.
- **O-4 Observer's root stays zero I/O.** Observer's root entry point
  and everything it reaches stay pure functions of their arguments. The
  network-capable transport is a separate subtree that the root never
  imports.
- **O-5 Adapters are isolated and off by default.** The browser storage
  adapter, the provider adapter and the SDK loader each live in their own
  module and their own export subpath. Only a host's explicit call
  constructs one. No package entry constructs one implicitly, at import or
  on mount.
- **O-6 Server/client boundaries are preserved.** The assembly and the
  preview are client-only and refuse the `react-server` condition. Copy
  resolution is server-only and refuses the `browser` condition. The client
  receives resolved strings, never a resolver or a registry (C-49).
- **O-7 No consumer one-offs.** No unit adds wording, an expiry length, a
  regime table, a provider key or a provider host as a package default.

## Contracts

### Pure roots and imports

- **C-1** Importing any of these performs no storage read or write, no
  network request, no timer, no SDK load and no read of `window`,
  `document`, `navigator` or `localStorage`: the Butler root, the Observer
  root, `@clossys/publisher/web`, `@clossys/publisher/web/consent`,
  `@clossys/publisher/consent-copy`, and the unit E subpaths
  `@clossys/butler/browser-consent`,
  `@clossys/butler/browser-consent/local-storage`,
  `@clossys/observer/browser-analytics` and
  `@clossys/observer/browser-analytics/posthog`. Adapters do their work
  only when the host calls them.
- **C-2** No module in `browser-consent/` or `browser-analytics/` touches a
  browser global at module scope. Adapters touch globals only inside
  functions that the host calls.
- **C-3** No package source imports an analytics SDK. The SDK reaches the
  transport only through a host-supplied loader, such as a dynamic import
  written in the host's own code.
- **C-4** No production entry's import closure contains the preview module.
  The review seam carries no fixtures: it seeds state by calling the
  lifecycle (C-50). The preview factory refuses to run when the host
  declares a production environment.

### Stored record and decision rules (Butler)

The record carries no identifier, address, user agent or other personal
reference:

```ts
type ConsentRegime = "prompt" | "notice";
interface ConsentSignals { gpc: boolean }
interface StoredChoice {
  status: "granted" | "denied";
  decidedAt: string;     // ISO 8601 UTC
  expiresAt: string;     // ISO 8601 UTC, fixed when decided
  policyVersion: string;
  gpcOverride?: true;    // only on a grant decided while GPC was on and overridable
}
type StoredInput = StoredChoice | null | "unreadable";
interface ConsentPolicy {
  version: string;
  expiryMonths: number;                  // whole, at least 1
  invalidateDenialOnPolicyBump: boolean; // required, no default
  gpcOverridable?: boolean;              // default false
  legacy?: { accept: true; assumedPolicyVersion: string };
}
type EffectiveChoice = "granted" | "denied" | "none" | "unknown";
```

`StoredInput` is what the decision functions evaluate: a parsed live
record, `null` for no record, or `"unreadable"` when storage could not be
read at all. `unknown` is the effective choice for unreadable storage with
no in-memory choice and Global Privacy Control off.

- **C-5 Missing or unknown regime is `prompt`.** `normalizeRegime(value)`
  returns `"notice"` only for the exact string `"notice"`.
- **C-6 Expiry is fixed at decision time.** `decideChoice` sets
  `expiresAt = addCalendarMonthsUtc(new Date(decidedAt), policy.expiryMonths)`,
  written back as an ISO string. Reads, visits, reopenings and migrations
  never write a later `expiresAt`. `decideChoice` throws a typed error when
  `expiryMonths` is not a whole number of at least 1.
- **C-7 A record is live** when it parses and
  `isWithinWindow(new Date(decidedAt), new Date(expiresAt), now)` holds, so
  the end instant is outside (C-40 caps `expiresAt` first). Its policy
  version must also equal `policy.version`. A denial is the exception when
  `invalidateDenialOnPolicyBump` is `false`. A record that is expired,
  corrupt, of an unknown shape, or under another policy (subject to that
  rule) reads as **no choice**. No "expired" state reaches presentation.
- **C-8 Global Privacy Control is a standing refusal.** With `gpc` true,
  the effective choice is `denied`. A live grant overrides it only when the
  grant carries `gpcOverride: true` and `policy.gpcOverridable` is `true`.
  A grant decided while the signal was off never overrides a signal that is
  on now.
- **C-9 Regime decides what no choice means.** With no choice, `prompt` is
  not allowed and opens the notice by itself. `notice` is allowed and opens
  only on request. A denial is never allowed under either regime, and with
  GPC on the effective choice is never `none` or `unknown`.
- **C-10 Legacy records migrate in parsing, without renewal.** A record of
  the older shape `{ status, decidedAt }` under the configured key parses
  only when `policy.legacy.accept` is `true`. `parseStoredChoice` then
  computes its `expiresAt` from `decidedAt` with C-6 and gives it
  `policyVersion = policy.legacy.assumedPolicyVersion`, and C-7 applies
  unchanged. A host keeps returning visitors' live choices by setting
  `assumedPolicyVersion` to the version those choices answered, normally
  the current `policy.version`. A legacy record with no readable date, or
  any legacy record when `policy.legacy` is absent, reads as no choice.
  Reading never rewrites a record; the next explicit choice writes the full
  shape. The storage adapter returns raw values and performs no migration.
- **C-37 Unreadable storage is neither a choice nor permission.** When the
  storage read is `unavailable`, the effective choice is `unknown` (or
  `denied` with GPC on). It is not allowed under either regime, and the
  notice does not open by itself. It opens on reopen with the
  `storageUnavailable` status. A choice the visitor makes then holds in
  memory for the visit.
- **C-38 Every explicit choice writes a fresh record.** Each `grant()` or
  `refuse()` that writes, including `grant()` over a live grant and
  `refuse()` over a live denial, writes a new `decidedAt` and `expiresAt`.
  Reads, reopenings and migrations never do.
- **C-39 Accept under a non-overridable signal is a no-op.** With GPC on
  and `gpcOverridable` not `true`, `grant()` writes nothing, calls no
  evidence port and changes no state. The assembly fires no `onChange`.
  The snapshot reports `gpcInForce: true`, and the notice shows the
  `gpcInForce` status whenever it is open in that state. With GPC on and
  `gpcOverridable` `true`, a grant is recorded with `gpcOverride: true`.
  `decideChoice("granted", ...)` throws in the non-overridable case, so no
  caller can produce such a record.
- **C-40 Reading caps expiry and tolerates clock rollback.**
  `parseStoredChoice` replaces `expiresAt` with the earlier of the stored
  value and `addCalendarMonthsUtc(new Date(decidedAt), policy.expiryMonths)`,
  so a record never outlives the current policy's length. A record whose
  `decidedAt` is later than its own `expiresAt` is corrupt. A denial whose
  `decidedAt` is later than `now` (the clock moved back) stays live until
  its capped `expiresAt`. A grant whose `decidedAt` is later than `now` is
  not live.

```ts
function normalizeRegime(value: unknown): ConsentRegime;
function decideChoice(status: "granted" | "denied", now: Date, policy: ConsentPolicy, signals: ConsentSignals): StoredChoice;
function parseStoredChoice(raw: unknown, policy: ConsentPolicy): StoredChoice | null;
function effectiveChoice(stored: StoredInput, signals: ConsentSignals, policy: ConsentPolicy, now: Date): EffectiveChoice;
function isAllowed(stored: StoredInput, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
function shouldPromptAutomatically(stored: StoredInput, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
```

These functions are pure and safe to call before hydration. The lifecycle
and the assembly share them, and neither re-implements them. A caller that
uses them directly before hydration bypasses `required` and the review
seam, and must apply both itself (H-7).

### Lifecycle and ports (Butler)

```ts
type StorageRead = { kind: "value"; value: unknown } | { kind: "empty" } | { kind: "unavailable" };
type StorageWrite = { kind: "ok" } | { kind: "unavailable" };
interface ConsentStoragePort {            // synchronous on purpose
  read(): StorageRead;                    // raw value, no migration
  write(choice: StoredChoice): StorageWrite;
  remove(): StorageWrite;
  subscribe?(onExternalChange: () => void): () => void; // another tab wrote
}
type EvidenceResult = { kind: "saved" } | { kind: "conflict" } | { kind: "unavailable" };
interface ConsentEvidencePort {           // optional durable acknowledgement
  save(choice: StoredChoice, context: { signal: AbortSignal; sequence: number }): Promise<EvidenceResult>;
}
type EvidenceStatus = "none" | "pending" | "saved" | "conflict" | "unavailable";
interface ConsentSnapshot {
  regime: ConsentRegime;            // normalised; the single regime source
  effective: EffectiveChoice;
  allowed: boolean;
  promptAutomatically: boolean;
  persistence: "stored" | "memory" | "none";
  storage: "readable" | "unreadable";
  evidence: EvidenceStatus;
  withdrawal: "idle" | "failed";
  gpcInForce: boolean;              // GPC on and not overridable
  simulated: boolean;
  sequence: number;
}
interface ConsentLifecycle {
  getSnapshot(): ConsentSnapshot;   // stable identity until a change
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshot;
  refuse(): ConsentSnapshot;        // also withdraws when the prior snapshot was allowed
  refresh(): ConsentSnapshot;       // re-read storage, re-evaluate against the clock
  dispose(): void;
}
function createConsentLifecycle(options: {
  storage: ConsentStoragePort;
  evidence?: ConsentEvidencePort;
  policy: ConsentPolicy;
  regime: unknown;
  signals: ConsentSignals;
  clock: () => Date;
  simulated?: boolean;              // review seam only (C-42)
}): ConsentLifecycle;
const NO_DECISION_SNAPSHOT: ConsentSnapshot; // the server and pre-mount snapshot
```

`NO_DECISION_SNAPSHOT` is `regime: "prompt"`, `effective: "none"`,
`allowed: false`, `promptAutomatically: false`, `persistence: "none"`,
`storage: "readable"`, `evidence: "none"`, `withdrawal: "idle"`,
`gpcInForce: false`, `simulated: false` and `sequence: 0`.

The storage port is synchronous for two reasons. Pre-hydration callers and
`useSyncExternalStore` need a synchronous read, and the browser record
carries no subject identifier. Butler's existing asynchronous,
subject-keyed `StandingInstructionStore` therefore cannot serve as this port.
A host that wants durable server-side evidence implements
`ConsentEvidencePort`, and may back it with its own standing-instruction
store.

Transitions. `seq` is the lifecycle's in-memory decision counter. "Prior
allowed" is the `allowed` field of the snapshot before the call.
"Read-back" means reading storage again, parsing it, and evaluating
`isAllowed` under the current regime and signals while ignoring the
in-memory choice.

| From | Event | Effect | Result |
| --- | --- | --- | --- |
| mount | read `unavailable` | nothing written | `unknown` (or `denied` with GPC on), not allowed, no automatic prompt, `storage: "unreadable"`, persistence `none` |
| mount | read `empty`, or a value that parses to no choice (C-7, C-10, C-40) | nothing rewritten | `none` |
| mount | live record | none | the record's status, persistence `stored` |
| any | `grant()` with GPC on and not overridable | no-op (C-39) | unchanged, `gpcInForce: true` |
| `none`, `unknown`, `denied` or `granted` | `grant()`, write `ok` | fresh record (C-38), `seq+1`, evidence `pending` if a port exists, otherwise `none` | `granted`, `stored` |
| `none`, `unknown`, `denied` or `granted` | `grant()`, write `unavailable` | grant held in memory for this visit; no evidence call (C-41) | `granted`, `memory`, evidence `none` |
| prior allowed `false` (`none` under `prompt`, `unknown`, `denied`) | `refuse()`, write `ok` | fresh denial (C-38), `seq+1`, evidence `pending` if a port exists | `denied`, `stored` |
| prior allowed `false` | `refuse()`, write `unavailable` | denial held in memory; no evidence call | `denied`, `memory` |
| prior allowed `true` (`granted`, or `none` under `notice`) | `refuse()` | a **withdrawal**: publish `allowed: false` to subscribers before anything else, then `seq+1`, abort any in-flight evidence, write a denial, read back | the next three rows |
| withdrawal | write `ok`, read-back not allowed | evidence `pending` if a port exists | `denied`, `stored` |
| withdrawal | write `unavailable`, `remove()` `ok`, read-back not allowed | record removed (possible under `prompt` only) | `denied`, `memory` |
| withdrawal | read-back allowed, whatever the write and removal returned | denial held in memory for this visit | `denied`, `memory`, `withdrawal: "failed"` |
| any | evidence result for an older `seq` | ignored | unchanged |
| evidence `pending` | `saved` for the current `seq` | none | evidence `saved` |
| evidence `pending` | `conflict` | local record re-read; a conflict never upgrades to `granted` | evidence `conflict` |
| evidence `pending` | `unavailable`, or a throw | local choice kept | evidence `unavailable` |
| any | external change (another tab) | re-read; last write wins; no `onChange` | re-evaluated |
| any | `refresh()` | re-read and re-evaluate against the clock; nothing rewritten | an expired record becomes `none` |

- **C-11 A failed save never reports a stored choice.** After a failed
  write the snapshot is `persistence: "memory"` and evidence is never
  `saved`. The in-memory choice ends with the visit.
- **C-12 A stale grant never overrides a withdrawal.** Every asynchronous
  completion carries the `seq` it started under and is discarded when
  `seq` has moved on. A grant's durable acknowledgement that arrives after a
  refusal changes nothing.
- **C-13 A withdrawal completes only on verified read-back.** Any
  `refuse()` whose prior snapshot was allowed is a withdrawal: from a grant
  under either regime, and from no choice under `notice`. It reports
  success only when the read-back is not allowed under the current regime.
  Under `notice`, a missing record is allowed, so removal alone never
  completes a withdrawal there. Otherwise the snapshot carries
  `withdrawal: "failed"`, and the assembly keeps the notice open with the
  `withdrawalFailed` status (C-25). The denial holds in memory for the rest
  of the visit, and the status tells the visitor so. If storage keeps
  returning the old grant, or under `notice` holds no record at all, a
  later document load reads it as allowed; that residual case is open
  question 7.
- **C-14 Durable acknowledgement is separate from the choice.** Gating
  follows the local record. It never waits for evidence, and evidence never
  grants. With no evidence port (browser-only mode), a full grant-and-refuse
  cycle makes zero network requests and evidence is never `saved`.
- **C-15 Withdrawal is never harder than granting.** `grant()` and
  `refuse()` share one call shape, and `refuse()` is never disabled,
  including while a grant's evidence is pending.
- **C-41 Evidence follows a local write, in order.** The evidence port is
  called only after a local write returned `ok`, for grants and denials
  alike. A choice held only in memory never reaches it, because a durable
  record the browser does not hold could disagree with the browser on the
  next visit. Each call carries the lifecycle's `sequence`. An
  implementation must never let a record with an earlier `decidedAt`, or
  the same `decidedAt` and a lower `sequence`, overwrite a later one; it
  answers `conflict` instead.
- **C-42 A simulated lifecycle never allows.** With `simulated: true`, the
  snapshot reports `simulated: true` and `allowed: false` whatever the
  record says, and the lifecycle never calls an evidence port. The review
  seam alone creates one (C-50).

### Browser storage adapter (Butler, isolated)

```ts
function createLocalStorageConsentPort(options: {
  key: string;
  storage?: () => Storage | undefined; // default reads globalThis.localStorage lazily
}): ConsentStoragePort;
```

- **C-16** A blocked storage, or an access that throws, reads as
  `unavailable` and never throws to the caller. A cross-tab change arrives
  through the `storage` event via `subscribe`, and only an event for the
  configured key reaches the listener. The adapter returns the raw stored
  value, performs no migration (C-10), and writes nothing except the
  current record shape under the configured key.

### Analytics transport (Observer, isolated)

```ts
interface AnalyticsLocation { href: string; referrer?: string }
interface AnalyticsProviderPort {
  init(): void;            // forced options already fixed by the adapter (C-44)
  capture(event: SanitizedAnalyticsEvent): void;
  optIn(): void;
  optOut(): void;          // stop sending and clear provider persistence; queue behaviour is open question 6
}
type SanitizedAnalyticsEvent =
  | { kind: "pageview"; url: string; referrerOrigin?: string; properties: Readonly<Record<string, never>> }
  | { kind: "conversion"; name: string; url: string; referrerOrigin?: string;
      properties: Readonly<Record<string, string | number | boolean>> };
interface AnalyticsTransport {
  setPermission(allowed: boolean): void;
  pageview(location: AnalyticsLocation): void;
  conversion(name: string, location: AnalyticsLocation, properties?: Record<string, unknown>): void;
  dispose(): void;
}
interface AnalyticsScheduler { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
function createAnalyticsTransport(options: {
  loadProvider: () => Promise<AnalyticsProviderPort>;
  allowedConversions: readonly string[];
  allowedProperties?: Readonly<Record<string, readonly string[]>>;
  normalizePath?: (pathname: string) => string;
  scheduler?: AnalyticsScheduler;   // default: globalThis timers, looked up at call time
  maxQueued?: number;               // default 50; overflow drops the oldest
}): AnalyticsTransport;
function sanitizeAnalyticsEvent(
  input: { kind: "pageview" | "conversion"; name?: string; location: AnalyticsLocation; properties?: Record<string, unknown> },
  allow: { conversions: readonly string[]; properties?: Readonly<Record<string, readonly string[]>>; normalizePath?: (pathname: string) => string },
): SanitizedAnalyticsEvent | null;
interface PostHogLike {
  init(apiKey: string, config: Record<string, unknown>): unknown;
  capture(eventName: string, properties?: Record<string, unknown>): unknown;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
}
function createPostHogProvider(sdk: PostHogLike, config: {
  key: string;
  apiHost: string;
  normalizePath?: (pathname: string) => string;
}): AnalyticsProviderPort;
```

`PostHogLike` is the subset of the provider SDK object that the adapter
calls, declared structurally so that the package never imports the SDK
(C-3). The key and host are host values (O-7). The provider adapter takes
no other option; nothing a host passes can reach the SDK's configuration.

- **C-17 Off by default.** Permission starts `false`. While permission is
  unknown or denied, the transport never calls `loadProvider`, never
  initializes and never captures. A capture made before permission is
  dropped, not queued.
- **C-18 Initialization is lazy and happens once.** An initial
  `setPermission(true)` starts one load. When the load resolves, the
  transport calls `init()` and then `optIn()`. Captures made while loading
  go into the bounded memory queue (C-43). The provider is initialized at
  most once per page. A later grant after a withdrawal calls `optIn()` and
  never a second `init()`.
- **C-19 Withdrawal cancels everything pending.** `setPermission(false)`
  advances a generation counter. It clears the queue and every scheduled
  retry or delayed capture, and calls `optOut()` if the provider was
  initialized. A load that resolves after a withdrawal is discarded and
  never initialized.
- **C-20 Events are redacted before capture.** URLs keep the origin and
  path, and lose the query and fragment. When `normalizePath` is given, it
  runs on the path, and its output is accepted only if it still starts with
  `/` and contains no `?` or `#`; otherwise the event is dropped. The
  referrer is reduced to an origin. Only pageviews and allowlisted
  conversions are sent. Properties are allowlisted per event and limited to
  bounded primitive values. No `identify` call exists on any port.
- **C-43 Transport limits are fixed and typed for any runtime.** A failed
  load schedules one retry after 5000 milliseconds through the scheduler;
  if the retry fails, the transport stays off for the page load and drops
  captures. The default scheduler looks up `globalThis.setTimeout` and
  `globalThis.clearTimeout` when it schedules, never at module scope. The
  queue holds at most `maxQueued` events (default 50), and an overflow drops
  the oldest. The subtree uses no DOM type: it compiles under Observer's
  existing compiler settings (ES2022 library without DOM,
  `exactOptionalPropertyTypes`, NodeNext resolution with explicit file
  extensions in relative imports) with no change to them.
- **C-44 The provider adapter forces safe options and sanitizes the SDK's
  own properties.** `init()` calls the SDK's `init` with the host key and
  a configuration that the adapter alone writes:
  `api_host` (the host value), `autocapture: false`,
  `capture_pageview: false`, `capture_pageleave: false`,
  `disable_session_recording: true`, `disable_surveys: true`,
  `advanced_disable_feature_flags: true`,
  `advanced_disable_feature_flags_on_first_load: true`,
  `person_profiles: "identified_only"` (no `identify` call exists, so no
  person profile is created), `persistence: "memory"`,
  `opt_out_capturing_by_default: true`, and a `before_send` hook. The hook
  drops any event whose name the transport did not send, reduces every
  URL-valued property the SDK adds (the current URL, the path, the
  referrer and their initial-visit variants, listed as one constant in the
  adapter) by the rules of C-20, and leaves the SDK's own delivery fields
  alone. Whether these option names behave as named in the SDK version a
  host installs is separate evidence (see "Separate evidence").

### Presentation (Designer)

`ConsentBanner` keeps its current contract: a region landmark named by its
title, one body, an optional policy-link slot, and accept and reject as two
`Button`s of the same variant and size. It is not a dialog and has no focus
trap, autofocus, Escape handling, portal or timer. Actions stack at the base
size and sit in a row from `tablet`. Logical properties keep it correct in
right-to-left layouts.

- **C-21 A status line is presentation, not state.** Unit D adds one
  optional prop, `status?: ReactNode`. The block always renders a polite
  live region (`role="status"`) after the body and before the actions,
  empty when `status` is absent, so that a status added later is announced.
  Neither action is ever disabled. The assembly decides which status to
  pass (C-25).

### Assembly (Publisher)

```ts
// @clossys/publisher/web/consent (client-only; refuses react-server)
interface ConsentStoragePortView {   // structural mirror of Butler's ConsentStoragePort
  read(): { kind: "value"; value: unknown } | { kind: "empty" } | { kind: "unavailable" };
  write(choice: unknown): { kind: "ok" } | { kind: "unavailable" };
  remove(): { kind: "ok" } | { kind: "unavailable" };
  subscribe?(onExternalChange: () => void): () => void;
}
interface ConsentLifecycleInput {
  signals: { gpc: boolean };
  storage?: ConsentStoragePortView;  // present only under the review seam
  evidence?: false;                  // present only under the review seam
  simulated?: true;                  // present only under the review seam
}
interface ConsentLifecyclePort {     // structural mirror of Butler's ConsentLifecycle
  getSnapshot(): ConsentSnapshotView;
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshotView;
  refuse(): ConsentSnapshotView;
  refresh(): ConsentSnapshotView;
  dispose(): void;
}
interface AnalyticsPermissionPort { setPermission(allowed: boolean): void }
interface ConsentExperienceProps {
  copy: ResolvedConsentCopy;
  createLifecycle: (input: ConsentLifecycleInput) => ConsentLifecyclePort; // client mount only
  transport?: AnalyticsPermissionPort;
  required?: boolean;                      // default true
  policyLink?: { href: string } | false;   // labelled by copy.privacyLinkLabel
  reopen?: { fragment?: string | false; eventName?: string | false };
  onChange?: (choice: "granted" | "denied") => void;
  reviewSeam?: { param?: string } | false; // default on, loopback hosts only
  children?: ReactNode;
}
function ConsentExperience(props: ConsentExperienceProps): ReactNode;
function bindTransport(lifecycle: ConsentLifecyclePort, transport: AnalyticsPermissionPort): () => void;
function useAnalyticsAllowed(): boolean;
function useConsentStatus(): ConsentStatusView;
```

`ConsentSnapshotView` mirrors Butler's `ConsentSnapshot` field for field,
including `regime`, except that `evidence` may also be `"simulated-saved"`,
which only the preview produces (C-34). There is no `regime` prop: the
lifecycle's snapshot is the single regime source, and the host passes the
regime to `createConsentLifecycle` inside its factory. `ConsentStatusView`
is `{ persistence, storage, evidence, withdrawal, gpcInForce, simulated }`,
where `simulated` is `false` or the active review-seam value.
`ResolvedConsentCopy` is defined under Copy.

- **C-22 Hydration-safe.** The server render and the initial client render
  use the no-decision snapshot. No notice renders, and `useAnalyticsAllowed()`
  is `false`, under every regime. Storage, Global Privacy Control and the
  reopen fragment are read only after mount. The server HTML therefore
  never depends on a stored choice and never mismatches on hydration.
- **C-23 Both gate conditions are required.** Analytics may start only when
  `required` is true **and** a non-simulated lifecycle reports allowed.
  With `required={false}` and no active review-seam value, the notice never
  shows, reopening does nothing, `createLifecycle` is never called, the
  transport is never bound and `useAnalyticsAllowed()` is `false`. With
  `required={false}` and an active seam value, `createLifecycle` is called
  once, for the seam only (C-50), and analytics stays off.
- **C-24 `onChange` is for choices only.** It fires once per accept or
  reject press that the lifecycle acts on. It never fires on mount, on
  reading a stored choice, on a change from another tab, on expiry, on
  Escape, for a no-op accept (C-39) or under the review seam. It reports a
  choice; it is never a permission signal. Hosts gate analytics on
  `useAnalyticsAllowed()` or the bound transport, never on `onChange`.
- **C-25 One notice, and what stays visible.** The notice opens by itself
  only when the snapshot's `promptAutomatically` holds. It otherwise opens
  only through reopen. A choice closes it, with one exception: after a
  failed withdrawal it stays open with the `withdrawalFailed` status
  (C-13). A no-op accept (C-39) is not a choice, so the notice stays as it
  was, showing `gpcInForce`. Every other status (`memoryOnly`,
  `storageUnavailable`, `evidenceUnavailable`, `evidenceConflict`) closes
  with the choice and is shown the next time the notice opens and through
  `useConsentStatus()`. Focus returns as C-26 describes. No other consent
  surface exists: no dialog, no preferences screen, no footer control.
- **C-26 Escape sets the notice aside.** The assembly wrapper handles
  Escape; Designer does not. Escape inside the notice closes it for the
  current page view, in memory. It records nothing, calls no port, fires no
  `onChange` and changes no permission. A full document load starts a new
  page view; a client-side route change does not. While `withdrawal` is
  `failed`, Escape does nothing, so it never hides the sole failure signal.
  When the notice closes by Escape or by a choice, focus returns to the
  element that held focus before it opened if that element is still in
  the document, and otherwise to the `main` landmark.
- **C-27 Reopen needs no import.** A fragment (default `privacy-choices`,
  written without `#`; a leading `#` in the prop is ignored) or a document
  event (default name `privacy-choices:open`) opens the notice. The handler
  is idempotent, so a second trigger while open does nothing. It removes the
  fragment with `history.replaceState` after opening, without adding a
  history entry. Reopening shows the regime's lead and both actions, and
  the notice opens even when storage could not be read (C-37). A fragment
  present at load is honoured after mount. An event dispatched before
  mount is not queued.
- **C-28 Copy is regime-aware.** The body is exactly one sentence: the
  `prompt` lead when the snapshot's `regime` is `prompt` and the `notice`
  lead when it is `notice`.
- **C-29 No toast dependency.** The assembly mounts no `Toaster` and imports
  no Designer `/shell` entry. A state that must be seen, such as a failed
  withdrawal, is shown in the notice itself. A host that also wants a toast
  reads `useConsentStatus()` and calls its own `toast()` inside its own
  client boundary.
- **C-45 The transport is bound synchronously.** `bindTransport` calls
  `transport.setPermission(snapshot.allowed && !snapshot.simulated)` once
  when bound and again inside every `subscribe` notification, never from a
  React effect, so a withdrawal reaches the transport before `refuse()`
  returns. Unbinding calls `setPermission(false)`. The assembly binds the
  `transport` prop only when `required` is true and only to a
  non-simulated lifecycle, and unbinds on unmount or when `required`
  becomes `false`.
- **C-46 Expiry is noticed without timers.** The assembly calls
  `refresh()` when the document becomes visible again (`visibilitychange`),
  on `pageshow` (including a restore from the back/forward cache) and
  before opening on reopen. It sets no timer for expiry.
- **C-47 Focus on open.** A notice that opens by itself does not move
  focus. A notice opened by the fragment or the event receives focus on
  its region, through a wrapper the assembly owns, so Designer still has no
  autofocus.
- **C-48 Hooks and lifecycle ownership.** Outside a `ConsentExperience`,
  `useAnalyticsAllowed()` returns `false` and `useConsentStatus()` returns
  the no-decision status. The assembly creates the lifecycle in a mount
  effect and disposes it in that effect's cleanup, so a development double
  mount leaves exactly one live lifecycle. A change of `required` from
  `true` to `false` disposes it and unbinds the transport; a change back
  creates a new one.
- **C-49 Boundaries are refused by the export map.** The subpaths are
  conditional exports whose refused condition maps to a module that throws
  at import with an error naming the subpath and the condition:
  `./web/consent` maps `react-server` to a refusal and its default to the
  client entry, whose modules begin with the `"use client"` directive
  (Publisher's existing `.client.tsx` convention); `./web/consent/preview`
  maps `react-server` to a refusal, `development` to the preview entry and
  its default to a refusal; `./consent-copy` maps `browser` to a refusal
  and its default to the server entry. No current Publisher subpath uses a
  throwing condition module (`./web` maps `react-server` to a server entry,
  not a refusal), so #1941 establishes the pattern and P-22 proves it.
  Common bundlers set the `development` condition but Node does not by
  default, so the preview factory also refuses `production` at run time
  (C-4), and tests pass the condition explicitly.

### Review seam (Publisher, real build)

- **C-30 Loopback only.** The seam is active only when `location.hostname`
  is exactly `localhost`, `127.0.0.1` or `[::1]`. On any other host the query
  parameter does nothing, and the page behaves as if it were absent. An
  application shell that serves a production build from a loopback origin
  also matches, so such a host passes `reviewSeam={false}` (H-6).
- **C-31 What the values do.** The parameter (default `consent-review`)
  takes `fresh`, `granted`, `refused`, `gpc` or `live`. A value other than
  `live` lasts for the tab: the seam keeps it in a session-scoped marker
  under its own key (the parameter name), never under the consent key, and
  `live` clears the marker and restores real behaviour. If the session
  marker cannot be written, the value lasts for the page load. Every value
  except `live` keeps the notice reviewable even with `required={false}`.
- **C-32 Simulation is not a choice.** Under any value except `live`, the
  real storage key is never written, the evidence port is never called,
  `onChange` never fires, the transport is never bound and
  `useAnalyticsAllowed()` returns `false`. `useConsentStatus().simulated`
  names the simulated value.
- **C-50 How the seam builds its lifecycle.** Under a value other than
  `live`, the assembly calls `createLifecycle` with
  `{ signals: { gpc: value === "gpc" }, storage, evidence: false,
  simulated: true }`, where `storage` is an in-memory port that the assembly
  defines structurally and that starts empty. For `granted` and `refused`
  the assembly then calls `grant()` or `refuse()` once on that lifecycle,
  so the seeded state comes from Butler's own rules, with no fixture and no
  re-implemented rule. The host's factory honours these fields (H-3). If
  the returned lifecycle's snapshot does not report `simulated: true`, the
  assembly disposes it, reports a development error and shows nothing.

### Fixed-clock preview (Publisher, isolated)

```ts
// preview entry: development only, not reachable from any production entry (C-4, C-49)
type ConsentPreviewState =
  | "fresh-prompt" | "fresh-notice" | "remembered-granted" | "remembered-refused"
  | "withdrawn" | "expired" | "gpc" | "not-required"
  | "pending-grant" | "simulated-saved" | "conflict" | "unavailable"
  | "pending-withdrawal" | "withdrawal-failed" | "reopen-unreadable";
function createConsentPreview(options: {
  state: ConsentPreviewState;
  now: string;                         // fixed ISO instant
  environment: "development" | "preview" | "production"; // production throws
}): {
  lifecycle: ConsentLifecyclePort;
  required: boolean;                   // false only for "not-required"
  settle(result: "simulated-saved" | "conflict" | "unavailable"): void;
  dispose(): void;
};
```

- **C-33 The preview is deterministic and inert.** It uses no storage, no
  network, no timers, no SDK, no Butler or Observer import and no clock
  read. Asynchronous outcomes happen only on an explicit `settle()`.
  `dispose()` releases every listener. Its lifecycle always reports
  `simulated: true`, so the transport is never bound to it (C-45).
- **C-34 Simulated never reads as durable.** The preview can produce
  `simulated-saved` and can never produce `saved`. The live lifecycle can
  never produce `simulated-saved`, and the two are distinct types.
  `expired` renders byte-identically to `fresh-prompt`, with no expiry
  wording. The dialog-only "cancel" state of earlier revisions no longer
  exists.
- **C-51 The preview states are exactly this table.** Each state produces
  the snapshot fields listed (every field not listed has its
  `NO_DECISION_SNAPSHOT` value, except `simulated: true`), the `required`
  value, and the notice behaviour on arrival and on reopen.

| State | Snapshot fields | `required` | On arrival | On reopen |
| --- | --- | --- | --- | --- |
| `fresh-prompt` | `regime: "prompt"`, `effective: "none"`, `promptAutomatically: true` | true | open, no status | open, no status |
| `fresh-notice` | `regime: "notice"`, `effective: "none"`, `allowed: true` | true | closed | open, no status |
| `remembered-granted` | `effective: "granted"`, `allowed: true`, `persistence: "stored"` | true | closed | open, no status |
| `remembered-refused` | `effective: "denied"`, `persistence: "stored"` | true | closed | open, no status |
| `withdrawn` | `effective: "denied"`, `persistence: "stored"`, `sequence: 1` | true | closed | open, no status |
| `expired` | identical to `fresh-prompt` | true | open, no status | open, no status |
| `gpc` | `effective: "denied"`, `gpcInForce: true` | true | closed | open, `gpcInForce` |
| `not-required` | as `NO_DECISION_SNAPSHOT` | false | nothing mounted | nothing |
| `pending-grant` | `effective: "granted"`, `allowed: true`, `persistence: "stored"`, `evidence: "pending"` | true | closed | open, no status |
| `simulated-saved` | as `pending-grant` with `evidence: "simulated-saved"` | true | closed | open, no status |
| `conflict` | as `pending-grant` with `evidence: "conflict"` | true | closed | open, `evidenceConflict` |
| `unavailable` | as `pending-grant` with `evidence: "unavailable"` | true | closed | open, `evidenceUnavailable` |
| `pending-withdrawal` | `effective: "denied"`, `persistence: "stored"`, `evidence: "pending"`, `sequence: 1` | true | closed | open, no status |
| `withdrawal-failed` | `effective: "denied"`, `persistence: "memory"`, `withdrawal: "failed"` | true | open, `withdrawalFailed` | open, `withdrawalFailed` |
| `reopen-unreadable` | `effective: "unknown"`, `storage: "unreadable"` | true | closed | open, `storageUnavailable` |

### Copy (Publisher, server-only)

```ts
// @clossys/publisher/consent-copy (server-only; refuses the browser condition)
interface ConsentCopyRefs {
  title: CopyRef; promptLead: CopyRef; noticeLead: CopyRef;
  acceptLabel: CopyRef; rejectLabel: CopyRef; privacyLinkLabel: CopyRef;
  status: {
    memoryOnly: CopyRef; withdrawalFailed: CopyRef; evidenceUnavailable: CopyRef;
    evidenceConflict: CopyRef; storageUnavailable: CopyRef; gpcInForce: CopyRef;
  };
}
interface ResolvedCopyField { text: string; recordId: string; entryId: string; revision: string; locale: string }
type ResolvedConsentCopy =
  { [K in Exclude<keyof ConsentCopyRefs, "status">]: ResolvedCopyField } &
  { status: { [K in keyof ConsentCopyRefs["status"]]: ResolvedCopyField } };
function resolveConsentCopy(input: {
  resolveCopy: CopyResolver;           // Writer's (ref) => CopyResolution | undefined
  target: "preview" | "production";    // the target the resolver was created with
  refs: ConsentCopyRefs;
  locale: string;
}): ResolvedConsentCopy;
```

- **C-35 Copy is refused unless it is approved for this use.** Resolution
  throws an error naming the field (never echoing the text) when the
  resolver returns nothing for it, which covers copy that Writer's resolver
  refuses: unapproved, stale against its fingerprint, past a delegate
  approval's `expiresAt`, or outside the delegate's scope. It also throws
  for text that is blank or contains the placeholder sentinel, and for a
  resolution whose `locale` differs from the one requested. Both leads and
  every status key are required whatever the current regime. A package
  default bound for another surface (for example the authentication forms)
  is not an approval of consent copy.
- **C-52 The resolver is bound by the host, and production is stricter.**
  `CopyResolver` is Writer's type. The host creates it with Writer's
  `createCopyResolver(registry, { target, now, ... })`, so it is already
  bound to a target and a clock, and `resolveConsentCopy` takes no clock.
  Hosts map their environment to a target: `development` and `preview`
  use `"preview"`, and `production` uses `"production"`. Under
  `"production"`, a resolution with no `approval` is refused, and so is
  synthetic copy. Writer has no fixture marker, so consent copy treats a
  registry whose `source.kind` is `"generated"` as synthetic.

### Bouncer interactions (#1947, independent)

- **C-36** Consent never depends on Bouncer, and Bouncer never depends on
  consent. Two interactions are host concerns (H-5). First, a provider's
  script and connection hosts appear in the content security policy only
  when the host lists them as explicit extensions; consent adds none.
  Second, a hardened sign-out that sends `Clear-Site-Data` with `storage`
  removes the consent record, so the next visit reads as no choice (C-7).
  Global Privacy Control still holds. This rule has no proof in this
  cohort; #1947 carries its own.

## Host obligations

These bind the host application, not a package. No package can enforce
them, so each is stated here and repeated in the README of the package
that exposes the relevant API.

- **H-1 Public pre-authentication surfaces only.** The host runs the
  transport only on public pre-authentication surfaces, never on
  application, administration or demonstration surfaces.
- **H-2 Gate on permission, not on events.** The host reads
  `useAnalyticsAllowed()` or binds its transport through the `transport`
  prop, and never treats `onChange` as permission (C-24).
- **H-3 Honour the factory input.** The host's `createLifecycle` passes
  `input.storage` instead of its real storage port when present, passes no
  evidence port when `input.evidence` is `false`, passes
  `simulated: true` when `input.simulated` is set, and binds no transport
  itself. It has no side effect beyond constructing the lifecycle.
- **H-4 Pageviews are the host's call.** The host sends a pageview for each
  navigation while analytics is allowed, and one for the current page when
  permission becomes true. The transport never synthesizes a pageview, and
  a pageview sent before permission is dropped (C-17).
- **H-5 Sign-out clearing under `notice`.** Under the `notice` regime, a
  sign-out that clears site storage also clears a visitor's refusal, so
  analytics becomes allowed again on their next public page unless Global
  Privacy Control is on. A host that uses both should serve its public
  pre-authentication surface from an origin that the sign-out response does
  not clear (`Clear-Site-Data` applies to the responding origin), or omit
  `storage` from the directive for that origin when its hardening allows.
  This is open question 5 and needs the owner's acknowledgement.
- **H-6 Disable the seam where loopback is production.** A host whose
  production build is served from a loopback origin passes
  `reviewSeam={false}` (C-30).
- **H-7 Pre-hydration callers apply `required` and the seam.** A host that
  calls the pure decision functions before hydration applies `required` and
  the review seam itself, and starts no analytics before mount.

## Superseded ticket text

Where an issue body says the following, this document controls.

- **#1938 "stale" state.** There is no `stale` effective choice. An expired
  record reads as no choice (C-7).
- **#1938 within-service sibling scope.** Dropped. The record has one
  configured key and no scope field.
- **#1938 reuse of standing-instruction ports.** Replaced by the
  synchronous storage port and the optional evidence port; see "Lifecycle
  and ports".
- **#1938 clamp mutation test.** The month-end clamp mutation belongs to
  #1978 (P-1), not #1938.
- **#1938 legacy flag on the adapter.** Migration lives in
  `parseStoredChoice` through `policy.legacy` (C-10); the adapter has no
  legacy option.
- **#1560, #1941 and #1981 dialog, preferences panel and footer reopen.**
  Superseded by the single notice reopened by an anchor link or an event
  (decision 1, C-25, C-27).
- **#1941 Escape in Designer.** Escape is handled by the Publisher wrapper
  (C-26).
- **#1941 `regime` prop.** Removed; the regime comes from the lifecycle
  snapshot.
- **#1941 dependency on #1938 and #1940.** #1941 depends on this document
  and unit D only; see "Source units".
- **#1941 simulated Global Privacy Control scope.** The owner's wording
  "for the tab" stands (C-31).
- **#1981 helper signatures.** The helpers take a `ConsentPolicy` object
  instead of a policy-version string.
- **Pinned base `eecbae24`.** Superseded; builders branch from the current
  default branch.
- **Specification revision.** Tickets that cite revision 2 or 4 are
  superseded by revision 5, this document.

## Source units

Dependency order for builders:

1. **#1978 Butler date helpers.** Independent.
2. **#1938 Butler lifecycle** depends on this document and #1978.
   **#1940 Observer transport** depends on this document. The two are
   independent of each other and may run in parallel.
3. **Unit D Designer status slot.** Depends on this document.
4. **#1941 Publisher assembly and Publisher exports.** Depends on this
   document and unit D only. It builds against its own structural ports
   and the preview, so presentation never waits for a backend.
5. **Unit E Butler and Observer exports and port conformance.** Depends on
   #1938, #1940 and #1941.
6. **#1942 release preparation.** Depends on #1978, #1938, #1940, unit D,
   #1941 and unit E.
7. **#1947 Bouncer.** Independent of every unit above.

#1981 is a behaviour issue, not a build unit. Its record, decision and
expiry behaviour is built in #1938, and its reopen seam and copy in #1941.

### #1978 Butler date helpers

- Paths: one module with the stem `calendar-months` in `packages/butler/src/`
  plus its test, the root barrel and the README API table.
- API: `addCalendarMonthsUtc(from: Date, months: number): Date` and
  `isWithinWindow(start: Date, end: Date, now: Date): boolean`. Invalid
  input throws a typed error: negative, fractional or non-finite months, or
  an invalid date.
- Fixtures: 2026-08-31 + 6 = 2027-02-28, 2023-08-31 + 6 = 2024-02-29,
  2024-02-29 + 6 = 2024-08-29, 2026-01-31 + 1 = 2026-02-28, and the end
  instant is outside the window.
- Proof: P-1.

### #1938 Butler lifecycle

- Paths: `packages/butler/src/browser-consent/` only. Suggested modules:
  `record`, `decision`, `lifecycle` and `adapters/local-storage`, and an
  internal `index` barrel, with the tests named below. The package root and
  the manifest stay untouched.
- API: the record and decision rules, the lifecycle and ports, and the
  storage adapter, as specified in Contracts.
- State transitions: the transition table; C-5 to C-16 and C-37 to C-42.
- Fixtures: a fixed clock, an in-memory storage port with switchable
  failure modes (read unavailable, write fails, remove fails, read returns
  a stale grant), a deferred evidence port that resolves on demand and
  records each `sequence`, a legacy record, and a future-dated record.
- Proof: P-2 to P-8, P-23 to P-26.

### #1940 Observer transport

- Paths: `packages/observer/src/browser-analytics/` only. Suggested
  modules: `transport`, `sanitize` and `providers/posthog`, and an internal
  `index` barrel. The root, the manifest and the compiler settings stay
  untouched.
- API: the transport, the sanitizer and the provider adapter, as specified
  in Contracts.
- State transitions: `off` → (`setPermission(true)`) `loading` → `ready`;
  `loading` → (load fails) `retry-scheduled` → `loading` once, then
  `failed` for the page load; any state → (`setPermission(false)`) `off`
  with the generation advanced; `ready` → (re-grant) `ready` via `optIn()`.
- Fixtures: a fake provider that records every call, a deferred loader, a
  manual scheduler, and a `PostHogLike` fake object that records the
  `init` configuration and runs its `before_send` hook. No real SDK is
  installed or imported.
- Proof: P-9 to P-13, P-27.

### Unit D Designer status slot

- Paths: the `ConsentBanner` block source in `packages/designer/src/blocks/`,
  its test, its README entry, and one `.changesets/` entry for `designer`
  at `minor`. It uses utility classes already present in Designer's
  compiled stylesheet; a unit that needs a new class also takes the
  compiled stylesheet and its generator command into its paths.
- API: `ConsentBannerProps.status?: ReactNode`, rendered per C-21. Every
  other prop is unchanged.
- Proof: P-14.

### #1941 Publisher assembly and exports

- Paths: `packages/publisher/src/web/consent/**` and
  `packages/publisher/src/consent-copy/**`, the Publisher manifest's export
  map, the public entry modules, the README, the test files listed on the
  ticket, and one `.changesets/` entry for `publisher` at `minor`.
  Suggested modules: `ports`, `ConsentExperience`, `hooks`,
  `bind-transport`, `reopen`, `review-seam`, `preview/adapter` and
  `consent-copy/resolve`.
- API: the assembly, transport binding, review seam, fixed-clock preview
  and copy, as specified in Contracts. Export keys: `./web/consent`
  (client-only), `./web/consent/preview` (development only) and
  `./consent-copy` (server-only), mapped as C-49 describes.
- State transitions: the presentation states follow the lifecycle snapshot.
  The notice states are `hidden-unmounted`, `closed`, `open`,
  `open-with-status` and `set-aside` (after Escape, for the page view).
- Fixtures: the preview's lifecycle, a recording `createLifecycle` factory,
  a recording permission port, and a Writer registry fixture with
  approved, draft, stale, expired-delegate, out-of-scope, wrong-locale,
  placeholder and generated-source entries. Loopback and non-loopback host
  fixtures cover the seam.
- Proof: P-15 to P-22, P-28 to P-30.

### Unit E Butler and Observer exports and port conformance

- Paths: the Butler and Observer manifests' export maps, a public entry
  module per new subpath inside `browser-consent/` and
  `browser-analytics/`, both READMEs' API sections, the root README rows if
  its parity check requires them, one `.changesets/` entry naming `butler`
  and `observer`, each at `minor` (a new public subpath on a 0.x package),
  and a repository-level conformance test outside every package's shipped
  source.
- Export keys: `@clossys/butler/browser-consent` (the pure functions, the
  lifecycle and the types, with no adapter),
  `@clossys/butler/browser-consent/local-storage` (the storage adapter
  alone), `@clossys/observer/browser-analytics` (the transport and the
  sanitizer) and `@clossys/observer/browser-analytics/posthog` (the
  provider adapter alone). Adapters ship in their own subpaths so that
  importing the decision functions never reaches one (O-5).
- **C-53 The real implementations satisfy Publisher's structural ports.**
  Butler's `ConsentLifecycle` is assignable to `ConsentLifecyclePort`,
  Butler's `ConsentStoragePort` to and from `ConsentStoragePortView`,
  Butler's lifecycle options accept every `ConsentLifecycleInput` field,
  and Observer's `AnalyticsTransport` is assignable to
  `AnalyticsPermissionPort`.
- Proof: P-31.

### Unowned work

- **Unit D** has no ticket. The `ConsentBanner` block source is outside the
  paths #1941 lists.
- **Unit E** has no ticket. #1938 and #1940 forbid their package index and
  manifests, #1941 forbids both packages, and #1942 forbids source. Hosts
  cannot import Butler's or Observer's new subpaths until unit E lands.

## Proof cases

Every proof is a named test plus a mutation. A test file stem names the test
file beside the unit's source, with the repository's usual test suffix; the
unit's ticket fixes the exact file name. The mutation is applied to the
finished implementation, the named test must fail on an assertion (not on an
import or harness error), and then the code is restored and the suite
passes. "Covers" lists the rules each proof holds.

| ID | Unit | Test file stem :: test | Covers | Mutation that must fail it |
| --- | --- | --- | --- | --- |
| P-1 | #1978 | `calendar-months` :: month-end clamping fixtures and exclusive end | C-6, C-7 | drop the clamp (`setUTCMonth(getUTCMonth() + n)`) |
| P-2 | #1938 | `lifecycle` :: stale grant cannot override withdrawal | C-12 | remove the `seq` guard |
| P-3 | #1938 | `persistence` :: a failed save never reports a stored choice, and a memory-only choice never reaches the evidence port | C-11, C-41 | report `stored` after an `unavailable` write; call evidence after a failed write |
| P-4 | #1938 | `expiry` :: expiry fixed at decision and not renewed by reads or reopenings; every explicit choice writes a fresh record; expired reads as no choice; reading caps expiry; a future-dated denial stays live and a future-dated grant does not | C-6, C-38, C-40 | recompute `expiresAt` on read; skip the read-time cap; treat a future-dated denial as no choice |
| P-5 | #1938 | `decision` :: regime (`prompt`, `notice`, missing) × GPC (on, off) × record (none, granted, granted with override, denied, expired, older policy, corrupt, unreadable) | C-5, C-7, C-8, C-9, C-37 | default a missing regime to `notice`; treat unreadable as no choice under `notice` |
| P-6 | #1938 | `withdrawal` :: a refusal from a grant, and from no choice under `notice`, is a withdrawal; `allowed: false` is published before the write; write and removal both failing with a grant still readable is `failed`; under `notice`, a failed write with a successful removal is `failed` | C-13, C-15 | report success without read-back; treat a refusal from no choice under `notice` as a plain refusal |
| P-7 | #1938 | `browser-only` :: with no evidence port, a grant-and-refuse cycle makes zero `fetch` or `sendBeacon` calls and evidence is never `saved` | C-14 | report `saved` without a port |
| P-8 | #1938 | `isolation` :: no core module reads a browser global at module scope or imports an adapter; a legacy record parses only with `policy.legacy`, takes `assumedPolicyVersion`, keeps its original expiry and is never rewritten | C-2, C-10 | add a module-scope `localStorage` read; rewrite a legacy record on read; treat a dateless legacy record as live |
| P-9 | #1940 | `transport` :: unknown consent never loads or captures | C-17 | initialize while permission is unknown |
| P-10 | #1940 | `transport` :: withdrawal blocks a pending retry and a late load | C-19 | send a queued capture after withdrawal; initialize a load that resolved after withdrawal |
| P-11 | #1940 | `sanitize` and `posthog` :: initialization happens once; queries and fragments are removed; the referrer becomes an origin; an invalid `normalizePath` result drops the event; the `before_send` hook reduces every SDK-added URL property and drops events the transport did not send | C-18, C-20, C-44 | initialize on every capture; keep the query string; pass SDK-added properties through unchanged |
| P-12 | #1940 | `posthog` :: the `init` configuration holds every forced key with its value, `opt_out_capturing_by_default` is set, no host value except key and host reaches it, and the adapter imports no SDK | C-3, C-44 | omit a forced init key |
| P-13 | #1940 | `root-isolation` :: the Observer root import graph reaches no `browser-analytics` module | O-4, C-1 | re-export the transport from the root |
| P-14 | D | `ConsentBanner` :: the polite live region is always mounted, empty without a status; both actions stay enabled and equal | O-2, C-21 | disable reject while a status shows; mount the live region only with a status |
| P-15 | #1941 | `ConsentExperience` :: `required={false}` creates no lifecycle, binds no transport and ignores reopen; `onChange` fires on an acted-on choice only and never for a no-op accept | C-23, C-24, C-39 | fire `onChange` on mount or on a stored read; fire `onChange("granted")` for a no-op accept |
| P-16 | #1941 | `ConsentExperience` :: Escape records nothing and returns focus; Escape does nothing while a withdrawal has failed; withdrawal stays enabled while a grant is pending; a failed withdrawal keeps the notice open with its status; other statuses close with the choice | C-13, C-15, C-25, C-26 | persist Escape; close on a failed withdrawal; let Escape hide a failed-withdrawal notice |
| P-17 | #1941 | `ConsentExperience` :: server and initial client render match the no-decision snapshot | C-22 | read storage during render |
| P-18 | #1941 | `reopen` :: fragment and event open once, a leading `#` is ignored, the fragment is cleared, focus moves to the reopened notice, and `refresh()` runs on reopen, on `visibilitychange` and on `pageshow` | C-27, C-46, C-47 | open a second notice on a repeated trigger; skip `refresh()` on reopen |
| P-19 | #1941 | `review-seam` :: each value on loopback; ignored elsewhere; the factory receives the in-memory port, `evidence: false` and `simulated: true`; a factory that returns a non-simulated lifecycle disables the seam; the real key is never written; the transport is never bound; the value lasts for the tab | C-30, C-31, C-32, C-50 | accept a non-loopback host; bind the transport to a seeded lifecycle |
| P-20 | #1941 | `consent-copy/resolve` :: both leads and every status key required; draft, stale, expired-delegate, out-of-scope, wrong-locale, blank and placeholder copy refused; under `production`, unapproved and generated-source copy refused | C-35, C-52 | omit the `notice` lead; accept generated-source copy under `production` |
| P-21 | #1941 | `preview/adapter` :: each of the fifteen states produces its table row; zero I/O and no timers; explicit settle; `expired` identical to `fresh-prompt`; no `saved` from the preview; `production` refused | C-33, C-34, C-51 | auto-settle; return `saved`; give `withdrawal-failed` the `withdrawn` snapshot |
| P-22 | #1941 | `browser-import-closure` and `react-server-artifact` :: production closures exclude the preview and Designer's `/shell`; the client entry refuses `react-server` through its condition module; copy resolution refuses `browser`; the preview subpath refuses outside `development` | O-6, C-1, C-4, C-29, C-49 | import the preview or a Writer registry into the client entry; map `react-server` to the client entry |
| P-23 | #1938 | `gpc` :: a grant under a non-overridable signal writes nothing and calls no evidence port; a grant under an overridable signal records `gpcOverride`; a grant without it never overrides a signal that is on | C-8, C-39 | write a grant under a non-overridable signal; let a grant without `gpcOverride` override the signal |
| P-24 | #1938 | `evidence-order` :: every evidence call carries an increasing `sequence`; a conflict never upgrades to `granted` | C-12, C-41 | pass a constant `sequence` |
| P-25 | #1938 | `simulated` :: a simulated lifecycle reports `allowed: false` after a grant and never calls an evidence port | C-42 | drop the simulated override |
| P-26 | #1938 | `local-storage` :: blocked or throwing storage reads `unavailable` without throwing; only a `storage` event for the configured key reaches the listener; raw values come back unmigrated; nothing else is written | C-16 | let a throwing `getItem` propagate; notify for another key's event |
| P-27 | #1940 | `transport-limits` :: one retry after the fixed delay through the injected scheduler; the default scheduler is resolved when scheduling; the queue's default bound drops the oldest; the subtree compiles without the DOM library | C-43 | drop the newest event instead of the oldest; resolve `setTimeout` at module scope |
| P-28 | #1941 | `ConsentExperience` :: the body uses the lead that matches the snapshot's `regime` | C-28 | always use the `prompt` lead |
| P-29 | #1941 | `bind-transport` :: `setPermission(false)` has happened before `refuse()` returns; unbinding sets `false`; a simulated snapshot never sets `true` | C-45 | move `setPermission` into a React effect |
| P-30 | #1941 | `hooks` :: hooks outside a `ConsentExperience` report not allowed and the no-decision status; unmount and a `required` change dispose the lifecycle; a development double mount leaves one live lifecycle | C-48 | keep the lifecycle from the discarded mount alive |
| P-31 | E | `consent-port-conformance` :: type-level assignability of each real implementation to its structural port | O-3, C-53 | rename or retype one `ConsentSnapshot` field in Butler |

### Review proofs for this document

This document has no executable test. Its two mutation proofs are semantic,
and an independent review applies them with one mechanical reference
check: every `C-n` named in a Covers cell is defined in Contracts or in a
source unit, and every defined `C-n` except C-36 appears in at least one
Covers cell.

- **S-1** Delete C-1, C-3 or C-4. The reference check then finds a
  dangling citation (P-13 and P-22 cite C-1, P-12 cites C-3, P-22 cites
  C-4), and O-4, O-5 and O-6 lose the contract that their proofs hold.
  Changing one of them to permit SDK or storage initialization through a
  pure root, or a production import of the preview, contradicts O-4 or
  O-6 directly. Review must reject either change.
- **S-2** Delete the `withdrawal-failed` preview state or C-13. The
  reference check then finds a dangling citation (P-6 and P-16 cite C-13;
  P-21 cites C-51, whose table names `withdrawal-failed`). Making
  presentation wait for the backends, by adding #1938 or #1940 to #1941's
  dependencies or by letting the preview import Butler, contradicts C-33
  and the dependency order. Review must reject either change.

### Separate evidence

Each unit's proofs show that it is implemented. They do not show that it is
staged, published or adopted. A full publish-safety pass, packed-consumer
proof, release qualification, behaviour against a real provider SDK
(including the forced option names in C-44 and open question 6), and
adoption in a consumer's tree are separate evidence, recorded by their own
owners.

## Open questions

These could not be settled from the issues. Each has a proposed default
that builders follow until the owner decides otherwise.

1. **Accepting under a non-overridable signal.** As specified, accept stays
   offered with equal weight and is a no-op (C-39). Proposed default: keep
   this. The alternative, replacing accept with an explanation, would
   break the two-equal-actions decision.
2. **What counts as a page view for Escape.** Proposed default: a full
   document load starts one and a client-side route change does not
   (C-26).
3. **Simulated GPC scope.** Settled by the owner's wording: for the tab
   (C-31).
4. **The review seam and the transport.** Proposed default: a simulated
   lifecycle never enables the transport. Reviewing real capture locally
   would need a separate explicit opt-in, which this cohort does not add.
5. **The `notice` regime after storage is cleared.** A sign-out that clears
   storage makes analytics allowed again for a visitor who had refused,
   unless Global Privacy Control is on. Proposed default: no package
   change; H-5 states the warning and the mitigations. This needs the
   owner's acknowledgement before #1941 ships.
6. **Provider-held queues.** Whether the provider SDK's own send queue
   drops queued events on opt-out is behaviour of the real SDK. A fake
   cannot prove it. Proposed default: no package text claims that queued
   events are dropped until there is evidence from the real SDK.
7. **Storage that will not record a refusal.** Two cases reach C-13's
   residual state: storage that refuses both writing and removal and keeps
   returning the grant, and, under `notice`, a failed write with a
   successful removal, which leaves no record and so reads as allowed.
   Proposed default: no session-scoped marker. The refusal holds in memory
   for the visit and the visitor is told.
