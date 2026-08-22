# @vespeneventures/bouncer

**Everything about who you are, what you can do, and how that changes over
time.**

The question this role answers, and no other role does:

> **Is this actor who they claim, and is what they are doing still inside what
> they were granted?**

## The case this package exists for

A weaker tool checks that a session exists.

It passes while the role behind that session was revoked upstream an hour ago.
The session is real. It is well-formed. It is not expired. Nothing local has
changed, so nothing local can notice — and the provider of record, which does
know, was never asked.

**Presence of a session is not currency of a grant.** Every checker here is
built so that the only way to reach a clean answer is to have compared against
the provider and seen it answer. And when the provider cannot be reached, the
answer is neither "yes" nor "no": it is `unverifiable`, and the gate exits `2`.

## The closed loop

| Stage | Here |
| --- | --- |
| Setpoint | Declared authority — the grants live in your own system |
| Act | A grant, or a denial |
| Observation | Reconciliation against every provider of record |
| Comparison | Drift between what is live and what is still backed |
| Correction | Revoke, or re-assert |

A package that only answers "may they?" at runtime, without ever reconciling,
has a setpoint and an act and nothing else — half a loop, and the missing half
is the half that notices.

**Metric:** *unreconciled grant surface* — authority live here that no provider
still backs. `checkAuthorityReconciliation` counts it.

**Runtime verdict:** `authorized` / `denied` / `unverifiable`.

## Install

```sh
npm install @vespeneventures/bouncer
```

Nothing is required alongside it. This package declares **zero runtime
dependencies** — only optional peers (`@clerk/nextjs`, `next`, `react`,
`react-dom`, `svix`), each needed by exactly one subpath and installed only if
you import that subpath. The provider-neutral root, and `./agent`, need none of
them.

## The three gates

All three are reachable from the single `bouncer-check` bin.

```sh
bouncer-check authority-reconciliation grants.json providers.json --at 2026-08-22T12:00:00.000Z
bouncer-check delegation-ceiling actors.json
bouncer-check provider-contract mappings.json shapes.json
```

### `authority-reconciliation`

Every live grant traces to a provider that still backs it. Fails when a grant
is revoked upstream, is not backed by its provider of record at all, or has
passed its own declared expiry.

**Exits `2`, never `0`, when a provider could not be reached.** An unreachable
provider means the comparison did not happen, and the local view is exactly
what must not be reported on its own. It is not a denial either: fold
`unverifiable` into `denied` and a provider outage becomes a mass revocation;
fold it into `authorized` and the same outage becomes a silent blanket grant.

The same precedence holds inside a single run: if some grants were found
unreconciled *and* some providers were unreachable, the run reports
indeterminate. The findings it did produce are still printed — it is the exit
code that refuses to call the list complete.

### `delegation-ceiling`

A machine actor with no declared spend ceiling is a finding, **never an
unlimited default**.

`monetaryLimitAmount` has three distinguishable states and the distinction is
the point:

| Value | Meaning | Gate |
| --- | --- | --- |
| a number | a declared ceiling | clean, given a currency to read it in |
| `null` | "this actor has no monetary surface" | a finding, unless the record also carries `"unlimitedSpendIsDeclared": true` |
| absent | nobody decided | always a finding — there is no opt-out for a question nobody asked |

Also fails on: an amount with no currency, a currency with no amount, an actor
naming no responsible human, and an empty tool scope.

The runtime guard in `./agent` reads `null` as unlimited amount authority and
proceeds. The two disagree on purpose, at different times, about different
questions. The runtime asks "may this call proceed?" — and there is nothing
useful to do at that moment with a number nobody declared except refuse every
actor that has none, which would strand actors that legitimately have no
monetary surface. The gate asks "did anybody ever decide what this actor may
spend?", and treats silence as a finding rather than as consent.

### `provider-contract`

The adapter's mapping still matches the provider's declared shape. Checked in
both directions, because the two silences are different:

- **adapter → provider** — a field read, or an event recognised, that the
  provider no longer declares. The adapter is reading air.
