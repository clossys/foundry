# @vespeneventures/auth

One ESM package for authorization primitives, delegated-agent guards, and
optional Clerk adapters. Import only the subpath your application uses: the
provider-neutral root and agent modules do not load Clerk, React, Next.js, or
server-only webhook code.

```bash
npm install @vespeneventures/auth
```

For the Clerk web adapter, install its framework peers in the consuming
application:

```bash
npm install @vespeneventures/auth @clerk/nextjs next react react-dom
```

## Imports

| Import | Use |
| --- | --- |
| `@vespeneventures/auth` | Provider-neutral roles, sessions, membership reconciliation, and safe redirect policy. |
| `@vespeneventures/auth/agent` | Delegated-agent lifecycle, tool-scope, and monetary-authority guards. |
| `@vespeneventures/auth/providers/clerk` | Server-side raw-body webhook verification and minimal lifecycle mapping. |
| `@vespeneventures/auth/providers/clerk/web` | Client-safe Clerk provider and sign-in exports. |
| `@vespeneventures/auth/providers/clerk/web/client` | Explicit client-safe alias for the Clerk web exports. |
| `@vespeneventures/auth/providers/clerk/web/proxy` | Edge-safe Next.js middleware and route-protection helpers. |
| `@vespeneventures/auth/providers/clerk/web/server` | Route/page-only sign-in, redirect, and sign-out helpers. |

Provider adapters are isolated under `providers/<name>` so later providers can
use the same package without changing root imports. Persistence, personas,
token issuance, and product authorization policy remain application-owned.

## Provider-neutral authorization

```ts
import { defineRoleHierarchy, viewerHasAccess } from "@vespeneventures/auth";

const roles = defineRoleHierarchy(["viewer", "editor", "owner"]);
const mayEdit = viewerHasAccess({ subjectId: "user-42", role: "editor" }, "editor", roles);
```

Unknown or missing roles fail closed. `isAuthorized` authorizes only a literal
`true` returned by the application's predicate and denies malformed, absent,
or expired sessions.

For external membership events, normalize the provider payload and reconcile
it inside the consumer's transaction:

```ts
import { reconcileExternalMembership } from "@vespeneventures/auth";

const result = await reconcileExternalMembership({
  queryAdapter,
  repository,
  event: {
    eventId: "evt-42",
    type: "updated",
    provider: "identity-service",
    providerMembershipId: "membership-42",
    role: "editor",
    occurredAt: "2026-08-11T12:00:00.000Z",
    version: 8,
  },
});
```

The repository takes a transaction-scoped lock for each external identity,
including an identity without a membership row. It claims delivery IDs,
retains ordering cursors after deletion, makes retries idempotent, and only
allows an `updated` provider event to replace an existing role. Caller-owned
fields on a stored membership are preserved.

For post-auth navigation, use a fixed allowlist:

```ts
import { createAllowedOriginPolicy, resolveSafeRedirect } from "@vespeneventures/auth";

const policy = createAllowedOriginPolicy(["https://app.example.test"]);
const destination = resolveSafeRedirect("/settings", policy, "https://app.example.test");
```

`resolveSafeRedirect` rejects malformed, cross-origin, protocol-relative,
backslash, non-HTTP(S), and credential-bearing targets. Relative paths require
an explicit allowed base origin.

## Delegated agents

```ts
import { assertAgentCanCall, assertAgentMonetaryAuthority } from "@vespeneventures/auth/agent";

assertAgentCanCall(context, "billing.create", new Date());
assertAgentMonetaryAuthority(context, 500, "USD", "billing.create", new Date());
```

Both guards fail closed. The monetary guard first enforces lifecycle and tool
scope, including when no monetary limit is configured.

## Clerk adapters

Use the provider server subpath only in a webhook handler after obtaining the
raw request body and headers:

```ts
import { verifyAndMapClerkWebhook } from "@vespeneventures/auth/providers/clerk";

const mapped = await verifyAndMapClerkWebhook(rawBody, headers, signingSecret, {
  roleMapper: ({ providerRole }) => providerRole,
});
```

