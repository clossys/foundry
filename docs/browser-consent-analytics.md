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

Rule identifiers (`O-n`, `C-n`, `P-n`) are stable so that tickets, tests and
reviews can cite them.

## Decisions in this revision

Revision 5 replaces the earlier presentation direction. Where an issue body
still says something different, these decisions control.

1. **One compact notice with two equal actions.** There is no preferences
   dialog and no secondary reopen control in the footer. Reopening is a link
   (a fragment anchor, typically inside the privacy policy) or a reopen
   event.
2. **Global Privacy Control is a standing refusal.** A regime input is
   `prompt` or `notice`, and a missing or unknown value is `prompt`. Expiry
   is a fixed number of calendar months, computed once at decision time and
   never renewed. An expired choice is the same as no choice and shows no
   "expired" message. The reopen seam needs no package import (#1981).
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
   toast. One notice is the only consent surface.
6. **Truthful outcomes.** A simulation is never a durable acknowledgement.
   A withdrawal that fails is reported at the time and never left silent,
   so a grant that survives in storage was never presented as withdrawn. SDK work is off by default and cancellable, and events
   are redacted. Pure roots never initialize an SDK or touch storage.

## Ownership

| Concern | Owner | Location | Unit |
| --- | --- | --- | --- |
| Calendar-month arithmetic and window test | Butler | package root, pure | #1978 |
| Stored record, decision rules, lifecycle, ports | Butler | `packages/butler/src/browser-consent/` | #1938 |
| Browser storage adapter | Butler | `packages/butler/src/browser-consent/adapters/` | #1938 |
| Analytics transport and provider adapter | Observer | `packages/observer/src/browser-analytics/` | #1940 |
| Notice presentation | Designer | `ConsentBanner` block | existing, plus unit D below |
| Assembly, hook, reopen, review seam, preview | Publisher | `packages/publisher/src/web/consent/` | #1941 |
| Copy resolution against Writer approval | Publisher | `packages/publisher/src/consent-copy/` | #1941 |
| Package exports, manifests, barrels, compiled CSS | each package's export owner | manifests and barrels | #1941 for Publisher and Designer; see "Unowned work" |
| Security headers, sign-out storage clearing | Bouncer | `packages/bouncer/src/` | #1947, independent |
| Versions and changelogs for the cohort | release preparation | manifests, changelogs | #1942 |

- **O-1 Butler owns the lifecycle and nothing visual.** Butler owns the
  record, the decision rules, expiry, withdrawal, the storage port and the
  evidence port. It renders nothing and ships no wording.
- **O-2 Designer owns controlled presentation and no state.** `ConsentBanner`
  stays presentational. It holds no consent state, reads or writes no
  storage, makes no network call and ships no wording. Every state it shows
  arrives through props.
- **O-3 Publisher owns assembly through structural ports.** Publisher
  composes the Designer notice with copy it has resolved against Writer.
  It reaches the lifecycle and the transport only through port types that it
  declares structurally (mirrored shapes, not imports). Publisher source
  never imports Butler's lifecycle, Butler's adapters, Observer's transport
  or any analytics SDK. The host composes those and passes them in.
- **O-4 Observer's root stays zero I/O.** Observer's root entry point
  and everything it reaches stay pure functions of their arguments. The
  network-capable transport is a separate subtree that the root never
  imports.
- **O-5 Adapters are isolated and off by default.** The browser storage
  adapter, the provider adapter and the SDK loader each live in their own
  module. Only a host's explicit call constructs one. No package entry
  constructs one implicitly, at import or on mount.
- **O-6 Server/client boundaries are preserved.** The assembly and the
  preview are client-only and refuse the `react-server` condition. Copy
  resolution is server-only and refuses the `browser` condition. The client
  receives resolved strings, never a resolver or a registry.
- **O-7 No consumer one-offs.** No unit adds wording, an expiry length, a
  regime table, a provider key or a provider host as a package default.

## Contracts

### Pure roots and imports

- **C-1** Importing the Butler root, the Observer root, `@clossys/publisher/web`
  or the copy-resolution entry performs no storage read or write, no network
  request, no timer, no SDK load and no read of `window`, `document`,
  `navigator` or `localStorage`.
- **C-2** No module in `browser-consent/` or `browser-analytics/` touches a
  browser global at module scope. Adapters touch globals only inside
  functions that the host calls.
- **C-3** No package source imports an analytics SDK. The SDK reaches the
  transport only through a host-supplied loader, such as a dynamic import
  written in the host's own code.
- **C-4** No production entry's import closure contains the preview module
  or the review-seam state fixtures. The preview factory refuses to run when
  the host declares a production environment.

### Stored record and decision rules (Butler)

The record has four fields and carries no identifier, address, user agent or
other personal reference:

```ts
type ConsentRegime = "prompt" | "notice";
interface ConsentSignals { gpc: boolean }
interface StoredChoice {
  status: "granted" | "denied";
  decidedAt: string;     // ISO 8601 UTC
  expiresAt: string;     // ISO 8601 UTC, fixed when decided
  policyVersion: string;
}
interface ConsentPolicy {
  version: string;
  expiryMonths: number;              // whole, positive
  invalidateDenialOnPolicyBump: boolean; // required, no default
  gpcOverridable?: boolean;          // default false
}
type EffectiveChoice = "granted" | "denied" | "none";
```

- **C-5 Missing or unknown regime is `prompt`.** `normalizeRegime(value)`
  returns `"notice"` only for the exact string `"notice"`.
- **C-6 Expiry is fixed at decision time.**
  `expiresAt = addCalendarMonthsUtc(decidedAt, policy.expiryMonths)`.
  Reads, visits, reopenings and migrations never write a later `expiresAt`.
- **C-7 A record is live** when it parses and `isWithinWindow(decidedAt,
  expiresAt, now)` holds, so the end instant is outside. Its policy version
  must also equal `policy.version`. The one exception is a denial when
  `invalidateDenialOnPolicyBump` is `false`. A record that is expired,
  corrupt, of an unknown shape, or under another policy (subject to that
  rule) reads as **no choice**. No "expired" state reaches presentation.
- **C-8 Global Privacy Control is a standing refusal.** With `gpc` true,
  the effective choice is `denied`. The one exception is a live grant when
  `gpcOverridable` is `true`.
- **C-9 Regime decides what no choice means.** With no choice, `prompt` is
  not allowed and opens the notice by itself. `notice` is allowed and opens
  only on request. A denial is never allowed under either regime, and with
  GPC on the effective choice is never `none`.
- **C-10 Legacy records migrate without renewal.** A configurable storage
  key may hold an older `{ status, decidedAt }` record. Its expiry is
  computed from `decidedAt` with C-6, and a record with no readable date
  reads as no choice. Migration never extends a window.

```ts
function normalizeRegime(value: unknown): ConsentRegime;
function decideChoice(status: "granted" | "denied", now: Date, policy: ConsentPolicy): StoredChoice;
function parseStoredChoice(raw: unknown, policy: ConsentPolicy): StoredChoice | null;
function effectiveChoice(stored: StoredChoice | null, signals: ConsentSignals, policy: ConsentPolicy, now: Date): EffectiveChoice;
function isAllowed(stored: StoredChoice | null, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
function shouldPromptAutomatically(stored: StoredChoice | null, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
```

These functions are pure and safe to call before hydration. The lifecycle
and the assembly share them, and neither re-implements them.

### Lifecycle and ports (Butler)

```ts
type StorageRead = { kind: "value"; value: unknown } | { kind: "empty" } | { kind: "unavailable" };
type StorageWrite = { kind: "ok" } | { kind: "unavailable" };
interface ConsentStoragePort {            // synchronous on purpose
  read(): StorageRead;
  write(choice: StoredChoice): StorageWrite;
  remove(): StorageWrite;
  subscribe?(onExternalChange: () => void): () => void; // another tab wrote
}
type EvidenceResult = { kind: "saved" } | { kind: "conflict" } | { kind: "unavailable" };
interface ConsentEvidencePort {           // optional durable acknowledgement
  save(choice: StoredChoice, context: { signal: AbortSignal }): Promise<EvidenceResult>;
}
type EvidenceStatus = "none" | "pending" | "saved" | "conflict" | "unavailable";
interface ConsentSnapshot {
  effective: EffectiveChoice;
  allowed: boolean;
  promptAutomatically: boolean;
  persistence: "stored" | "memory" | "none";
  evidence: EvidenceStatus;
  withdrawal: "idle" | "failed";
  sequence: number;
}
interface ConsentLifecycle {
  getSnapshot(): ConsentSnapshot;   // stable identity until a change
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshot;
  refuse(): ConsentSnapshot;        // also withdraws an existing grant
  refresh(): ConsentSnapshot;       // re-evaluate against the clock and storage
  dispose(): void;
}
function createConsentLifecycle(options: {
  storage: ConsentStoragePort;
  evidence?: ConsentEvidencePort;
  policy: ConsentPolicy;
  regime: unknown;
  signals: ConsentSignals;
  clock: () => Date;
}): ConsentLifecycle;
const NO_DECISION_SNAPSHOT: ConsentSnapshot; // the server and pre-mount snapshot
```

The storage port is synchronous for two reasons. Pre-hydration callers and
`useSyncExternalStore` need a synchronous read, and the browser record
carries no subject identifier. Butler's existing asynchronous,
subject-keyed `StandingInstructionStore` therefore cannot serve as this port.
A host that wants durable server-side evidence implements
`ConsentEvidencePort`, and may back it with its own standing-instruction
store.

Transitions. `seq` is the lifecycle's in-memory decision counter.

| From | Event | Effect | Result |
| --- | --- | --- | --- |
| any | mount, storage `unavailable` | nothing starts | `none`, persistence `none`, not allowed under `prompt` |
| any | mount, corrupt or expired record | treated as absent | `none` |
| `none` or `denied` | `grant()`, write `ok` | record written, `seq+1`, evidence `pending` if a port exists, otherwise `none` | `granted`, `stored` |
| `none` or `denied` | `grant()`, write `unavailable` | choice applies in memory for this visit, no evidence call | `granted`, `memory`, evidence `none` |
| any | `refuse()` | **first** publish `allowed: false` to subscribers, then `seq+1`, abort any in-flight evidence, write a denial | see the next three rows |
| `granted` | write `ok` and read-back not allowed | evidence `pending` if a port exists | `denied`, `stored` |
| `granted` | write `unavailable`, `remove()` `ok`, read-back not allowed under the current regime | record removed | `denied` in memory, persistence `memory` |
| `granted` | read-back still evaluates as allowed | denial held in memory for this visit | `denied`, `withdrawal: "failed"` |
| any | evidence result for an older `seq` | ignored | unchanged |
| `pending` | evidence `saved` for current `seq` | none | evidence `saved` |
| `pending` | evidence `conflict` | local record re-read; a conflict never upgrades to `granted` | evidence `conflict` |
| `pending` | evidence `unavailable`, or a throw | local choice kept | evidence `unavailable` |
| any | external change (another tab) | re-read; last write wins; no message | re-evaluated |
| any | `refresh()` after `expiresAt` | record treated as absent; nothing rewritten | `none` |

- **C-11 A failed save never reports a stored grant.** After a failed write
  the snapshot is `persistence: "memory"` and evidence is never `saved`.
  The in-memory grant ends with the visit.
- **C-12 A stale grant never overrides a withdrawal.** Every asynchronous
  completion carries the `seq` it started under and is discarded when
  `seq` has moved on. A grant's durable acknowledgement that arrives after a
  refusal changes nothing.
- **C-13 A withdrawal completes only on verified read-back.** `refuse()` on
  a grant reports success only when reading storage back evaluates as **not
  allowed under the current regime**. Under `notice`, removing the record
  makes the choice allowed again, so removal alone is not a withdrawal
  there. Otherwise the snapshot carries `withdrawal: "failed"`, and the
  assembly keeps the notice open with a visible failure status
  (C-21). A withdrawal that could not be stored is therefore never silent.
  The denial holds in memory for the rest of the visit, and the visitor is
  told then that it holds only for this visit. If storage keeps returning
  the old grant, a later document load reads it as live, which is the
  residual case named in open question 7.
- **C-14 Durable acknowledgement is separate from the choice.** Gating
  follows the local record. It never waits for evidence, and evidence never
  grants. With no evidence port (browser-only mode), a full grant-and-refuse
  cycle makes zero network requests and evidence is never `saved`.
- **C-15 Withdrawal is never harder than granting.** `grant()` and
  `refuse()` share one call shape, and `refuse()` is never disabled,
  including while a grant's evidence is pending.

### Browser storage adapter (Butler, isolated)

```ts
function createLocalStorageConsentPort(options: {
  key: string;
  storage?: () => Storage | undefined; // default reads globalThis.localStorage lazily
  legacy?: boolean;                    // accept { status, decidedAt } under key
}): ConsentStoragePort;
```

- **C-16** A blocked storage, or an access that throws, reads as
  `unavailable` and never throws to the caller. A cross-tab change arrives
  through the `storage` event via `subscribe`. The adapter writes nothing
  except the four-field record under the configured key.

### Analytics transport (Observer, isolated)

```ts
interface AnalyticsProviderPort {
  init(): void;            // provider options already fixed by the adapter
  capture(event: SanitizedAnalyticsEvent): void;
  optIn(): void;
  optOut(): void;          // stop sending, drop provider-held queues, clear provider persistence
}
interface SanitizedAnalyticsEvent {
  name: "pageview" | string;          // a pageview, or an allowlisted conversion
  url: string;                        // origin + pathname only
  referrerOrigin?: string;
  properties: Readonly<Record<string, string | number | boolean>>;
}
interface AnalyticsTransport {
  setPermission(allowed: boolean): void;
  pageview(location: { href: string; referrer?: string }): void;
  conversion(name: string, properties?: Record<string, unknown>): void;
  dispose(): void;
}
function createAnalyticsTransport(options: {
  loadProvider: () => Promise<AnalyticsProviderPort>;
  allowedConversions: readonly string[];
  allowedProperties?: Readonly<Record<string, readonly string[]>>;
  scheduler?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  maxQueued?: number;
}): AnalyticsTransport;
function sanitizeAnalyticsEvent(input: { name: string; href: string; referrer?: string; properties?: Record<string, unknown> }, allow: { conversions: readonly string[]; properties?: Readonly<Record<string, readonly string[]>> }): SanitizedAnalyticsEvent | null;
function createPostHogProvider(sdk: PostHogLike, config: { key: string; apiHost: string }): AnalyticsProviderPort;
```

`PostHogLike` is the subset of the provider SDK object that the adapter
calls, declared structurally so that the package never imports the SDK
(C-3). The key and host are host values (O-7).

- **C-17 Off by default.** Permission starts `false`. While permission is
  unknown or denied, the transport never calls `loadProvider`, never
  initializes and never captures. A capture made before permission is
  dropped, not queued.
- **C-18 Initialization is lazy and happens once.** The first
  `setPermission(true)` starts one load. Captures made while loading go into
  a bounded memory queue. The provider is initialized at most once per page.
  A later grant after a withdrawal calls `optIn()` and never a second
  `init()`.
- **C-19 Withdrawal cancels everything pending.** `setPermission(false)`
  advances a generation counter. It clears the queue and every scheduled
  retry or delayed capture, and calls `optOut()` if the provider was
  initialized. A load that resolves after a withdrawal is discarded and
  never initialized.
- **C-20 Events are redacted before capture.** URLs keep the origin and
  path, and lose the query and fragment. The referrer is reduced to an
  origin. Only pageviews and allowlisted conversions are sent. Properties
  are allowlisted per event and limited to bounded primitive values. The
  provider adapter forces off autocapture, session replay, surveys,
  experiments, feature-flag evaluation and person identification, and
  refuses a host option that would enable any of them. No `identify` call
  exists on any port. The transport runs only on public pre-authentication
  surfaces, never on application, administration or demonstration surfaces.

### Presentation (Designer)

`ConsentBanner` keeps its current contract: a region landmark named by its
title, one body, an optional policy-link slot, and accept and reject as two
`Button`s of the same variant and size. It is not a dialog and has no focus
trap, autofocus, portal or timer. Actions stack at the base size and sit in
a row from `tablet`. Logical properties keep it correct in right-to-left
layouts.

- **C-21 A status line is presentation, not state.** Unit D adds one
  optional prop, `status?: ReactNode`. It renders inside a polite live region
  (`role="status"`) after the body and before the actions. The assembly
  fills it for `withdrawal: "failed"`, for memory-only persistence and for
  evidence `unavailable` or `conflict`. Neither action is ever disabled.

### Assembly (Publisher)

```ts
// @clossys/publisher/web/consent (client-only; refuses react-server)
interface ConsentLifecyclePort {     // structural mirror of Butler's ConsentLifecycle
  getSnapshot(): ConsentSnapshotView;
  subscribe(listener: () => void): () => void;
  grant(): ConsentSnapshotView;
  refuse(): ConsentSnapshotView;
  refresh(): ConsentSnapshotView;
  dispose(): void;
}
interface ConsentExperienceProps {
  copy: ResolvedConsentCopy;
  createLifecycle: (signals: { gpc: boolean }) => ConsentLifecyclePort; // called on client mount only
  regime?: string;                         // missing or unknown = prompt
  required?: boolean;                      // default true
  reopen?: { fragment?: string | false; eventName?: string | false };
  onChange?: (choice: "granted" | "denied") => void;
  reviewSeam?: { param?: string } | false; // default on, loopback hosts only
  children?: ReactNode;
}
function ConsentExperience(props: ConsentExperienceProps): ReactNode;
function useAnalyticsAllowed(): boolean;
function useConsentStatus(): ConsentStatusView; // persistence, evidence, withdrawal, simulated
```

`ConsentSnapshotView` mirrors Butler's `ConsentSnapshot` field for field,
except that `evidence` may also be `"simulated-saved"`, which only the
preview produces (C-34). `ConsentStatusView` is `{ persistence, evidence,
withdrawal, simulated? }`, where `simulated` is the active review-seam value.
`ResolvedConsentCopy` has the same keys as `ConsentCopyRefs` below, each
holding a plain string with its entry id and revision.

- **C-22 Hydration-safe.** The server render and the first client render
  use the no-decision snapshot. No notice renders, and `useAnalyticsAllowed()`
  is `false`, under every regime. Storage, Global Privacy Control and the
  reopen fragment are read only after mount. The server HTML therefore
  never depends on a stored choice and never mismatches on hydration.
- **C-23 Both gate conditions are required.** Analytics may start only when
  `required` is true **and** the lifecycle reports allowed. With
  `required={false}`, the notice never shows, reopening does nothing,
  `createLifecycle` is never called and `useAnalyticsAllowed()` is `false`.
- **C-24 `onChange` is for choices only.** It fires once per accept or
  reject press. It never fires on mount, on reading a stored choice, on a
  change from another tab, on expiry, on Escape or under the review seam.
  Hosts read state through `useAnalyticsAllowed()`, which also covers a
  stored choice found at arrival.
- **C-25 One notice.** The notice opens by itself only when
  `shouldPromptAutomatically` holds. It otherwise opens only through reopen.
  A choice closes it, except while `withdrawal` is `failed` (C-13). Focus
  then moves to the reopen trigger, or to the main content when there is
  none. No other consent surface exists: no dialog, no preferences screen,
  no footer control.
- **C-26 Escape sets the notice aside.** Escape inside the notice closes it
  for the current page view, in memory. It records nothing, calls no port,
  fires no `onChange` and changes no permission.
- **C-27 Reopen needs no import.** A fragment (default `#privacy-choices`)
  or a document event (default name `privacy-choices:open`) opens the
  notice. The handler is idempotent, so a second trigger while open does
  nothing. It removes the fragment with `history.replaceState` after
  opening, without adding a history entry. Reopening shows the regime's
  lead and both actions, and the notice opens even when the stored record
  could not be read (C-21 status). A fragment present at load is honoured
  after mount. An event dispatched before mount is not queued.
- **C-28 Copy is regime-aware.** The body is exactly one sentence: the
  `prompt` lead under `prompt` and the `notice` lead under `notice`.
- **C-29 No toast dependency.** The assembly mounts no `Toaster` and imports
  no Designer `/shell` entry. A state that must be seen, such as a failed
  withdrawal, is shown in the notice itself. A host that also wants a toast
  reads `useConsentStatus()` and calls its own `toast()` inside its own
  client boundary.

### Review seam (Publisher, real build)

- **C-30 Loopback only.** The seam is active only when `location.hostname`
  is exactly `localhost`, `127.0.0.1` or `[::1]`. On any other host the query
  parameter does nothing, and the page behaves as if it were absent.
- **C-31 What the values do.** The parameter (default `consent-review`)
  takes `fresh`, `granted`, `refused`, `gpc` or `live`. Every value except
  `live` replaces the storage port with an in-memory port seeded to that
  state for the page load, and `gpc` sets the signal for the page load
  only. Every value except `live` keeps the notice reviewable even with
  `required={false}`. `live` restores real behaviour.
- **C-32 Simulation is not a choice.** Under any value except `live`, the
  real storage key is never written, the evidence port is never called,
  `onChange` never fires and `useAnalyticsAllowed()` returns `false`.
  `useConsentStatus().simulated` names the simulated value.

### Fixed-clock preview (Publisher, isolated)

```ts
// preview entry: not reachable from any production entry (C-4)
type ConsentPreviewState =
  | "fresh-prompt" | "fresh-notice" | "remembered-granted" | "remembered-refused"
  | "withdrawn" | "expired" | "gpc" | "not-required"
  | "pending-grant" | "simulated-saved" | "conflict" | "unavailable"
  | "pending-withdrawal" | "withdrawal-failed" | "reopen-unreadable";
function createConsentPreview(options: {
  state: ConsentPreviewState;
  now: string;                         // fixed ISO instant
  environment: "development" | "preview" | "production"; // production throws
}): { lifecycle: ConsentLifecyclePort; settle(result: "simulated-saved" | "conflict" | "unavailable"): void; dispose(): void };
```

- **C-33 The preview is deterministic and inert.** It uses no storage, no
  network, no timers, no SDK, no Butler or Observer import and no clock
  read. Asynchronous outcomes happen only on an explicit `settle()`.
  `dispose()` releases every listener.
- **C-34 Simulated never reads as durable.** The preview can produce
  `simulated-saved` and can never produce `saved`. The live lifecycle can
  never produce `simulated-saved`, and the two are distinct types.
  `expired` renders byte-identically to `fresh-prompt`, with no expiry
  wording. The dialog-only "cancel" state of earlier revisions no longer
  exists.

### Copy (Publisher, server-only)

```ts
// @clossys/publisher/consent-copy (server-only; refuses the browser condition)
interface ConsentCopyRefs {
  title: CopyRef; promptLead: CopyRef; noticeLead: CopyRef;
  acceptLabel: CopyRef; rejectLabel: CopyRef; privacyLinkLabel: CopyRef;
  status: { memoryOnly: CopyRef; withdrawalFailed: CopyRef; evidenceUnavailable: CopyRef; evidenceConflict: CopyRef };
}
function resolveConsentCopy(input: {
  resolveCopy: CopyResolver;
  refs: ConsentCopyRefs;
  locale: string;
  now: Date;
  environment: "development" | "preview" | "production";
}): ResolvedConsentCopy; // plain strings plus entry id and revision per field
```

- **C-35 Copy is refused unless it is approved for this use.** Resolution
  throws an error naming the field (never echoing the text) for copy that
  is absent or blank, or that matches the placeholder sentinel. The same
  applies to copy that is unapproved, stale against its fingerprint, past a
  delegate approval's `expiresAt`, or outside the delegate's scope. It
  applies to copy resolved in a locale other than the one requested, and to
  fixture or preview copy under `production`. Both leads are required
  whatever the current regime. A package default bound for another surface
  (for example the authentication forms) is not an approval of consent copy.
  A synthetic record approves nothing.

### Bouncer interactions (#1947, independent)

- **C-36** Consent never depends on Bouncer, and Bouncer never depends on
  consent. Two interactions are host concerns. First, a provider's script
  and connection hosts appear in the content security policy only when the
  host lists them as explicit extensions; consent adds none. Second, a
  hardened sign-out that sends `Clear-Site-Data` with `storage` removes the
  consent record, so the next visit reads as no choice (C-7). Global Privacy
  Control still holds.

## Source units

Dependency order for builders:

1. **#1978 Butler date helpers.** Independent. Prerequisite of #1938.
2. **#1938 Butler lifecycle** and **#1940 Observer transport.** Each depends
   on this document. They are independent of each other and may run in
   parallel. #1938 also depends on #1978.
3. **Unit D Designer status slot.** Depends on this document and has no
   ticket yet (see "Unowned work").
4. **#1941 Publisher assembly and the Publisher and Designer exports.**
   Depends on this document, #1938, #1940 and unit D.
5. **#1942 release preparation.** Prepares the cohort after #1938, #1940
   and #1941 (and the export unit below) have merged.
6. **#1947 Bouncer.** Independent of every unit above.

#1981 is a behaviour issue, not a build unit. Its pure functions are built
in #1938 and its reopen seam in #1941.

### #1978 Butler date helpers

- Paths: `packages/butler/src/` (one module plus its test), the root barrel
  and the README API table.
- API: `addCalendarMonthsUtc(from: Date, months: number): Date` and
  `isWithinWindow(start: Date, end: Date, now: Date): boolean`. Invalid
  input throws a typed error: negative, fractional or non-finite months, or
  an invalid date.
- Fixtures: 2026-08-31 + 6 = 2027-02-28, 2023-08-31 + 6 = 2024-02-29,
  2024-02-29 + 6 = 2024-08-29, 2026-01-31 + 1 = 2026-02-28, and the end
  instant is outside the window.
- Proof: P-1.

### #1938 Butler lifecycle

- Paths: `packages/butler/src/browser-consent/` only. Suggested files:
  modules `record`, `decision`, `lifecycle` and `adapters/local-storage`,
  and an internal `index` barrel, with the tests named below. The package
  root and the manifest stay untouched.
- API: the record and decision rules, the lifecycle and ports, and the
  storage adapter, as specified in Contracts.
- State transitions: the transition table, C-5 to C-16.
- Fixtures: a fixed clock, an in-memory storage port with switchable
  failure modes (write fails, remove fails, read returns a stale grant), a
  deferred evidence port that resolves on demand, and a legacy record.
- Proof: P-2 to P-8.

### #1940 Observer transport

- Paths: `packages/observer/src/browser-analytics/` only. Suggested files:
  modules `transport`, `sanitize` and `providers/posthog`, and an internal
  `index` barrel. The root and the manifest stay untouched.
- API: the transport, the sanitizer and the provider adapter, as specified
  in Contracts.
- State transitions: `off` → (`setPermission(true)`) `loading` → `ready`;
  any state → (`setPermission(false)`) `off` with the generation advanced;
  `ready` → (re-grant) `ready` via `optIn()`. A load failure schedules one
  retry through the injected scheduler.
- Fixtures: a fake provider that records every call, a deferred loader, a
  manual scheduler, and a `PostHogLike` fake object. No real SDK is
  installed or imported.
- Proof: P-9 to P-13.

### Unit D Designer status slot

- Paths: the `ConsentBanner` block source in `packages/designer/src/blocks/`,
  its test, and its README entry.
- API: `ConsentBannerProps.status?: ReactNode`, rendered per C-21. Every
  other prop is unchanged.
- Proof: P-14.

### #1941 Publisher assembly and exports

- Paths: `packages/publisher/src/web/consent/**` and
  `packages/publisher/src/consent-copy/**`, plus the export, barrel, CSS and
  test files listed on the ticket. Suggested modules: `ports`,
  `ConsentExperience`, `hooks`, `reopen`, `review-seam`, `preview/adapter`
  and `consent-copy/resolve`.
- API: the assembly, review seam, fixed-clock preview and copy, as
  specified in Contracts. Proposed export keys: `./web/consent`
  (client-only), `./web/consent/preview` (development only) and
  `./consent-copy` (server-only).
- State transitions: the presentation states follow the lifecycle snapshot.
  The notice states are `hidden-unmounted`, `closed`, `open`,
  `open-with-status` and `set-aside` (after Escape, for the page view).
- Fixtures: the structural fake lifecycle from the preview and a Writer
  registry fixture with approved, draft, stale, expired-delegate,
  wrong-locale and placeholder entries. Loopback and non-loopback host
  fixtures cover the seam.
- Proof: P-15 to P-22.

### Unowned work

- **Exports for Butler and Observer.** #1938 and #1940 forbid their package
  index and manifests, #1941 forbids both packages, and #1942 forbids
  source. No unit adds `./browser-consent` to Butler or
  `./browser-analytics` to Observer. Hosts cannot import either until one
  does. That unit also owns the proof that the real implementations satisfy
  Publisher's structural ports.
- **Unit D.** The `ConsentBanner` block source is outside the paths #1941
  lists.

## Proof cases

Every proof is a named test plus a mutation. A test file stem names the test
file beside the unit's source, with the repository's usual test suffix; the
unit's ticket fixes the exact file name. The mutation is applied to the
finished implementation, the named test must fail on an assertion (not on an
import or harness error), and then the code is restored and the suite
passes.

| ID | Unit | Test file stem :: test | Mutation that must fail it |
| --- | --- | --- | --- |
| P-1 | #1978 | month-end clamping fixtures and exclusive end | drop the clamp (`setUTCMonth(getUTCMonth() + n)`) |
| P-2 | #1938 | `lifecycle` :: stale grant cannot override withdrawal | remove the `seq` guard |
| P-3 | #1938 | `persistence` :: failed save cannot report a stored grant | report `stored` after an `unavailable` write |
| P-4 | #1938 | `expiry` :: expiry fixed at decision, never renewed, expired reads as no choice | recompute `expiresAt` on read, or treat expired as `stale` |
| P-5 | #1938 | `decision` :: regime (`prompt`, `notice`, missing) × GPC (on, off) × record (none, granted, denied, expired, older policy, corrupt) | default a missing regime to `notice` |
| P-6 | #1938 | `withdrawal` :: a withdrawal whose write and removal both fail while read-back still shows a grant is `withdrawal: "failed"`, and under `notice` removal alone is not success | report success without read-back |
| P-7 | #1938 | `browser-only` :: with no evidence port, a grant-and-refuse cycle makes zero `fetch` or `sendBeacon` calls and evidence is never `saved` | report `saved` without a port |
| P-8 | #1938 | `isolation` :: no core module reads a browser global at module scope or imports an adapter, legacy records migrate without renewal | add a module-scope `localStorage` read; treat a dateless legacy record as live |
| P-9 | #1940 | `posthog` :: unknown consent never loads or captures | initialize while permission is unknown |
| P-10 | #1940 | `posthog` :: withdrawal blocks a pending retry and a late load | send a queued capture after withdrawal; initialize a load that resolved after withdrawal |
| P-11 | #1940 | `posthog` :: initialization happens once and automatic properties are sanitized | initialize on every capture; pass properties through unchanged |
| P-12 | #1940 | `posthog` :: provider options force off autocapture, replay, surveys, experiments, flags and identification | let a host option enable autocapture |
| P-13 | #1940 | `root-isolation` :: the Observer root import graph reaches no `browser-analytics` module | re-export the transport from the root |
| P-14 | D | `ConsentBanner` :: status renders in a polite live region and both actions stay enabled and equal | disable reject while a status shows |
| P-15 | #1941 | `ConsentExperience` :: `required={false}` shows nothing and reopen does nothing; `onChange` fires on choice only | fire `onChange` on mount or on a stored read |
| P-16 | #1941 | `ConsentExperience` :: Escape records nothing; withdrawal stays enabled while a grant is pending; a failed withdrawal keeps the notice open with status | persist Escape; disable withdrawal; close on a failed withdrawal |
| P-17 | #1941 | `ConsentExperience` :: server and first client render match the no-decision snapshot | read storage during render |
| P-18 | #1941 | `reopen` :: fragment and event open once, clear the fragment and return focus | open a second notice on a repeated trigger |
| P-19 | #1941 | `review-seam` :: `fresh`, `granted`, `refused`, `gpc` and `live` on loopback; ignored elsewhere; never writes storage or allows analytics | accept a non-loopback host; let a simulated grant allow analytics |
| P-20 | #1941 | `consent-copy/resolve` :: both leads required; unapproved, stale, expired, wrong-locale, placeholder and production-fixture copy refused | omit the `notice` lead; accept package defaults as approval |
| P-21 | #1941 | `preview/adapter` :: zero I/O, no timers, explicit settle, `expired` identical to `fresh-prompt`, no `saved` from the preview, production refused | auto-settle; return `saved`; allow `production` |
| P-22 | #1941 | `browser-import-closure` and `react-server-artifact` :: production closures exclude the preview, the client entry refuses `react-server`, copy resolution refuses `browser` | import the preview or a Writer registry into the client entry |

### Review proofs for this document

This document has no executable test. Its two mutation proofs are semantic,
and an independent review applies them.

- **S-1** Delete C-1, C-3 or C-4, or change one of them to permit SDK or
  storage initialization through a pure root or a production import of
  preview controls. Review must reject the result, because O-4, O-5 and P-13
  or P-22 would then have no contract to hold them.
- **S-2** Delete the `pending-grant` or `withdrawal-failed` preview states,
  P-6 or P-16, or make presentation wait until every backend exists (for
  example by having the preview import Butler). Review must reject the
  result, because C-13, C-33 and C-34 would lose their proofs, and
  presentation would no longer be independent of the backend.

### Separate evidence

Each unit's proofs show that it is implemented. They do not show that it is
staged, published or adopted. A full publish-safety pass, packed-consumer
proof, release qualification, behaviour against a real provider SDK, and
adoption in a consumer's tree are separate evidence, recorded by their own
owners.

## Open questions

These could not be settled from the issues and are left for the owner.

1. **Accepting under a non-overridable GPC.** When Global Privacy Control is
   on and `gpcOverridable` is false, a reopened notice still offers accept.
   It is not settled whether accepting should be recorded and have no
   effect, as specified, or whether accept should be replaced.
2. **What counts as a page view for Escape.** For client-side route
   changes, it is not settled whether a route change is a new page view.
   As specified, a full document load is one.
3. **Simulated GPC scope.** The issues say "for the tab". As specified, it
   lasts for the page load.
4. **The review seam and the transport.** As specified, a simulated grant
   never enables the transport. Reviewing real capture on loopback would
   need an explicit opt-in.
5. **Notice regime after storage is cleared.** A sign-out that clears
   storage under the `notice` regime makes analytics allowed again for a
   visitor who had refused, unless Global Privacy Control is on.
6. **Provider-held queues.** Whether the provider SDK's own send queue
   drops queued events on opt-out is behaviour of the real SDK. A fake
   cannot prove it, so it needs evidence against the real SDK.
7. **Storage that refuses both writing and removal.** When storage keeps
   returning a grant after a refusal, the refusal holds for the visit and
   the visitor is told (C-13). It is not settled whether a session-scoped
   marker should also carry the refusal across reloads in the same tab.