- **provider → adapter** — an event the provider declares and the adapter does
  not recognise. The provider is talking to nobody.

Plus the subtler one: a field the provider still declares, but only
`"sometimes"`, against an adapter that fails without it — a mapping that works
until the first payload that omits it.

This package never fetches a provider's live schema. A gate that needed network
access, credentials and a per-provider client could not run in the offline,
hermetic position where a gate belongs. Transcribing the provider's declared
shape is yours; keeping the transcription honest against the adapter is the
gate's.

### Exit codes

`0` clean · `1` findings · `2` could not run.

`2` is not a variant of failure. It covers a missing, unreadable, unparseable
or schema-invalid record store; an empty record set; an unreachable or
unobserved provider; a provider shape that was never supplied; and — a bare
`bouncer-check` with **no gate selected at all**, which is a run that never
happened and prints its usage to stderr. An explicitly requested `--help` is
the one argument-shaped `0`: a help that was asked for did what was asked.

## Exports

### Root — `@vespeneventures/bouncer`

Provider-neutral. Nothing reachable from here imports a vendor SDK, a
framework, or React.

#### Authority records and their validators

| Export | What it is |
| --- | --- |
| `Grant` | One authority live in your own system: `grantId`, `actorId`, `subjectId`, `providerId`, `authority`, `grantedAt`, optional `expiresAt` and `sessionId` |
| `ProviderAssertion` | One observation of one provider of record, carrying `reachability` as its own field |
| `BackedAuthority` | One authority a provider still (or no longer) stands behind |
| `BackedAuthorityStatus` | `"active"` \| `"revoked"` |
| `ProviderReachability` | `"reachable"` \| `"unreachable"` |
| `DelegatedActor` | A delegated machine actor and its declared ceiling |
| `AdapterMapping` / `MappedField` | What an adapter reads and which events it recognises |
| `ProviderShape` / `DeclaredField` / `FieldPresence` | The provider's own declared shape, as you transcribed it |
| `BACKED_AUTHORITY_STATUSES`, `PROVIDER_REACHABILITIES`, `FIELD_PRESENCES` | The closed vocabularies, exported so a consumer can enumerate rather than restate them |
| `validateGrant` / `validateGrants` | Hand-rolled validators over `unknown`. Never throw |
| `validateProviderAssertion` / `validateProviderAssertions` | As above, for provider observations |
| `validateDelegatedActor` / `validateDelegatedActors` | As above, for machine actors |
| `validateAdapterMapping` / `validateAdapterMappings` | As above, for adapter mappings |
| `validateProviderShape` / `validateProviderShapes` | As above, for declared provider shapes |
| `isGrant`, `isProviderAssertion`, `isDelegatedActor` | Type guards over the same readers |
| `ValidationIssue`, `ValidationResult`, `Validator` | The shared validation result shape |

#### The verdict and the gates

| Export | What it is |
| --- | --- |
| `evaluateGrant` | One live grant against one provider observation. Returns `AuthorityDecision` |
| `AuthorityDecision` | `authorized` \| `denied` \| `unverifiable`, each naming the actor, the subject and the provider |
| `AuthorityDenialReason` | `revoked-upstream` \| `not-backed` \| `grant-expired` |
| `AuthorityUnverifiableReason` | `provider-unreachable` \| `provider-not-observed` \| `provider-mismatch` \| `unreadable-clock` |
| `checkAuthorityReconciliation` | Gate 1. Returns `AuthorityReconciliationResult`, carrying the unreconciled grant surface |
| `AuthorityReconciliationResult`, `ReconciliationFinding`, `ReconciliationFindingKind`, `ReconciliationFailureReason` | Its result shape |
| `checkDelegationCeiling` | Gate 2. Returns `DelegationCeilingResult` |
| `DelegationCeilingResult`, `DelegationFinding`, `DelegationFindingKind`, `DelegationFailureReason` | Its result shape |
| `checkProviderContract` | Gate 3. Returns `ProviderContractResult` |
| `ProviderContractResult`, `ProviderContractFinding`, `ProviderContractFindingKind`, `ProviderContractFailureReason` | Its result shape |

