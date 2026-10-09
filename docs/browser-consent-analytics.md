# Browser consent and analytics boundaries

Contract for one optional browser purpose, first-party analytics, on public
pre-authentication web surfaces. This document is the specification that
#1938, #1940 and #1941 build against (issue #1560, specification revision 6).
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
text" below lists each known conflict. Revision 6 keeps every decision below
and closes re-read, evidence-order and parsing gaps found while building
#1938: it adds C-56 to C-61 and tightens C-10, C-13, C-16, C-37, C-41 and
C-54.

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
   default; a provider load that resolves after a withdrawal is discarded
   and never initialized, and events are redacted. Pure roots never
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
  the end instant is outside (C-40 caps `expiresAt` first), except for
  C-40's future-dated denial, which is live until its capped `expiresAt`. Its policy
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
  any legacy record when `policy.legacy` is absent, reads as no choice, and
  a legacy record never carries `gpcOverride` (C-60).
  Reading never rewrites a record; the next explicit choice writes the full
  shape. The storage adapter returns raw values and performs no migration.
- **C-37 Unreadable storage is neither a choice nor permission.** When the
  storage read is `unavailable`, the effective choice is `unknown` (or
  `denied` with GPC on). It is not allowed under either regime, and the
  notice does not open by itself. It opens on reopen with the
  `storageUnavailable` status. A choice the visitor makes then holds in
  memory for the visit. A later re-read that finds storage unreadable never
  drops a refusal made this visit, or a grant held only in memory, to
  `unknown`; a grant this visit stored can no longer be confirmed and
  drops, failing closed (C-58).
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
- **C-59 Global Privacy Control fails closed, read the same way
  everywhere.** Every reader of the signal normalises it as
  `Boolean(signals.gpc)`: the lifecycle (including `gpcInForce`), the
  decision functions (`effectiveChoice`, `isAllowed`,
  `shouldPromptAutomatically`) and the record rules (`decideChoice`'s
  `gpcOverride` and its C-39 throw). Any truthy value, such as `1` or
  `"1"`, therefore counts as the signal being on, in all of them alike; no
  reader compares with `=== true` while another uses truthiness.
- **C-60 Parsing is total and strict.** `parseStoredChoice` never throws.
  It returns `null` (no choice) for any input it cannot accept, including
  a date that is out of range, either as read or once C-40's cap is
  computed from it (any step that would produce an invalid `Date` or make
  `toISOString` throw). For the current record shape, `decidedAt` and
  `expiresAt` are accepted only as ISO 8601 UTC instants in the form
  `toISOString` writes (`YYYY-MM-DDTHH:mm:ss.sssZ`, the fractional part
  optional); a date-only string, a local time, an offset other than `Z` or
  any other date format makes the record corrupt. A legacy record (C-10)
  never carries `gpcOverride`: a legacy-shaped value that has a
  `gpcOverride` field reads as no choice, so parsing never produces a
  legacy grant that overrides the signal.