Verification happens before mapping. The mapped event retains only the fields
needed for lifecycle or membership reconciliation; raw bodies, headers,
profile fields, metadata, and signing material are not returned.
In a Fetch/Next.js route, pass `request.headers` directly and obtain `rawBody`
with `await request.text()` exactly once; do not parse and reserialize it before
verification.

In a Next.js client boundary:

```tsx
import { AuthProvider } from "@vespeneventures/auth/providers/clerk/web/client";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```

Use `@vespeneventures/auth/providers/clerk/web/proxy` in Next.js middleware.
Use `@vespeneventures/auth/providers/clerk/web/server` for route/page helpers.
The sign-out route applies strict redirect handling and requires a
same-origin `POST` before revoking an active session.

For local development only, `NEXT_PUBLIC_DEV_NO_AUTH=1` bypasses Clerk when
`NODE_ENV` is exactly `development`. It is ignored in tests, previews, and
production, and should never be configured for a deployed environment.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `QueryAdapter` | type | Minimal SQL query capability supplied to repository operations; repositories retain result typing. |
| `TransactionalQueryAdapter` | type | A `QueryAdapter` with `transaction` for atomic units of work. |
| `WithTransactionQueryAdapter` | type | A `QueryAdapter` using the common `withTransaction` pool spelling; normalized automatically. |
| `isQueryAdapter(value)` | function | Runtime `QueryAdapter` compatibility guard. |
| `isTransactionalQueryAdapter(value)` | function | Runtime transaction-capability guard. |
| `requireTransactionalQueryAdapter(value)` | function | Returns a compatible adapter or throws before repository work begins. |
| `RoleHierarchy` | type | Ordered, closed set of application-defined roles. |
| `Viewer` | type | Provider-neutral subject and optional role. |
| `defineRoleHierarchy(roles)` | function | Validates and freezes a hierarchy from least to most privileged. |
| `getRoleRank(role, hierarchy)` | function | Returns a configured role's rank or `undefined`. |
| `isKnownRole(role, hierarchy)` | function | Checks membership in the configured role set. |
| `hasRoleAtLeast(role, requiredRole, hierarchy)` | function | Compares configured roles and fails closed for missing or unknown roles. |
| `resolveViewerRole(viewer, hierarchy)` | function | Returns a viewer role only when configured. |
| `viewerHasAccess(viewer, requiredRole, hierarchy)` | function | Evaluates a viewer's minimum-role access. |
| `Session` | type | Framework-neutral session data. |
| `SessionResolver` | type | Resolves a session from application-owned context. |
| `AuthorizationPredicate` | type | Application-defined authorization decision seam. |
| `isAuthorized(predicate, session, context)` | function | Authorizes only a literal successful predicate result. |
| `ExternalMembershipIdentity` | type | Immutable provider and membership identity. |
| `ExternalMembership` | type | Stored provider membership with caller-extensible local fields. |
| `ExternalMembershipEvent` | type | Normalized created, updated, or deleted provider event. |
| `ExternalMembershipEventClaim` | type | Provider-namespaced delivery identity used for retries. |
| `ExternalMembershipEventCursor` | type | Per-identity ordering state retained independently of a row. |
| `ExternalMembershipCreateInput` | type | Repository input for locally owned membership fields. |
| `ExternalMembershipRepository` | type | Transaction-scoped persistence seam. |
| `ReconcileExternalMembershipCommand` | type | Dependencies and event for one reconciliation. |
| `ExternalMembershipReconciliationResult` | type | Status and optional membership from reconciliation. |
| `reconcileExternalMembership(command)` | function | Atomically reconciles a normalized provider event. |
| `AllowedOriginPolicy` | type | Strict validated set of allowed origins. |
| `createAllowedOriginPolicy(origins)` | function | Creates a policy from absolute HTTP(S) origins. |
| `isAllowedOrigin(origin, policy)` | function | Tests a URL against a policy. |
| `resolveSafeRedirect(target, policy, baseOrigin?)` | function | Resolves an allowed destination or returns `undefined`. |

## Requirements

Node 20+ and ESM. The root and `/agent` subpaths have no framework or provider
runtime dependency. The Clerk webhook adapter depends on `svix`; the Clerk web
subpaths require the listed optional peers in the consuming application.

## Licence

MIT