Every checker is pure: no I/O, no clock read, no ambient state. The instant to
judge against is a parameter, so the same inputs always produce the same
answer.

#### Runtime primitives

| Export | What it is |
| --- | --- |
| `defineRoleHierarchy` | Creates a closed, least-to-most-privileged hierarchy from your own role names. Rejects duplicates and blanks |
| `RoleHierarchy`, `Viewer` | Its types |
| `getRoleRank`, `isKnownRole`, `hasRoleAtLeast` | Rank lookups that fail closed for a role the hierarchy does not know |
| `resolveViewerRole`, `viewerHasAccess` | A viewer's configured role, never an unknown provider-supplied value |
| `isAuthorized` | Runs your predicate, denying missing, invalid, expired and throwing sessions before it is ever called |
| `Session`, `SessionResolver`, `AuthorizationPredicate` | Its types |
| `reconcileExternalMembership` | Idempotent, ordered reconciliation of provider membership events against your own store |
| `ExternalMembership`, `ExternalMembershipCreateInput`, `ExternalMembershipEvent`, `ExternalMembershipEventClaim`, `ExternalMembershipEventCursor`, `ExternalMembershipIdentity`, `ExternalMembershipReconciliationResult`, `ExternalMembershipRepository`, `ReconcileExternalMembershipCommand` | Its ports and result types |
| `QueryAdapter`, `TransactionalQueryAdapter`, `WithTransactionQueryAdapter` | The host-supplied storage seam. Statements and result shapes stay yours |
| `isQueryAdapter`, `isTransactionalQueryAdapter`, `requireTransactionalQueryAdapter` | Its guards, normalising a `withTransaction` pool without replacing its scoped query |
| `createAllowedOriginPolicy`, `isAllowedOrigin`, `resolveSafeRedirect` | A strict redirect allowlist. Every rejection returns `undefined` rather than a caller-controlled fallback |
| `AllowedOriginPolicy` | Its type |

### `./agent`

Delegated machine-actor authority. Provider-neutral, framework-neutral, and the
subpath `delegation-ceiling` reads records for.

`assertAgentCanCall`, `assertAgentMonetaryAuthority`,
`describeAgentLifecycleState`, `isAgentContextActive`,
`AgentAuthorizationError`, and the types `GenericAgentContext`,
`AgentLifecycleState`, `AgentAuthorizationFailureReason`,
`BaseAgentAuditRecord`, `IsoDateTime`.

### `./providers/clerk` and its subpaths

Every provider adapter is isolated behind its own subpath, and the root never
imports one. The Clerk adapter ships as `./providers/clerk` (event mapping and
webhook verification) plus `./providers/clerk/web`,
`./providers/clerk/web/client`, `./providers/clerk/web/server`, and
`./providers/clerk/web/proxy`, split so importing the edge-safe proxy entry
never pulls `next/headers`, `next/navigation`, React, or client components.

Each of those entry points guards its own optional peer with
`assertPeerVersion`, evaluated once at import time. An absent peer and an
out-of-range peer throw different messages, because "not installed" and
"installed but incompatible" are different problems with different fixes; an
installed version this guard cannot parse at all is treated as indeterminate
and warns rather than blocking a build.

## One-way, for public consumption

No values, roles, tiers, ceilings, currencies, providers or policies of ours
appear anywhere in this package. There is no role vocabulary, no entitlement
catalogue, and no jurisdiction logic. Every declaration is authored by the
consumer.

Actor and subject stay separate identifiers in every signature, and neither is
ever derived from the other: an operator acting on their own account and an
operator acting on somebody else's are different events with different
consequences, and one conflated identifier makes them indistinguishable
forever — after the fact, in the only record anyone will still have.

Storage and audit are host-supplied ports. This package writes nothing, stores
nothing, and commits no person-attributable record anywhere.

**Ships the schema and the checkers; every consumer authors its own values.**