```ts
function normalizeRegime(value: unknown): ConsentRegime;
function decideChoice(status: "granted" | "denied", now: Date, policy: ConsentPolicy, signals: ConsentSignals): StoredChoice;
function parseStoredChoice(raw: unknown, policy: ConsentPolicy): StoredChoice | null;
function effectiveChoice(stored: StoredInput, signals: ConsentSignals, policy: ConsentPolicy, now: Date): EffectiveChoice;
function isAllowed(stored: StoredInput, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
function shouldPromptAutomatically(stored: StoredInput, signals: ConsentSignals, regime: unknown, policy: ConsentPolicy, now: Date): boolean;
interface SequencedChoice { choice: StoredChoice; sequence: number }
function shouldApplyEvidence(incoming: SequencedChoice, current: SequencedChoice | null): boolean; // C-41
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
  refuse(): ConsentSnapshot;        // a withdrawal when the prior snapshot or a read-back allows (C-13)
  refresh(): ConsentSnapshot;       // a re-read under C-54
  dispose(): void;
}
function createConsentLifecycle(options: {
  storage: ConsentStoragePort;
  evidence?: ConsentEvidencePort | false | undefined; // false or absent: no evidence port
  policy: ConsentPolicy;
  regime: unknown;
  signals: ConsentSignals;
  clock: () => Date;
  simulated?: boolean | undefined;  // review seam only (C-42)
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
allowed" is the `allowed` field of the snapshot before the call. A
"read-back" reads storage again, parses it, and evaluates `isAllowed` under
the current regime and signals while ignoring any in-memory choice; its
result is `allowed`, `not allowed` or `unreadable`. Every read-back, the
one taken at a `refuse()` call to classify it and the one after a
withdrawal's write, differs from a plain `isAllowed` in one way (C-57): a
grant that is not live only because its `decidedAt` is after `now` counts
as `allowed` when it would be allowed once live, that is, when `isAllowed`
holds for it evaluated at its own `decidedAt` (so a grant barred by a
non-overridable signal still does not count). With no valid `now`, C-61
classifies a read-back instead. A re-read never uses this rule to lift
a choice: lifting still requires a live record (C-54, C-56). An
"in-memory choice" is the record `decideChoice` produced for a choice
whose result was `persistence: "memory"`; it lasts for the visit (C-11,
C-54). "This visit's choice" is the latest `grant()` or `refuse()` that
changed state through this lifecycle, stored or in memory. When it is a
refusal, it is the **refusal floor** (C-56). The **withdrawal watermark**
is the latest `decidedAt` of a record that a failed withdrawal's
read-back saw (C-57).

| From | Event | Effect | Result |
| --- | --- | --- | --- |
| mount | read `unavailable` | nothing written | `unknown` (or `denied` with GPC on), not allowed, no automatic prompt, `storage: "unreadable"`, persistence `none` |
| mount | read `empty`, or a value that parses to no choice (C-7, C-10, C-40) | nothing rewritten | `none` |
| mount | live record | none | the record's status, persistence `stored` |
| any | `grant()` with GPC on and not overridable | no-op (C-39) | unchanged, `gpcInForce: true` |
| `none`, `unknown`, `denied` or `granted` | `grant()`, write `ok` | fresh record (C-38), `seq+1`, any in-memory choice dropped, `withdrawal` back to `idle`, evidence `pending` if a port exists, otherwise `none` | `granted`, `stored` |
| `none`, `unknown`, `denied` or `granted` | `grant()`, write `unavailable` | grant becomes the in-memory choice; `withdrawal` back to `idle`; no evidence call (C-41) | `granted`, `memory`, evidence `none` |
| prior allowed `false` and read-back not `allowed` | `refuse()`, write `ok` | fresh denial (C-38), `seq+1`, evidence `pending` if a port exists | `denied`, `stored` |
| prior allowed `false` and read-back not `allowed` | `refuse()`, write `unavailable` | denial becomes the in-memory choice; no evidence call | `denied`, `memory` |
| prior allowed `true` (`granted`, or `none` under `notice`), **or** read-back at the call `allowed` (for example a second refusal after a failed withdrawal, or a grant dated after `now` that would be allowed once live, C-57) | `refuse()` | a **withdrawal**: publish `allowed: false` to subscribers before anything else, including before reading the clock (C-61), then `seq+1`, abort any in-flight evidence, write a denial (and `remove()` if the write fails), then read back | the next three rows |
| withdrawal | write `ok`, read-back `not allowed` | evidence `pending` if a port exists | `denied`, `stored`, `withdrawal: "idle"` |
| withdrawal | write `unavailable`, `remove()` `ok`, read-back `not allowed` | record removed (possible under `prompt` only); denial becomes the in-memory choice | `denied`, `memory`, `withdrawal: "idle"` |
| withdrawal | read-back `allowed` (including a grant dated after `now` that would be allowed once live, C-57) or `unreadable`, whatever the write and removal returned | denial becomes the in-memory choice; the record the read-back saw, if any, moves the withdrawal watermark forward (C-57) | `denied`, `memory`, `withdrawal: "failed"` |
| any, after mount | `refuse()` while `clock()` returns an invalid date or throws | after the publish, nothing is written; a withdrawal whenever the prior snapshot allowed or the read-back at the call, under C-61's no-clock rule, is `allowed` (storage holds any grant, or under `notice` no record); a withdrawal calls `remove()` and reads back under the same rule; the refusal is an undated in-memory denial that no re-read lifts and only the visitor's `grant()` replaces (C-61) | `denied`, `memory`; `withdrawal: "failed"` when the read-back is `allowed` or `unreadable` |
| any, after mount | `grant()` while `clock()` returns an invalid date or throws | no-op, no throw, nothing written, no evidence (C-61) | unchanged |
| any | an evidence call is due for a choice whose `seq` is no longer the latest (a synchronous subscriber made a newer choice during the publish) | the call is never made, and the snapshot never shows `pending` for that choice (C-41) | evidence follows the newer choice |
| any | evidence result for an older `seq` | ignored | unchanged |
| evidence `pending` | `saved` for the current `seq` | none | evidence `saved` |
| evidence `pending` | `conflict` | local record re-read; a conflict never upgrades to `granted`; if that re-read switches the snapshot to another tab's record, the switch wins (C-41) | evidence `conflict`, or `none` after a switch |
| evidence `pending` | `unavailable`, or a throw | local choice kept | evidence `unavailable` |
| any | `refresh()`, or an external change from another tab | a re-read under C-54, subject to the C-56 to C-58 rows below: evaluated as at mount against the clock, except that an in-memory choice is kept unless the read-back record is live and newer, and not dated after `now`; `withdrawal: "failed"` is re-checked; nothing rewritten; no `onChange` | an expired stored record becomes `none`; an in-memory choice and a failed withdrawal survive |
| refusal floor | a re-read that finds no live grant later than the refusal's `decidedAt` and not after `now` (the record cleared, a denial under another `policy.version` that parses as no choice, an older or watermarked grant, or storage unreadable) | the refusal is kept; persistence is `stored` while storage holds a live denial (this one or another tab's), otherwise `memory`; nothing rewritten; no `onChange` (C-56) | `denied`, not allowed, no automatic prompt, `stored` or `memory`, `storage` as read |
| this visit's grant | a re-read that finds another tab's live denial (for an in-memory grant, one later than it and not after `now`, C-54) | the denial replaces the grant; the floor is one-sided, so nothing holds a grant against a refusal (C-56) | `denied`, `stored` |
| this visit's refusal, or a grant held only in memory | a re-read whose storage read is `unavailable` | the choice is kept, never `unknown` (C-58) | its status, `memory`, `storage: "unreadable"` |
| this visit's grant, `stored` | a re-read whose storage read is `unavailable` | the grant can no longer be confirmed and is dropped; fails closed (C-58) | `unknown` (or `denied` with GPC on), not allowed, `storage: "unreadable"`, persistence `none` |
| any | a re-read that switches the snapshot to a record another tab wrote | `seq` does not move; results for the replaced choice are ignored from then on, by its per-choice token (C-41) | evidence `none`, persistence `stored` |

- **C-11 A failed save never reports a stored choice.** After a failed
  write the snapshot is `persistence: "memory"` and evidence is never
  `saved`. The in-memory choice, a grant or a denial, governs the rest of
  the visit: only a live, newer record from another tab replaces it on a
  re-read (C-54).
- **C-12 A stale grant never overrides a withdrawal.** Every asynchronous
  completion carries the `seq` it started under and is discarded when
  `seq` has moved on. A grant's durable acknowledgement that arrives after a
  refusal changes nothing.
- **C-13 A withdrawal completes only on verified read-back.** A `refuse()`
  is a withdrawal when the prior snapshot was allowed (from a grant under
  either regime, or from no choice under `notice`) **or** a read-back taken
  at the call is `allowed`. Both read-backs follow the definition above, so
  a grant dated after `now` that would be allowed once live counts as
  `allowed` at the call as well as after the write (C-57). The second case
  covers a repeated refusal after a failed withdrawal, whose snapshot is
  already not allowed while storage still allows, and a refusal of a grant
  stored under a clock that has since moved back, whose snapshot was never
  allowed. A withdrawal reports success only when the read-back after the
  write is `not allowed`; `allowed` and `unreadable` both fail it.
  Under `notice`, a missing record is allowed, so removal alone never
  completes a withdrawal there. On failure the snapshot carries
  `withdrawal: "failed"` and the notice stays open with the
  `withdrawalFailed` status (C-55). The denial holds in memory for the rest
  of the visit, and the status tells the visitor so. `withdrawal: "failed"`
  persists, through further refusals and every re-read, until a read-back
  is `not allowed`, the visitor grants, or a live, newer record from another
  tab, dated after the withdrawal watermark, replaces the in-memory denial
  (C-54, C-57; never an undated denial, C-61); only then does it return to
  `idle`. If storage keeps
  returning the old grant, or under `notice` holds no record at all, a
  later document load reads it as allowed; that residual case is open
  question 7.
- **C-54 Re-reads never override a choice made this visit.** A re-read is
  `refresh()`, the assembly's `pageshow` and `visibilitychange` triggers
  (C-46), or a cross-tab change from the storage port's `subscribe`. It
  re-evaluates storage as at mount, against the clock. When the lifecycle
  holds an in-memory choice, the re-read keeps it, and a stored record
  replaces it only when both of these hold: the record is **live** under
  this lifecycle's policy (C-7, C-40: the current `policy.version`, subject
  to C-7's denial exception, not a future-dated grant, not expired), and
  its `decidedAt` is later than the in-memory choice's and not later than
  `now` (a newer choice made in another tab). Liveness is checked first; a
  record that is not live never replaces an in-memory choice, whatever its
  `decidedAt`. Two cases follow. With the clock moved back, a future-dated
  grant in storage never replaces a refusal held in memory after a failed
  write, on `refresh()`, `pageshow`, `visibilitychange` or a cross-tab
  change. A newer denial written by another tab under a different
  `policy.version`, which parses here as no choice, never replaces an
  in-memory denial either (that denial stays, so the result is the same
  refusal, still `memory`). A replacement also returns `withdrawal` to
  `idle`. Otherwise a re-read never clears `withdrawal: "failed"` while
  the read-back is `allowed` or `unreadable`. C-56 to C-58 restrict a
  re-read further, for stored choices made this visit as well as
  in-memory ones. A re-read changes the snapshot only through these rules
  and never fires `onChange`.
- **C-56 A refusal made this visit is a floor.** While this visit's choice
  is a refusal, stored or in memory, a re-read may lift it only with a
  record that is live under this lifecycle's policy (C-7, C-40), is a
  grant, is dated later than the refusal's `decidedAt` and not after
  `now`, and is not barred by the withdrawal watermark (C-57). Anything
  else leaves the snapshot `denied` and `allowed: false`, with no
  automatic prompt. That includes storage cleared in another tab (for
  example by a sign-out), a denial written under another `policy.version`
  that parses here as no choice (which under `notice` would otherwise read
  as allowed), an expired or older record, and unreadable storage.
  Persistence follows what the re-read finds: `stored` while storage holds
  a live denial, this refusal or another tab's, and `memory` otherwise,
  with the refusal becoming the in-memory choice. A live, newer denial from
  another tab that replaces the floor or a grant (C-54) is therefore
  `stored`, not `memory`. The floor is one-sided: nothing holds a grant
  against a refusal, so a re-read still moves this visit's grant to
  `denied` when another tab withdraws or refuses (C-54). A `grant()` by the
  visitor replaces the floor, as any new choice does.
- **C-57 A failed withdrawal remembers what it saw.** When a withdrawal
  fails, the lifecycle keeps the `decidedAt` of the record its read-back saw
  as the withdrawal watermark for the rest of the visit. A read-back that
  saw no record (under `notice`) or was `unreadable` sets nothing, and
  across repeated failed withdrawals the watermark only moves forward, to
  the latest `decidedAt` seen. That record, and any record dated at or
  before the watermark, never replaces the in-memory denial afterwards, even
  once the clock is corrected and the record would otherwise be live and
  newer than the denial; only a record dated strictly after the watermark
  can (and then only under C-54 and C-56). For every read-back, at the call
  and after the write, a grant that is not live only because its `decidedAt`
  is after `now` counts as `allowed` when it would be allowed once live (not
  when a non-overridable signal bars it): it becomes live once the clock
  catches up, so a refusal of it is a withdrawal, and a withdrawal that left
  it in storage has failed. Example: a grant is stored at T0; the clock
  moves back a day; `refuse()` fails to write and to remove, and its
  read-back sees the T0 grant, so the withdrawal is `failed` with watermark
  T0; the clock is corrected to two hours after T0; `refresh()` still
  reports `denied` with `withdrawal: "failed"`. The same holds when storage
  holds a grant dated T0 plus a day while the clock reads T0 (moved back):
  the snapshot was never allowed, but the read-back at the call counts the
  grant, so the refusal is a withdrawal, its failed write reaches a failed
  read-back, and once the clock is corrected past T0 plus a day the
  watermark still bars that grant. The watermark may also hold out a
  legitimate grant another tab made, dated at or before it, for the rest of
  the visit; that fails closed, and a `grant()` by the visitor clears the
  watermark.
- **C-58 An unreadable re-read fails closed, one-sided.** A re-read whose
  storage read is `unavailable` never drops a refusal made this visit, or
  a grant held only in memory after a failed write (C-11), to `unknown`:
  the choice is kept with `persistence: "memory"` and `storage:
  "unreadable"`. A grant this visit stored (`persistence: "stored"`) can no
  longer be confirmed, so it is dropped: the snapshot reads as at mount
  with storage unreadable, `unknown` (or `denied` with GPC on), not
  allowed, `storage: "unreadable"`, persistence `none` (C-37). A later
  readable re-read is judged again under C-54 to C-57. With no choice made
  this visit, an unreadable re-read reads as at mount (C-37).

Known limitation. A denial another tab writes under a different
`policy.version` parses here as no choice (C-7, C-60). It therefore does
not stop this tab's grant, stored or in memory, or a `notice` tab with no
choice, until the next document load. Revision 6 does not close this; it
is tracked as a follow-up for #1942.

- **C-14 Durable acknowledgement is separate from the choice.** Gating
  follows the local record. It never waits for evidence, and evidence never
  grants. With no evidence port (browser-only mode), a full grant-and-refuse
  cycle makes zero network requests and evidence is never `saved`.
- **C-15 Withdrawal is never harder than granting.** `grant()` and
  `refuse()` share one call shape, and `refuse()` is never disabled,
  including while a grant's evidence is pending.
- **C-61 A bad clock never blocks a refusal.** `refuse()` publishes
  `allowed: false` before it reads the clock. If `clock()` then returns an
  invalid date or throws at that call, after mount, `refuse()` writes
  nothing and returns the `denied` snapshot without throwing. With no valid
  `now`, a read-back cannot judge liveness, so it is classified without the
  clock: `allowed` whenever storage holds a grant of any date, or under
  `notice` holds no record; `unreadable` when the read is `unavailable`;
  otherwise `not allowed`. The refusal is a withdrawal when the prior
  snapshot allowed or that read-back at the call is `allowed`; a withdrawal
  then calls `remove()` and reads back under the same rule (C-13), and stays
  `withdrawal: "failed"`, never returning to `idle`, for as long as that
  read-back is `allowed` or `unreadable`. The refusal is held as an
  **undated denial**: an in-memory denial with no `decidedAt`, kept outside
  `StoredChoice` because it is never written, never sent to the evidence
  port and never compared by `shouldApplyEvidence`. `seq` still advances, so
  results for older choices are discarded (C-12). No re-read lifts it,
  whatever the record or clock it later finds, and its persistence follows
  C-56; only the visitor's `grant()` replaces it. `grant()` while `clock()`
  returns an invalid date or throws, after mount, is a no-op that does not
  throw: nothing is written, no evidence is sent and the snapshot is
  unchanged.
- **C-41 Evidence follows a local write, in order.** The evidence port is
  called only after a local write returned `ok`, for grants and denials
  alike. A choice held only in memory never reaches it, because a durable
  record the browser does not hold could disagree with the browser on the
  next visit. Each call carries the lifecycle's `sequence`. Ordering is
  asymmetric, and Butler's pure `shouldApplyEvidence` states it for every
  implementation to call: a **denial always applies** durably, whatever
  the stored record's `decidedAt` or `sequence`, so it never answers
  `conflict` because of an older `decidedAt`, including a denial dated
  earlier by a clock moved back (C-40). A **grant applies only when it is
  strictly newer** than the stored record: a later `decidedAt`, or the same
  `decidedAt` and a higher `sequence`. A grant that is not strictly newer
  answers `conflict` and changes nothing. One consequence is accepted on
  purpose: a delayed, older denial that arrives after a newer grant
  overwrites that grant durably. This is a privacy-first trade-off; the
  visitor's next grant restores it. `sequence` is a per-lifecycle counter
  (one document load), so the same-`decidedAt` tie-break orders choices
  only within one lifecycle; across lifecycles, `decidedAt` alone orders a
  grant. Within one lifecycle, evidence is sent for a choice only if its
  `sequence` is still the lifecycle's latest at the moment of sending. A
  synchronous subscriber that makes a newer choice inside the publish of
  an older one therefore never causes the older grant's evidence to be
  sent after the newer denial's: the older choice's call is never made,
  and the snapshot never shows `pending` for it. A re-read that switches
  the snapshot to a record another tab wrote (C-54, C-56) resets
  `evidence` to `none`, and a result that arrives later for the replaced
  choice is ignored. Such a switch does not advance `seq`, so an
  implementation needs a per-choice token, separate from `seq`, to tell
  that result apart from one for the current choice. When an evidence
  `conflict` triggers the re-read and that re-read switches the snapshot,
  the switch wins: evidence is `none`, not `conflict`, consistent with
  C-12's rule that a result for a replaced choice changes nothing.
- **C-42 A simulated Butler lifecycle never allows.** This rule binds
  Butler's `createConsentLifecycle` only. With `simulated: true`, its
  snapshot reports `simulated: true` and `allowed: false` whatever the
  record says, and it never calls an evidence port. The review seam alone
  creates one (C-50). The fixed-clock preview's lifecycle is a different
  implementation: its rows may carry `allowed: true` together with
  `simulated: true` (C-51), and the assembly's masking (C-23, C-45)
  keeps such a snapshot from enabling analytics.

### Browser storage adapter (Butler, isolated)

```ts
function createLocalStorageConsentPort(options: {
  key: string;
  storage?: () => Storage | undefined; // default reads globalThis.localStorage lazily
}): ConsentStoragePort;
```

- **C-16** A blocked storage, or an access that throws, reads as
  `unavailable` and never throws to the caller. A cross-tab change arrives
  through the `storage` event via `subscribe`. Two kinds of event reach the
  listener as a re-read trigger: an event for the configured key, and an
  event whose `key` is `null` (the whole storage area was cleared, for
  example by a sign-out in another tab) when its `storageArea` is the
  storage area this adapter reads. Events for other keys, and events from
  another storage area, are filtered out. The re-read that follows still
  cannot override a choice made this visit (C-54, C-56). The adapter
  returns the raw stored
  value, performs no migration (C-10), and writes nothing except the
  current record shape under the configured key.

### Analytics transport (Observer, isolated)

```ts
interface AnalyticsLocation { href: string; referrer?: string }
interface ProviderInitContext {
  sanitizeUrl(href: string): string | null;  // the transport's own C-20 rules
  eventNames: readonly string[];             // "$pageview" plus the allowed conversions
}
interface AnalyticsProviderPort {
  init(context: ProviderInitContext): void;  // throws if the provider cannot be set up safely (C-44)
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
  normalizePath?: (pathname: string) => string; // the single source of path normalisation
  scheduler?: AnalyticsScheduler;   // default: globalThis timers, looked up at call time
  maxQueued?: number;               // default 50; overflow drops the oldest
}): AnalyticsTransport;
function sanitizeAnalyticsEvent(
  input: { kind: "pageview" | "conversion"; name?: string; location: AnalyticsLocation; properties?: Record<string, unknown> },
  allow: { conversions: readonly string[]; properties?: Readonly<Record<string, readonly string[]>>; normalizePath?: (pathname: string) => string },
): SanitizedAnalyticsEvent | null;
interface PostHogLike {
  init(apiKey: string, config: Record<string, unknown>, name: string): PostHogLike | undefined | void;
  readonly config?: { readonly before_send?: unknown }; // read only to check the instance identity (C-44)
  capture(eventName: string, properties?: Record<string, unknown>): unknown;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
}
function createPostHogProvider(sdk: PostHogLike, config: { key: string; apiHost: string }): AnalyticsProviderPort;
```

`PostHogLike` is the subset of the provider SDK object that the adapter
calls, declared structurally so that the package never imports the SDK
(C-3). The key and host are host values (O-7). The provider adapter takes
no other option; nothing a host passes can reach the SDK's configuration.
The transport's `normalizePath` option is the single place where a path
normaliser is supplied: the transport passes it to
`sanitizeAnalyticsEvent`, and hands the resulting URL sanitizer to the
provider through `init(context)`.

- **C-17 Off by default.** Permission starts `false`. While permission is
  unknown or denied, the transport never calls `loadProvider`, never
  initializes and never captures. A capture made before permission is
  dropped, not queued.
- **C-18 Initialization is lazy and happens once.** An initial
  `setPermission(true)` starts one load. When the load resolves, the
  transport calls `init(context)` and then `optIn()`. Captures made while
  loading go into the bounded memory queue (C-43). The provider is
  initialized at most once per page. A later grant after a withdrawal
  calls `optIn()` and never a second `init()`.
- **C-19 Withdrawal stops everything the transport controls.**
  `setPermission(false)` advances a generation counter. It clears the
  queue, cancels every scheduled retry or delayed capture, and calls
  `optOut()` if the provider was initialized. `loadProvider` takes no
  cancellation signal, so an in-flight load is not stopped: when it
  resolves under an older generation, its result is discarded and never
  initialized, and nothing is captured through it (P-10).
- **C-20 Events are redacted before capture.** URLs keep the origin and
  path, and lose the query and fragment. When `normalizePath` is given, it
  runs on the path, and its output is accepted only if it still starts with
  `/` and contains no `?` or `#`; otherwise the event is dropped. The
  referrer is reduced to an origin. Only pageviews and allowlisted
  conversions are sent, and an allowlisted conversion name that begins
  with `$` is refused, so it can never collide with a provider's reserved
  event names. Properties are allowlisted per event and limited to bounded
  primitive values. No `identify` call exists on any port.
