# @clossys/bouncer

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

**Gate count:** *unreconciled grant surface* — authority live here that no
provider still backs. `checkAuthorityReconciliation` counts it. That count is
0 on an empty set and is not the charter metric.

**Charter metric:** *unreconciled grant rate* — live grants not independently
backed by their current provider of record / all live grants evaluated.
`assessUnreconciledGrantRate()` computes it.

**Runtime verdict:** `authorized` / `denied` / `unverifiable`.

## Install

```sh
npm install @clossys/bouncer
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installing it needs no authentication: no npm token, no `.npmrc` registry
override, and no GitHub credential of any kind.

Nothing is required alongside it. This package declares **zero runtime
dependencies** — only optional peers (`@clerk/nextjs`, `next`, `react`,
`react-dom`, `svix`), each needed by exactly one subpath and installed only if
you import that subpath. The provider-neutral root, and `./agent`, need none of
them.

## Unreconciled grant rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is `unreconciled
grant rate`, computed by `assessUnreconciledGrantRate()`. An empty evaluated
set is `indeterminate`, never a perfect rate of 0.
`checkAuthorityReconciliation` still reports unreconciled grant surface as a
count; that count is not this rate. Unverifiable observations stay
unevaluated and are never folded into the rate. Grant expiry is not this
metric. This package does not measure consumer evidence and does not close
the loop. A green run of this package's tests is not a close.

```ts
import { assessUnreconciledGrantRate } from "@clossys/bouncer";

const report = assessUnreconciledGrantRate(input);
```

```bash
bouncer-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "bouncer-rate-check", "invocation": "single-json-input" } }
```

Onboarding discovers that declaration from the installed manifest and never
infers a surface. `bouncer-check` remains the three-gate CLI and is not the
assessment surface. Bouncer is not a required first-day role; Advisor
remains the only required first-day assessment.

## The three gates

All three are reachable from the single `bouncer-check` bin. The charter
assessment is a second mapped bin, `bouncer-rate-check`, and is not a fourth
gate on this dispatcher.

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
code that refuses to call the list complete. When the surface is non-zero, the
unreconciled line names its provider reference: the `providerId` of each
failing grant's provider of record, so a run spanning several owners' grants
names the failing side.

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

## Site security-headers baseline

`createSiteSecurityHeaders` builds the HTTP security-header baseline for a
site surface. One call returns `SiteSecurityHeadersVariants`: a `development`
result and a `production` result, both `SiteSecurityHeadersResult`. The
caller passes a `SiteSecurityHeadersInput` and applies the header map. This
package does not invent a package declaration.

Production script policy is one of two modes:

| Mode | `script-src` | Result |
| --- | --- | --- |
| `nonce` | `'nonce-…'` and `'strict-dynamic'` | The policy has no `'unsafe-inline'`. `warnings` is empty. |
| `static` | `'self'` and `'unsafe-inline'` | Emitted when the caller declares an attributed framework exception. The result reports that exception as a `SiteSecurityHeaderWarning`. |

An undeclared script `'unsafe-inline'` is a refusal, and that token is not in
the emitted policy. Production refuses `'unsafe-eval'`, `'wasm-unsafe-eval'`,
a scheme-only source (`http:`, `https:`, `ws:`, `wss:`), a source containing
`*`, and a `data:` or `blob:` source on every extension directive. A caller
source string that contains whitespace or `;`, including at either end of the
raw string before trimming, is refused. The result is
`ok: false` with reason `refused-source`, and the refused token is absent
from the emitted policy.

The development variant adds `'unsafe-eval'` to `script-src`. The production
variant from the same call does not contain it.

A successful policy is a `SiteSecurityHeaders` map. Its
`Content-Security-Policy` includes `object-src 'none'`, `base-uri 'self'`,
and `frame-ancestors 'none'`. Style `'unsafe-inline'` is included when an
attributed package declaration names the package on `styleDeclarations`. A
declaration that does not name a package is refused.

`Strict-Transport-Security` is `max-age=63072000; includeSubDomains`. The
value does not contain `preload`.

`Referrer-Policy` is `strict-origin-when-cross-origin`.

`Permissions-Policy` is `camera=(), microphone=(), geolocation=(), payment=()`.

A host source — one or more DNS labels of ASCII letters, digits, and `-`
(a label may start or end with `-`), with an optional trailing dot,
`host:port`, `host/path`, a scheme-less host, or a bracketed IPv6 address — is
emitted only when the caller lists it on
`extensions`. The same host in `scriptSources` is not copied into the policy.
A style
declaration source other than `'unsafe-inline'` is not copied into
`style-src` unless that exact source is also on `extensions`.

```ts
import { createSiteSecurityHeaders } from "@clossys/bouncer";

const variants = createSiteSecurityHeaders({
  script: { mode: "nonce", nonce: "exampleNonce" },
  extensions: [{ directive: "frame-src", source: "https://video.example.test" }],
});

if (variants.production.ok) {
  variants.production.headers["Content-Security-Policy"];
  variants.production.headers["Strict-Transport-Security"];
  variants.production.headers["Referrer-Policy"];
  variants.production.headers["Permissions-Policy"];
}
```

## Gated-host responses

A gated host answers the public with nothing, and says so the same way every
time. These helpers use Fetch globals only and import no framework or
provider.

| Export | What it does |
| --- | --- |
| `applyGatedHostHeaders(response, options?)` | Sets, never appends, `X-Robots-Tag: noindex, nofollow` on `response.headers`. Sets `Cache-Control: no-store` for status 300-399, 401, 403 and 503, or when `options.noStore` is true (a sign-in page). Otherwise leaves `Cache-Control` alone |
| `createRobotsTxtRoute()` | Returns `() => Response`: 200, `text/plain; charset=utf-8`, a deny-all body, and the robots tag |
| `createHealthRoute()` | Returns `() => Response`: 200, `{"status":"ok"}`, `no-store`, and the robots tag. It takes no options and probes nothing |
| `createServiceUnavailableResponse(options?)` | A 503 with `{"error":"unavailable"}`, `Retry-After` of `retryAfterSeconds` (default 30), `no-store`, and the robots tag. A negative or non-integer value throws `TypeError` |

`/robots.txt` and `/health` must be public routes of the proxy that gates the
host. A 401 or a redirect there hides the deny-all rule and fails monitors.

```ts
import { createHealthRoute } from "@clossys/bouncer";

export const GET = createHealthRoute();
```

## Gated-host gate

`@clossys/bouncer/gate` is one opt-in gate for a host that serves nothing to
the public. It is framework-neutral: it takes a Fetch `Request` and a
pass-through renderer and always returns a `Response`. The identity provider
is a seam (`resolvePrincipal`); the gate imports no provider and no framework.
Its response headers come from the gated-host response helpers above and its
return-URL rules from the redirect allowlist.

| Request | Answer |
| --- | --- |
| Signed-out navigation: `Sec-Fetch-Mode: navigate`, `Accept: text/html` with a quality above zero, or a Next.js `RSC` header or `_rsc` parameter | `307` to `signInPath` with a relative `redirect_url` and `no-store`. Never a 301 or 308 |
| Signed-out non-navigation, or any path under `apiPathPrefixes` (default `/api/`) | `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"` |
| `/.well-known/oauth-protected-resource` | `200` with the RFC 9728 document built from `protectedResourceMetadata`, for `GET` and `HEAD`; `405` for any other method |
| Signed in, `isPermitted` did not answer `true` | `307` to `notAuthorizedPath` for a navigation, `403` `{"error":"forbidden"}` otherwise. The not-authorized route itself is forced to `403` |
| `signInPath` and its sub-routes, or a path `isPublicPath` approves | Passed to `next`. Sign-in is rendered with `providerUnavailable` set when the provider did not answer, and in production the response is `503` with `Retry-After` |
| Provider throws, answers `null` or answers an unknown shape | Treated as unavailable. Gated routes fail closed exactly like signed-out; nothing answers 500 |
| `next` throws or returns a non-`Response` | `503` with `Retry-After` |
| A request URL that is not http(s) | `400` `{"error":"bad_request"}` |

Every response, including a pass-through, carries `X-Robots-Tag: noindex,
nofollow`.

The gate is closed by construction:

- Nothing is rendered before the decision. `next` runs only after the provider
  has answered and, on a gated route, the permission check has returned `true`.
  The exceptions are the sign-in routes and `isPublicPath` paths, which run
  without a sign-in, and the not-authorized route, which renders for any
  signed-in principal without the permission check (a signed-out visitor is
  still sent to sign-in).