- **C-43 Transport limits are fixed and typed for any runtime.** A failed
  load schedules one retry after 5000 milliseconds through the scheduler;
  if the retry fails, the transport is `failed` for the page load and drops
  captures. A provider whose `init(context)` throws is `failed` at once,
  with no retry. The default scheduler looks up `globalThis.setTimeout`
  and `globalThis.clearTimeout` when it schedules, never at module scope.
  The queue holds at most `maxQueued` events (default 50), and an overflow
  drops the oldest. The subtree uses no DOM type: it compiles under
  Observer's existing compiler settings (ES2022 library without DOM,
  `exactOptionalPropertyTypes`, NodeNext resolution with explicit file
  extensions in relative imports) with no change to them.
- **C-44 The provider adapter forces safe options, owns its instance, and
  allowlists the SDK's own properties.**
  - *Instance.* `init(context)` calls `sdk.init(key, config, name)` and
    from then on calls methods only on the instance that call returns. The
    SDK's `init` on a name it has already loaded returns the existing
    instance unchanged, ignoring the new configuration, so a fixed name is
    not enough. The adapter therefore does both of these. It uses a name
    unique to this adapter: the fixed prefix `POSTHOG_INSTANCE_PREFIX` plus
    a suffix generated when `createPostHogProvider` is called (never at
    import, C-1), so two adapters in one page never share it. And it
    requires the returned instance to carry this adapter's own
    `before_send` hook: `returned.config.before_send` must be the very
    function the adapter passed (identity, not equality). If `init` returns
    nothing, returns the host-supplied object itself, or returns an
    instance whose `before_send` is not this adapter's hook, the adapter
    throws (C-43), so an instance that the host or another adapter already
    initialized with its own configuration is never used.
  - *Forced configuration,* written by the adapter alone: `api_host` (the
    host value), `autocapture: false`, `rageclick: false`,
    `capture_pageview: false`, `capture_pageleave: false`,
    `capture_dead_clicks: false`, `capture_exceptions: false`,
    `capture_performance: false` (web vitals and network timing),
    `enable_heatmaps: false`, `disable_session_recording: true`,
    `disable_surveys: true`, `disable_web_experiments: true`,
    `advanced_disable_feature_flags: true`,
    `advanced_disable_feature_flags_on_first_load: true`,
    `person_profiles: "identified_only"` (no `identify` call exists, so no
    person profile is created), `persistence: "memory"`,
    `opt_out_capturing_by_default: true`, and a `before_send` hook.
  - *Event names.* A sanitized pageview is captured as `$pageview` with
    the sanitized URL as its current-URL property and the referrer origin
    as its referrer property. A conversion is captured under its
    allowlisted name, unchanged.
  - *`before_send`.* The hook drops every event whose name is not in
    `context.eventNames`, which removes any event the SDK emits by itself,
    such as an opt-in marker. It removes any person-property payload
    (`$set`, `$set_once`). It keeps only the properties named in one
    exhaustive constant, `POSTHOG_PROPERTY_ALLOWLIST`, plus the transport's
    own sanitized properties for that event, and drops every other
    property. The allowlist names the delivery fields (`token`,
    `distinct_id`, `$lib`, `$lib_version`, `$insert_id`, `$time`), the
    profile-suppression field `$process_person_profile`, and the URL
    fields (`$current_url`, `$host`, `$pathname`, `$referrer`,
    `$referring_domain`). The URL fields are never kept as the SDK set
    them; the hook overwrites all five. `context.sanitizeUrl` takes a full
    URL, so the hook passes the SDK's `$current_url` through it once and
    drops the event if it returns `null`. It then sets `$current_url` to
    that sanitized URL, and derives `$pathname` (the path) and `$host`
    (the host) from that same sanitized URL, never from the SDK's own
    `$pathname` or `$host`. For a captured transport event, `$current_url`
    is already the transport's sanitized `url` (see *Event names*), so
    sanitizing it again leaves it unchanged. When the transport supplied a
    `referrerOrigin` for the event, the hook sets `$referrer` to that
    origin and `$referring_domain` to its host; otherwise it removes both.
    A referrer value the SDK set by itself, such as a direct-entry marker
    or a full referrer URL, never passes through.
  - Whether these option and property names behave as named in the SDK
    version a host installs is separate evidence (see "Separate
    evidence").

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
is `{ persistence, storage, evidence, withdrawal, gpcInForce, simulated }`.
Its `simulated` field is `false` for a live lifecycle, the active
review-seam value (`"fresh"`, `"granted"`, `"refused"` or `"gpc"`) under
the seam, and `"preview"` for any other lifecycle whose snapshot reports
`simulated: true`, which in practice is the fixed-clock preview's.
`ResolvedConsentCopy` is defined under Copy. The structural port types
(`ConsentStoragePortView`, `ConsentLifecycleInput`, `ConsentLifecyclePort`,
`ConsentSnapshotView`, `AnalyticsPermissionPort`) are exported as types
from `@clossys/publisher/web/consent`, which is where unit E's
conformance test imports them from (C-53).

- **C-22 Hydration-safe.** The server render and the initial client render
  use the no-decision snapshot. No notice renders, and `useAnalyticsAllowed()`
  is `false`, under every regime. Storage, Global Privacy Control and the
  reopen fragment are read only after mount. The server HTML therefore
  never depends on a stored choice and never mismatches on hydration.
- **C-23 Both gate conditions are required.** Analytics may start only when
  `required` is true **and** a non-simulated lifecycle reports allowed.
  `useAnalyticsAllowed()` returns exactly
  `required && snapshot.allowed && !snapshot.simulated && !seamActive`,
  where `seamActive` is true while a review-seam value other than `live`
  is in force. A preview or seam snapshot that carries `allowed: true`
  therefore reads as `false`.
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
  only when the snapshot's `promptAutomatically` holds, or under C-55. It
  otherwise opens only through reopen. A choice closes it, with one
  exception: after a failed withdrawal it stays open with the
  `withdrawalFailed` status (C-13, C-55). A no-op accept (C-39) is not a
  choice, so the notice stays as it was, showing `gpcInForce`. Every other status (`memoryOnly`,
  `storageUnavailable`, `evidenceUnavailable`, `evidenceConflict`) closes
  with the choice and is shown the next time the notice opens and through
  `useConsentStatus()`. Focus returns as C-26 describes. No other consent
  surface exists: no dialog, no preferences screen, no footer control.
- **C-26 Escape sets the notice aside.** The assembly wrapper handles
  Escape; Designer does not. Escape inside the notice closes it for the
  current page view, in memory. It records nothing, calls no port, fires no
  `onChange` and changes no permission. A full document load starts a new
  page view; a client-side route change does not. While `withdrawal` is
  `failed`, Escape does nothing, so it never hides the sole failure signal
  (C-55).
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
  before opening on reopen. It sets no timer for expiry. Each of these is a
  re-read under C-54, so none of them replaces a choice made in memory
  this visit or clears a failed withdrawal.
- **C-55 A failed withdrawal keeps the notice open.** Whenever the
  snapshot's `withdrawal` is `"failed"`, the notice is open with the
  `withdrawalFailed` status: after the refusal that failed, on arrival
  (as the preview's `withdrawal-failed` state shows), after every re-read
  and re-render, and after an earlier Escape. Neither Escape (C-26) nor a
  repeated refusal closes it; it closes only when `withdrawal` returns to
  `"idle"` (C-13).
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
  at import with an error naming the subpath and the condition. Condition
  order matters, because resolvers take the earliest matching key: each
  subpath lists `types` first, then the refused or server condition
  (`react-server` or `browser`) before any `development` or `default`
  key:
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
  (C-4), and tests pass the condition explicitly. A production build sets
  `production` instead of `development`, so the preview entry cannot be
  resolved in one; the refusal module is what such a build reaches.

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
  defines structurally, that starts empty and that records each read and
  each write. The host's factory honours these fields (H-3). The assembly
  then checks, in this order:
  1. Immediately after `createLifecycle` returns, and before any `grant()`
     or `refuse()`, `getSnapshot().simulated` must be `true`, **and** the
     in-memory port must already have recorded the lifecycle's mount
     `read()`, made during `createLifecycle`. A factory that passes
     `simulated: true` through but wires its own storage (for example the
     host's real storage port) instead of the supplied port never reads the
     in-memory port, so it fails here, before any seeding call.
  2. For `granted` and `refused` only, the assembly calls `grant()` or
     `refuse()` once, so the seeded state comes from Butler's own rules,
     with no fixture and no re-implemented rule. The in-memory port must
     then hold the seeded write.

  If either check fails, the assembly disposes the lifecycle, reports a
  development error, and renders the notice from the fixed no-decision
  snapshot (C-22) with inert actions. A lifecycle that fails check 1
  therefore receives no `grant()` or `refuse()` from the assembly, so
  nothing the seam does can make it write, under the real key or any
  other. What a factory does inside `createLifecycle` itself is outside
  the assembly's reach: Butler's lifecycle writes nothing at mount (the
  transition table), and a factory that writes there breaches H-3.
  Under the seam, a refusal after
  `granted` is a withdrawal (C-13, through the read-back) and succeeds
  against the in-memory port. The seam cannot show a failed withdrawal,
  because its port never fails; the preview's `withdrawal-failed` state
  covers that.

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
  `simulated: true`, so the transport is never bound to it (C-45) and
  `useAnalyticsAllowed()` is `false` for every state (C-23). Some of its
  rows carry `allowed: true` to show what a live visitor would see; that
  is display state, not permission. C-42 binds Butler's lifecycle only and
  does not apply here.
- **C-34 Simulated never reads as durable.** The preview can produce
  `simulated-saved` and can never produce `saved`. The live lifecycle can
  never produce `simulated-saved`, and the two are distinct types.
  An expired record renders identically to its regime's fresh state, with
  no expiry wording: the `expired` state is the `prompt` case and is
  byte-identical to `fresh-prompt`, and under `notice` an expired record is
  `fresh-notice`. The dialog-only "cancel" state of earlier revisions no longer
  exists.
- **C-51 The preview states are exactly this table.** Each state produces
  the snapshot fields listed (every field not listed has its
  `NO_DECISION_SNAPSHOT` value, except `simulated: true`), the `required`
  value, and the notice behaviour on arrival and on reopen. Rows with
  `allowed: true` are display state only (C-33).

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
  Hosts map their deployment environment to a target: `development` and
  `preview` use `"preview"`, and `production` uses `"production"` (H-8).
  Under `"production"`, a resolution is accepted only with an owner
  approval (`approval.approvedBy === "owner"`): a resolution with no
  `approval` is refused, a delegate approval is refused however it was
  authorized, and synthetic copy is refused. Writer has no fixture marker,
  so consent copy treats a registry whose `source.kind` is `"generated"`
  as synthetic. The production rules do not depend on the declared target
  alone: when `process.env.NODE_ENV` is `"production"` at call time (read
  inside the call, never at import, C-1), `resolveConsentCopy` throws if
  `target` is `"preview"` and applies the production rules to every field.
  A host that declares `"preview"` in a production build therefore gets an
  error, never delegate-approved or preview copy. The check reads
  `process` through `globalThis`, so a runtime with no `process` (an edge
  or worker runtime) does not throw on the read; there, and wherever
  `NODE_ENV` is absent or any value other than `"production"`, the build is
  treated as **not** production, and only the declared `target` decides.
  Such a host must declare `"production"` itself (H-8).

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
- **H-8 Bind the copy target to the deployment.** The host derives the
  copy `target`, and the `target` it passes to `createCopyResolver`, from
  its build or deployment environment, never from a request, a query
  parameter or another value a visitor can set (C-52).

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
- **#1938 lifecycle options and evidence ordering.** #1938's scope now
  includes `evidence?: ConsentEvidencePort | false | undefined` and
  `simulated?: boolean | undefined` on `createConsentLifecycle`, so that
  Publisher's factory input maps onto them directly (C-53), and the pure
  `shouldApplyEvidence` helper (C-41).
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
- API: the record and decision rules (including `shouldApplyEvidence`),
  the lifecycle and ports (including the `evidence` and `simulated` option
  types that C-53 relies on), and the storage adapter, as specified in
  Contracts.
- State transitions: the transition table; C-5 to C-16, C-37 to C-42,
  C-54 and C-56 to C-61.
- Fixtures: a fixed clock, an in-memory storage port with switchable
  failure modes (read unavailable, write fails, remove fails, read returns
  a stale grant, storage cleared from outside), a deferred evidence port
  that resolves on demand and records each `sequence`, a legacy record, a
  future-dated record, a clock that can move back, move forward and return
  an invalid date, and a fake storage area that can emit `storage` events
  for any key, for a `null` key and from another area.
- Proof: P-2 to P-8, P-23 to P-26 and P-32.

### #1940 Observer transport

- Paths: `packages/observer/src/browser-analytics/` only. Suggested
  modules: `transport`, `sanitize` and `providers/posthog`, and an internal
  `index` barrel. The root, the manifest and the compiler settings stay
  untouched.
- API: the transport, the sanitizer and the provider adapter, as specified
  in Contracts.
- State transitions:
  - `off` (never initialized) → `setPermission(true)` → `loading`.
  - `loading` → load resolves and `init(context)` succeeds → `ready`
    (`init` then `optIn()`).
  - `loading` → load fails → `retry-scheduled` → `loading` once; a second
    failure → `failed`.
  - `loading` → `init(context)` throws → `failed`, with no retry.
  - `loading` or `retry-scheduled` → `setPermission(false)` → `off`, with
    the generation advanced, the retry cancelled and any late load
    discarded; a later `setPermission(true)` starts a new load with a new
    single retry.
  - `ready` → `setPermission(false)` → `opted-out` (initialized; `optOut()`
    called, queue cleared).
  - `opted-out` → `setPermission(true)` → `ready` through `optIn()`, never
    a second `init()`.
  - `failed` → any `setPermission` → `failed` for the page load:
    permission is recorded, nothing loads, and captures are dropped.
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
  source. It is a new repository-level script test with the stem
  `consent-port-conformance`, beside the existing repository script tests,
  that runs the TypeScript compiler with no emit over a fixture directory
  of the same name under the script fixtures, after the build. The
  fixture imports the real types by package name from the Butler and
  Observer subpaths above and the structural port types from
  `@clossys/publisher/web/consent`. Because it resolves those names to
  built declaration output, it also needs four existing files, named here
  by their location rather than by path: the gate test set module in the
  script library (`gate-test-set.mjs`), the root `package.json`, the main
  CI workflow (`ci.yml`) and the gated-script prose input table in the
  script library (`gated-script-prose-inputs.mjs`).
- Wiring, verified against the default branch at the time of writing:
  `check:gates` runs every script test that the gate test set module
  discovers, in the dependency-free safety job, before any build exists.
  A test that needs built packages is excluded there by name and run after
  the build, as the launcher qualification and fleet coverage tests are.
  Unit E follows that pattern:
  1. adds the new test to `GATE_TEST_EXCLUSIONS` in the gate test set
     module, with the reason that it type-checks
     against the built Butler, Observer and Publisher declarations and
     needs `npm run build` first;
  2. adds a root script `check:consent-port-conformance` to `package.json`
     that runs the test with `node --test`, a matching `//` comment entry
     in the manifest's own style, and that script in the root `check`
     chain after its `npm run build` step;
  3. adds a step that runs `npm run check:consent-port-conformance` to the
     `build` job (`build and test`) in the main CI workflow, after
     that job's `npm run build`, beside the launcher help step;
  4. adds the test's entry, `prose: false`, to the gated-script prose
     input table, which the workflow reference test requires for every
     script the main CI workflow invokes.
- Export keys: `@clossys/butler/browser-consent` (the pure functions, the
  lifecycle and the types, with no adapter),
  `@clossys/butler/browser-consent/local-storage` (the storage adapter
  alone), `@clossys/observer/browser-analytics` (the transport and the
  sanitizer) and `@clossys/observer/browser-analytics/posthog` (the
  provider adapter alone). Adapters ship in their own subpaths so that
  importing the decision functions never reaches one (O-5).
- **C-53 The real implementations satisfy Publisher's structural ports.**
  Under the repository's strict compiler settings, including
  `exactOptionalPropertyTypes`:
  - Butler's `ConsentLifecycle` is assignable to `ConsentLifecyclePort`,
    and `ConsentSnapshot` to `ConsentSnapshotView`.
  - Butler's `ConsentStoragePort` and `ConsentStoragePortView` are
    assignable to each other.
  - Observer's `AnalyticsTransport` is assignable to
    `AnalyticsPermissionPort`.
  - A reference host factory type-checks with no cast:
    `(input) => createConsentLifecycle({ ...hostOptions, signals: input.signals,
    storage: input.storage ?? hostStorage, evidence: input.evidence ?? hostEvidence,
    simulated: input.simulated })`. This holds because #1938 declares
    `evidence?: ConsentEvidencePort | false | undefined` and
    `simulated?: boolean | undefined`. Butler's `storage` stays required:
    a lifecycle with no storage port has no defined behaviour, so the
    factory, not Butler, chooses between the seam's port and the real one
    (H-3).
- Proof: P-31.
- Done when: `npm run check:gates` passes without running the new test
  (it is excluded by name); after `npm run build`,
  `npm run check:consent-port-conformance` passes; the workflow reference
  test (the repository script test with the stem
  `check-workflow-references`) passes,
  which proves the new root script is invoked by a workflow and has its
  declared-table entry; and the `build and test` job runs the new step.

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
| P-3 | #1938 | `persistence` :: a failed save never reports a stored choice; a memory-only choice never reaches the evidence port; a memory-only grant and a memory-only denial both survive `refresh()` and a cross-tab event carrying an older record, and are replaced only by a live, newer record not dated after `now`; with the clock moved back, a future-dated grant in storage never replaces a refusal held in memory after a failed write, on `refresh()`, `visibilitychange`, `pageshow` or a cross-tab re-read; a newer denial written under another `policy.version`, which parses here as no choice, never replaces an in-memory denial; a re-read whose storage read is `unavailable` keeps this visit's refusal, stored or in memory, and a grant held only in memory (never `unknown`) with `persistence: "memory"` and `storage: "unreadable"`; the same re-read drops a grant this visit stored to `unknown` (or `denied` with GPC on), not allowed, `storage: "unreadable"`, persistence `none`; a stored refusal made this visit that a re-read no longer finds is reported as `memory`, not `stored` | C-7, C-11, C-37, C-40, C-41, C-54, C-56, C-58 | report `stored` after an `unavailable` write; call evidence after a failed write; let `refresh()` re-evaluate from storage alone; compare `decidedAt` before checking liveness; drop this visit's refusal or memory-only grant to `unknown` on an unreadable re-read; keep a stored grant allowed on an unreadable re-read; keep `persistence: "stored"` after the stored refusal disappears |
| P-4 | #1938 | `expiry` :: expiry fixed at decision and not renewed by reads or reopenings; every explicit choice writes a fresh record; expired reads as no choice; reading caps expiry; a future-dated denial stays live and a future-dated grant does not | C-6, C-38, C-40 | recompute `expiresAt` on read; skip the read-time cap; treat a future-dated denial as no choice |
| P-5 | #1938 | `decision` :: regime (`prompt`, `notice`, missing) × GPC (on, off) × record (none, granted, granted with override, denied, expired, older policy, corrupt, unreadable) | C-5, C-7, C-8, C-9, C-37 | default a missing regime to `notice`; treat unreadable as no choice under `notice` |
| P-6 | #1938 | `withdrawal` :: a refusal from a grant, and from no choice under `notice`, is a withdrawal; `allowed: false` is published before the write; write and removal both failing with a grant still readable is `failed`; under `notice`, a failed write with a successful removal is `failed`; an unreadable read-back is `failed`; after a failed withdrawal, `refresh()` keeps `allowed: false` and `withdrawal: "failed"`; a second refusal while the read-back still shows the grant stays `failed`; `failed` returns to `idle` only once a read-back is `not allowed`; after a failed withdrawal with the clock moved back, a future-dated grant in storage never replaces the in-memory denial on `visibilitychange`, `pageshow` or a cross-tab re-read, and `withdrawal` stays `failed`; a newer denial another tab wrote under a different `policy.version` (no choice here) never replaces the in-memory denial; a grant stored at T0, the clock moved back a day, a `refuse()` whose write and removal both fail and whose read-back sees the T0 grant, then the clock corrected to T0 plus two hours and `refresh()`: still `denied` with `withdrawal: "failed"`; a grant dated T0 plus a day in storage while the clock reads T0, so the snapshot is not allowed, then `refuse()` whose write fails: the read-back at the call counts the grant, so the refusal is a withdrawal with `withdrawal: "failed"` and watermark T0 plus a day, and after the clock is corrected past it, `refresh()` still reports `denied`; a failed withdrawal whose read-back saw no record (under `notice`) sets no watermark, and a second failed withdrawal that sees an older record leaves the watermark at the later date; a `clock()` that returns an invalid date or throws at `refuse()` after mount: `allowed: false` is published first, nothing is written, `refuse()` does not throw, a grant of any date in storage (or no record under `notice`) makes it a withdrawal that stays `failed` and never returns to `idle` while the clock stays invalid, the undated denial is never sent to evidence, and no later re-read lifts it, even one that finds a newer live grant once the clock recovers; only `grant()` replaces it; `grant()` under an invalid clock after mount is a no-op that does not throw | C-7, C-13, C-15, C-40, C-54, C-57, C-61 | report success without read-back; treat a refusal from no choice under `notice` as a plain refusal; let `refresh()` re-evaluate from storage alone; classify a refusal as a withdrawal from the in-memory snapshot only; compare `decidedAt` before checking liveness; forget the record the failed read-back saw; count a future-dated grant as `not allowed` in a withdrawal's read-back; classify the read-back at the call with plain `isAllowed`; move the watermark backward, or set it from a read-back that saw no record; read the clock before publishing `allowed: false`; date the undated denial with the epoch or the last valid `now`; return to `idle` under an invalid clock while storage holds a grant; throw from `grant()` under an invalid clock |
| P-7 | #1938 | `browser-only` :: with no evidence port, a grant-and-refuse cycle makes zero `fetch` or `sendBeacon` calls and evidence is never `saved` | C-14 | report `saved` without a port |
| P-8 | #1938 | `isolation` :: no core module reads a browser global at module scope or imports an adapter; a legacy record parses only with `policy.legacy`, takes `assumedPolicyVersion`, keeps its original expiry and is never rewritten; a legacy-shaped value with a `gpcOverride` field reads as no choice; `parseStoredChoice` returns `null` without throwing for an out-of-range date, as read or once capped, and for a current-shape date that is date-only, local, offset other than `Z` or in another format | C-2, C-10, C-60 | add a module-scope `localStorage` read; rewrite a legacy record on read; treat a dateless legacy record as live; carry `gpcOverride` through on a legacy record; let an out-of-range date throw from `parseStoredChoice`; accept a date with a `+00:00` offset |
| P-9 | #1940 | `transport` :: unknown consent never loads or captures | C-17 | initialize while permission is unknown |
| P-10 | #1940 | `transport` :: withdrawal during loading leaves the provider uninitialized when the deferred load later resolves, with no capture through it; withdrawal cancels a pending retry | C-19 | send a queued capture after withdrawal; initialize a load that resolved after withdrawal |
| P-11 | #1940 | `sanitize` and `posthog` :: initialization happens once; queries and fragments are removed; the referrer becomes an origin; an invalid `normalizePath` result drops the event; a `$`-prefixed conversion name is refused; pageviews are captured as `$pageview` and conversions under their own name; the `before_send` hook keeps only `POSTHOG_PROPERTY_ALLOWLIST` plus the transport's properties, removes `$set` and `$set_once`, and drops events the transport did not send (including an opt-in marker); `$current_url` is the sanitized full URL, `$pathname` and `$host` are derived from that sanitized URL even when the SDK set different values, `$referrer` is the referrer origin and `$referring_domain` its host, an SDK referrer with no transport origin removes both, and an event whose `$current_url` the sanitizer rejects is dropped | C-18, C-20, C-44 | initialize on every capture; keep the query string; pass an SDK-added property outside the allowlist through unchanged; keep the SDK's own `$pathname` or `$referrer`; pass a path rather than the full URL to `sanitizeUrl` |
| P-12 | #1940 | `posthog` :: the `init` configuration holds every forced key with its value, no host value except key and host reaches it, and the adapter imports no SDK; `init` passes a name with the fixed prefix that differs between two adapters in one page, and every later call goes to the returned instance; an `init` that returns nothing, returns the host-supplied object, or returns an already-loaded instance whose `config.before_send` is not this adapter's own hook (identity) makes the adapter throw, the transport `failed` with no retry, and neither object receives a capture | C-3, C-43, C-44 | omit a forced init key; call `capture` on the host-supplied object instead of the returned instance; accept a returned instance without the `before_send` identity check; reuse one fixed instance name |
| P-13 | #1940 | `root-isolation` :: the Observer root import graph reaches no `browser-analytics` module | O-4, C-1 | re-export the transport from the root |
| P-14 | D | `ConsentBanner` :: the polite live region is always mounted, empty without a status; both actions stay enabled and equal | O-2, C-21 | disable reject while a status shows; mount the live region only with a status |
| P-15 | #1941 | `ConsentExperience` :: `required={false}` creates no lifecycle, binds no transport and ignores reopen; `onChange` fires on an acted-on choice only and never for a no-op accept | C-23, C-24, C-39 | fire `onChange` on mount or on a stored read; fire `onChange("granted")` for a no-op accept |
| P-16 | #1941 | `ConsentExperience` :: Escape records nothing and returns focus; Escape does nothing while a withdrawal has failed; withdrawal stays enabled while a grant is pending; a lifecycle whose snapshot has `withdrawal: "failed"` at mount shows the notice open with its status; a failed withdrawal keeps the notice open through a repeated refusal and a re-read; other statuses close with the choice | C-13, C-15, C-25, C-26, C-55 | persist Escape; close on a failed withdrawal; let Escape hide a failed-withdrawal notice; open the failed-withdrawal notice only after a refusal in this render |
| P-17 | #1941 | `ConsentExperience` :: server and initial client render match the no-decision snapshot | C-22 | read storage during render |
| P-18 | #1941 | `reopen` :: fragment and event open once, a leading `#` is ignored, the fragment is cleared, focus moves to the reopened notice, and `refresh()` runs on reopen, on `visibilitychange` and on `pageshow` | C-27, C-46, C-47 | open a second notice on a repeated trigger; skip `refresh()` on reopen |
| P-19 | #1941 | `review-seam` :: each value on loopback; ignored elsewhere; the factory receives the in-memory port, `evidence: false` and `simulated: true`; a factory whose lifecycle does not report `simulated: true` is disposed before any `grant()` or `refuse()` reaches it, nothing is written under the real key or any other; a factory that reports `simulated: true` but wires the host's storage, so the in-memory port records no mount `read()`, is disposed the same way before any seeding call and the host storage records no write; in both cases the fixed no-decision notice renders; a seed whose write the in-memory port did not receive disables the seam the same way; the real key is never written; the transport is never bound; `useAnalyticsAllowed()` is `false` under `granted`; the value lasts for the tab | C-23, C-30, C-31, C-32, C-50 | accept a non-loopback host; seed before checking `simulated`; bind the transport to a seeded lifecycle; check only `simulated` and not the mount `read()` on the in-memory port |
| P-20 | #1941 | `consent-copy/resolve` :: both leads and every status key required; draft, stale, expired-delegate, out-of-scope, wrong-locale, blank and placeholder copy refused; under `production`, unapproved, delegate-approved and generated-source copy refused; with `NODE_ENV` set to `production`, a declared `preview` target throws and delegate-approved copy that a preview-bound resolver returned is refused; with no `process` global, or with `NODE_ENV` absent, nothing throws on the read and the declared target decides | C-35, C-52 | omit the `notice` lead; accept generated-source copy under `production`; trust the declared target when `NODE_ENV` is `production` |
| P-21 | #1941 | `preview/adapter` :: each of the fifteen states produces its table row; zero I/O and no timers; explicit settle; `expired` identical to `fresh-prompt`; no `saved` from the preview; `production` refused | C-33, C-34, C-51 | auto-settle; return `saved`; give `withdrawal-failed` the `withdrawn` snapshot |
| P-22 | #1941 | `browser-import-closure` and `react-server-artifact` :: production closures exclude the preview and Designer's `/shell`; the client entry refuses `react-server` through its condition module; copy resolution refuses `browser`; the preview subpath refuses outside `development` | O-6, C-1, C-4, C-29, C-49 | import the preview or a Writer registry into the client entry; map `react-server` to the client entry |
| P-23 | #1938 | `gpc` :: a grant under a non-overridable signal writes nothing and calls no evidence port; a grant under an overridable signal records `gpcOverride`; a grant without it never overrides a signal that is on; a truthy non-boolean signal (`1`, `"1"`) counts as on in the lifecycle (`gpcInForce`), in `effectiveChoice`, `isAllowed` and `shouldPromptAutomatically`, and in `decideChoice` | C-8, C-39, C-59 | write a grant under a non-overridable signal; let a grant without `gpcOverride` override the signal; compare `signals.gpc === true` in any one reader |
| P-24 | #1938 | `evidence-order` :: every evidence call carries an increasing `sequence`; a conflict never upgrades to `granted`; `shouldApplyEvidence` applies a denial over a stored grant with a later `decidedAt` (a clock moved back) and refuses a grant with the same `decidedAt` and a lower or equal `sequence`; a delayed, older denial applies over a newer stored grant; a synchronous subscriber that calls `refuse()` inside the publish of a grant leaves exactly one evidence call, for the denial, and the grant's evidence is aborted; the snapshot never shows `pending` for the grant whose call was never made; a re-read that switches to another tab's record reports evidence `none`, and a later `saved` for the replaced choice leaves it `none`; a `conflict` whose re-read switches to another tab's record reports evidence `none`, not `conflict` | C-12, C-40, C-41 | pass a constant `sequence`; make a denial subject to the recency check; send evidence without checking that its `sequence` is still the latest; show `pending` for a choice whose call was never made; keep the replaced choice's `evidence` after a re-read switch; match a late result to the current choice by `seq` alone; report `conflict` after the conflict's re-read switched records |
| P-25 | #1938 | `simulated` :: a simulated lifecycle reports `allowed: false` after a grant and never calls an evidence port | C-42 | drop the simulated override |
| P-26 | #1938 | `local-storage` :: blocked or throwing storage reads `unavailable` without throwing; a `storage` event for the configured key, and one with a `null` key from the adapter's own storage area, reach the listener; an event for another key, or a `null`-key event from another storage area, does not; raw values come back unmigrated; nothing else is written | C-16 | let a throwing `getItem` propagate; notify for another key's event; drop a `null`-key clear event; forward a `null`-key event from another storage area |
| P-27 | #1940 | `transport-limits` :: one retry after the fixed delay through the injected scheduler; the default scheduler is resolved when scheduling; the queue's default bound drops the oldest; the subtree compiles without the DOM library | C-43 | drop the newest event instead of the oldest; resolve `setTimeout` at module scope |
| P-28 | #1941 | `ConsentExperience` :: the body uses the lead that matches the snapshot's `regime` | C-28 | always use the `prompt` lead |
| P-29 | #1941 | `bind-transport` :: `setPermission(false)` has happened before `refuse()` returns; unbinding sets `false`; a simulated snapshot never sets `true` | C-45 | move `setPermission` into a React effect |
| P-30 | #1941 | `hooks` :: hooks outside a `ConsentExperience` report not allowed and the no-decision status; `useAnalyticsAllowed()` is `false` for the preview's `remembered-granted` and `fresh-notice` states and `useConsentStatus().simulated` is `"preview"`; unmount and a `required` change dispose the lifecycle; a development double mount leaves one live lifecycle | C-23, C-48 | keep the lifecycle from the discarded mount alive; return `snapshot.allowed` without the simulated mask |
| P-31 | E | `consent-port-conformance` :: type-level assignability of each real implementation to its structural port, and the reference host factory compiling with no cast | O-3, C-53 | rename or retype one `ConsentSnapshot` field in Butler; narrow Butler's `evidence` option to `ConsentEvidencePort` only; drop the test's `GATE_TEST_EXCLUSIONS` entry, so `check:gates` sweeps in a suite that imports workspace packages and the workflow reference test fails |
| P-32 | #1938 | `refusal-floor` :: under `notice`, a refusal stored this visit and then a denial another tab wrote under another `policy.version` (no choice here): the re-read keeps `denied`, `allowed: false`, no automatic prompt, `memory`; under `notice`, a refusal stored this visit, the storage then cleared from outside and `refresh()`: the same; unreadable at mount, `refuse()` whose write reports `ok`, a read that then returns empty, and `refresh()`: still `denied`, `memory`; only a live grant dated after the refusal and not after `now` lifts the floor; a grant made this visit still moves to `denied` when another tab's denial arrives, with persistence `stored`; a refusal held in memory that a re-read replaces with another tab's live, newer denial reports `stored`; a grant dated T0 plus a day stored while the clock reads T0, `refuse()` whose write fails, the clock corrected past T0 plus a day and `refresh()`: still `denied`, not allowed, `withdrawal: "failed"` | C-54, C-56, C-57 | re-evaluate a stored refusal made this visit from storage alone; lift the floor with a record that parses as no choice; lift the floor with a future-dated grant; hold a grant made this visit against another tab's denial; report `memory` when another tab's live denial replaces the choice; classify the read-back at the call with plain `isAllowed` |

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
staged, published or adopted. These are separate evidence, recorded by
their own owners:

- a full publish-safety pass, packed-consumer proof and release
  qualification;
- adoption in a consumer's tree;
- behaviour against a real provider SDK, measured against the version a
  host installs:
  - that each forced option and allowlisted property name in C-44 exists
    and behaves as named;
  - that a named instance from `init` ignores an earlier default instance;
  - that `init` on an already-loaded name returns the existing instance
    unchanged, and that the returned instance exposes the configured
    `before_send` hook as `config.before_send` by identity, so the
    adapter's identity check (C-44) rejects a reused instance and accepts
    its own;
  - that `before_send` receives `$current_url`, `$pathname`, `$host`,
    `$referrer` and `$referring_domain` as event properties the hook can
    overwrite, and that the SDK sends the overwritten values;
  - whether `opt_in_capturing()` emits an opt-in marker event (the
    `before_send` hook must drop it);
  - where the SDK keeps its own opt-in and opt-out state, which may be a
    storage key of its own that `persistence: "memory"` does not govern;
  - whether its send queue drops queued events on opt-out (open question
    6).

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
7. **Storage that will not record a refusal.** Three cases reach C-13's
   residual state: storage that refuses both writing and removal and keeps
   returning the grant; under `notice`, a failed write with a successful
   removal, which leaves no record and so reads as allowed; and a
   read-back that cannot be read at all, which cannot confirm the
   refusal.
   Proposed default: no session-scoped marker. The refusal holds in memory
   for the visit and the visitor is told.