- Every pass-through to a gated route (a permitted principal, the sign-in
  routes and the not-authorized route) is `Cache-Control: private, no-store`
  and `Vary: Cookie, Authorization`, whatever `next` returned: a `public` or
  `s-maxage` value is replaced and any existing `Vary` value is kept. A path
  `isPublicPath` approves is left as `next` rendered it. CDN-specific cache
  headers (every `CDN-Cache-Control` variant, such as
  `Vercel-CDN-Cache-Control`, and `Surrogate-Control`) are removed from those
  gated responses too. A shared cache or CDN therefore cannot keep a protected
  page and serve it to a signed-out visitor. The header guarantee holds only
  for the response `next` returns to the gate; a framework that rewrites cache
  headers after the proxy runs is outside it. The downstream router must route
  on the same `Request` URL the gate saw.
- `isPermitted` is required and only the answer `true` permits; a throw or any
  other answer denies. There is no permit-everyone default.
- Every absolute URL in a response comes from `origin`, `siblingOrigins` and
  `protectedResourceMetadata`. The request's host and headers are never read
  into a response, and error bodies and construction errors are fixed strings
  that do not quote a configured value.
- A path with an encoded slash, backslash, dot, percent sign, null or
  semicolon, a literal semicolon, a doubled slash or a non-ASCII character
  (percent-encoded as `%80` and above) is ambiguous. It is never passed
  through as a sign-in sub-route or a public path, so it is gated like any
  other path.
- `signInPath`, `notAuthorizedPath` and each `apiPathPrefixes` entry must be
  plain same-host paths, and the two routes must differ and not overlap the
  metadata path. `signInPath` and `notAuthorizedPath` must not be, or sit
  under, `/api`, `/_next` or an `apiPathPrefixes` entry, because a sign-in
  route is passed to `next` without a sign-in. Otherwise construction throws
  `TypeError`.
- A signed-out navigation whose `Location` would pass 2048 characters returns
  to `/` after sign-in instead of the long path and query.

The `403` and `503` are set on the response `next` returns, so they apply only
when `next` returns the final response. Under a Next.js proxy,
`NextResponse.next()` or a rewrite can discard that status: the not-authorized
page must return its own `403` (for example with `forbidden()`) and the sign-in
page its own `503`, or `next` must render the page itself.

The not-authorized route is matched exactly. With `trailingSlash: true` in the
Next.js config, a request for `/not-authorized/` is a different path to the
gate, so the caller must handle the trailing-slash form of `notAuthorizedPath`
itself, before calling the gate; the gate does not match it.

The sign-in page must run its incoming `redirect_url` through
`createReturnUrlResolver`, which accepts a relative path on `origin` or an
absolute URL on one of `siblingOrigins` and falls back to `/` for everything
else. The gate builds only relative return URLs, so `siblingOrigins` matters
on the sign-in page.

```ts
import { createGatedHostGate, createReturnUrlResolver } from "@clossys/bouncer/gate";

const origin = "https://admin.example.test";
const siblingOrigins = ["https://app.example.test"];

const gate = createGatedHostGate<{ readonly roles: readonly string[] }>({
  origin,
  signInPath: "/sign-in",
  notAuthorizedPath: "/not-authorized",
  siblingOrigins,
  protectedResourceMetadata: { authorization_servers: ["https://idp.example.test"] },
  resolvePrincipal: async () => ({ state: "signed-out" }),
  isPermitted: (principal) => principal.roles.includes("admin"),
  isPublicPath: (pathname) => pathname === "/robots.txt" || pathname === "/health",
});

export const resolveReturn = createReturnUrlResolver({ origin, siblingOrigins });

export function proxy(request: Request): Promise<Response> {
  return gate(request, () => new Response("page"));
}
```

## Sign-in failure classes

A sign-in provider's error text can reveal whether an account exists.
`classifySignInFailure` reads a failure down to one of seven classes, and
`signInFailureCopyId` maps a class to a Writer front-door copy id. The output
is a class or an id and never provider text, so a host shows the copy it owns.
Both are pure and never throw.

| Class | Copy id |
| --- | --- |
| `credential` | `front-door.password.notice`, or `front-door.code.notice` with `{ factor: "code" }` |
| `notFound` | `front-door.identifier-not-found.notice` |
| `rateLimited` | `front-door.rate-limited.notice` |
| `locked` | `front-door.locked.notice` |
| `network`, `unavailable`, `unknown` | `front-door.unavailable.notice` |

`SIGN_IN_FAILURE_CLASSES` lists the seven in that order. The rules, in order:

1. A failure that is not an object is `unknown`.
2. Each `errors[i].code` in turn (the first 16 entries), then `code`: the first one that is an own key
   of `options.codes` wins. A name such as `toString` is never a match.
3. Otherwise status 429 is `rateLimited`, 423 is `locked`, and 500-599 is
   `unavailable`.
4. Anything else is `unknown`, and so is a failure that throws when read. A 404
   is `unknown`: `notFound` comes only from a provider code.

`hideAccountExistence: true` reads `notFound` as `credential` and `locked` as
`rateLimited`, which changes the copy the page shows and nothing else. It does
not stop a visitor learning whether an account exists: some codes, such as
`strategy_for_user_invalid`, `user_banned` and `form_password_pwned` or
`form_password_compromised`, still read as `unknown` while an unknown account
reads `credential`, and the raw Clerk code stays visible in the browser's
devtools. For that guarantee, use Clerk's own enumeration protection. The
default keeps `notFound`.

The Clerk table, `CLERK_SIGN_IN_FAILURE_CODES`, ships from
`./providers/clerk/web` and `./providers/clerk/web/client`. It holds
`form_password_incorrect`, `form_password_or_identifier_incorrect` (the code
Clerk sends with enumeration protection on) and `form_code_incorrect`
(`credential`), `form_identifier_not_found` (`notFound`), `user_locked`
(`locked`) and `clerk_offline` (`network`), each checked against the installed
Clerk packages. Clerk codes not in it read as
`unknown`, or by status when one is set. `humaniseClerkError` returns the
provider's own text, which can name an account; use this path where that text
must not reach the page.

Pass the Clerk table as `codes`:

```ts
import { classifySignInFailure, signInFailureCopyId } from "@clossys/bouncer";
import type { SignInFailureCodeTable } from "@clossys/bouncer";

// `codes` is CLERK_SIGN_IN_FAILURE_CODES for a Clerk sign-in.
export function copyIdForSignInError(error: unknown, codes: SignInFailureCodeTable) {
  const failureClass = classifySignInFailure(error, { codes, hideAccountExistence: true });
  return signInFailureCopyId(failureClass, { factor: "password" });
}
```

## Exports

### Root — `@clossys/bouncer`

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
| `assessUnreconciledGrantRate` | Charter close metric. Returns `UnreconciledGrantRateAssessment` from consumer-supplied independent observations. Not `checkAuthorityReconciliation`. |
| `UnreconciledGrantRateAssessment`, `UnreconciledGrantRateFinding`, `UnreconciledGrantRateState` | Its result shape |
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
| `createSiteSecurityHeaders` | Site security-headers baseline. One call returns the development variant and the production variant |
| `SiteSecurityHeadersInput`, `SiteSecurityHeadersVariants`, `SiteSecurityHeadersResult`, `SiteSecurityHeaders`, `SiteSecurityHeaderWarning` | Its input, the two variants, the acceptance-or-refusal result, the header map, and the static-mode warning |
| `GATED_HOST_ROBOTS_TAG`, `GATED_HOST_ROBOTS_TXT` | The robots tag value and the deny-all `robots.txt` body of a gated host |
| `applyGatedHostHeaders`, `createRobotsTxtRoute`, `createHealthRoute`, `createServiceUnavailableResponse` | Gated-host response helpers: robots tag, `no-store`, deny-all `robots.txt`, `/health`, and a 503 with `Retry-After` |
| `GatedHostHeaderOptions`, `ServiceUnavailableOptions` | Their option types |
| `SIGN_IN_FAILURE_CLASSES`, `classifySignInFailure`, `signInFailureCopyId` | Sign-in failure classes and their Writer copy ids. Never provider text |
| `SignInFailureClass`, `SignInFailureShape`, `SignInFailureCodeTable`, `SignInFailureCopyId`, `ClassifySignInFailureOptions`, `SignInFailureCopyIdOptions` | Their types |

### `./agent`

Delegated machine-actor authority. Provider-neutral, framework-neutral, and the
subpath `delegation-ceiling` reads records for.

`assertAgentCanCall`, `assertAgentMonetaryAuthority`,
`describeAgentLifecycleState`, `isAgentContextActive`,
`AgentAuthorizationError`, and the types `GenericAgentContext`,
`AgentLifecycleState`, `AgentAuthorizationFailureReason`,
`BaseAgentAuditRecord`, `IsoDateTime`.

### `./gate`

One opt-in gate contract for gated application hosts. Framework-neutral and
provider-neutral; see "Gated-host gate" above for its behavior.

`createGatedHostGate`, `createReturnUrlResolver`, `isNavigationRequest`,
`PROTECTED_RESOURCE_METADATA_PATH`, and the types `GatedHostGate`,
`GatedHostGateOptions`, `GatedHostNext`, `GatePrincipalState`,
`ProtectedResourceMetadata`, `ReturnUrlResolverOptions`.

### `./providers/clerk` and its subpaths

Every provider adapter is isolated behind its own subpath, and the root never
imports one. The Clerk adapter ships as `./providers/clerk` (event mapping and
webhook verification) plus `./providers/clerk/web`,
`./providers/clerk/web/client`, `./providers/clerk/web/server`, and
`./providers/clerk/web/proxy`, split so importing the edge-safe proxy entry
never pulls `next/headers`, `next/navigation`, React, or client components.

#### Webhook verification contract

`verifyClerkWebhook` and `verifyAndMapClerkWebhook` check in a fixed order:
signing secret, then headers, then signature, then JSON parse, then event
shape. Each refusal throws `ClerkWebhookSignatureError` with a `code`; the
code is the vocabulary, and the status is what a route handler should answer:

| `code` | Stage | Status |
| --- | --- | --- |
| `signing-secret-invalid` | signing secret | 503 |
| `signature-headers-missing` | headers | 400 |
| `signature-invalid` | signature | 401 |
| `payload-invalid` | parse or shape | 400 |

`signing-secret-invalid` is a server misconfiguration, not a bad delivery, so
it is a 503 and is raised before the body or headers are looked at. The
messages are fixed text: no error carries the secret, a header value, or any
body text, and none sets a `cause`. `payload-invalid` means the signature
matched but the body is not JSON or is not a plain object (a signed `null`,
array or scalar); an unsigned body is always `signature-invalid`. Any other
throw is not part of this contract: let it reach the route's own 500
`internal_error` response rather than mapping it to one of these codes.

`assertClerkWebhookSigningSecret(signingSecret)` is exported so a route can
check its configured secret at startup or per request. A string is trimmed
once, may start with the optional prefix, and the rest must be strict base64
decoding to at least 16 bytes; a `Uint8Array` must be at least 16 bytes.
Call the guard before reading the body, so a misconfigured secret answers 503
without consuming the request.

`./providers/clerk` (guards `svix`) and `./providers/clerk/web/server`
(guards both `@clerk/nextjs` and `next`) each guard every optional peer they
import with `assertPeerVersion`, evaluated once at import time, checking the
installed version against this package's declared range.
`./providers/clerk/web` and its `/client` subpath guard `react` the same
way, but do NOT range-check `@clerk/nextjs`: that peer's own `exports` map
declares no `./package.json` subpath and its public surface exports no
version constant of any kind, so there is no signal a browser-safe module
can read without `node:fs` (which cannot resolve in a browser bundle at
all). `./providers/clerk/web/proxy` guards `next` the same way `server`
does — `next` declares no `exports` field at all, so its `package.json` is
readable as an ordinary JSON import, with no `node:fs` involved — but for
the identical reason, does not range-check `@clerk/nextjs` either: an Edge
Middleware bundle has no filesystem, the same constraint as the browser
side. See `client.tsx`'s and `proxy.ts`'s own doc comments for the exact,
checked shape of this — every subpath either range-guards a peer it
imports or is a named, tested exception, confirmed by this package's own
internal build-graph coverage test (not part of the published package);
nothing is silently uncovered.

Every entry point still guards each optional peer's PRESENCE, range-checked
or not: the unconditional import throws Node's own named
`ERR_MODULE_NOT_FOUND` if the peer is not installed at all, before this
package's own code ever runs — that case never reaches `assertPeerVersion`'s
own "not installed" message, because every call site sits behind a static
ESM import, and an absent package fails module resolution first. What `assertPeerVersion` covers, where it runs, is
specifically the installed-but-incompatible case: a version that resolves
but falls outside this package's declared range gets a named, actionable
error instead of whatever the peer's own call surface happened to crash on.
An installed version this guard cannot parse at all is treated as
indeterminate and warns rather than blocking a build.

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

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/bouncer.md), kept in the public repository rather than in the installed package.
