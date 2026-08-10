# @vespeneventures/auth

Small TypeScript primitives for applications that need provider-neutral
authorization, external-membership reconciliation, and safe redirect handling.
It does not select an identity provider, web framework, database, or role set.

```bash
npm install @vespeneventures/auth
```

## Usage

Define the application's closed role hierarchy and evaluate a viewer without
treating an unfamiliar role as privileged:

```ts
import { defineRoleHierarchy, viewerHasAccess } from "@vespeneventures/auth";

const roles = defineRoleHierarchy(["viewer", "editor", "owner"]);
const mayEdit = viewerHasAccess({ subjectId: "user-42", role: "editor" }, "editor", roles);
```

For provider events, normalize the provider's payload into an
`ExternalMembershipEvent`, supply an `ExternalMembershipRepository`, and call
`reconcileExternalMembership`. The `QueryAdapter` must also implement
`TransactionalQueryAdapter`; `isTransactionalQueryAdapter` and
`requireTransactionalQueryAdapter` expose that compatibility check.

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
    occurredAt: "2026-08-10T12:00:00.000Z",
    version: 8,
  },
});
```

`created` events add a previously absent provider identity but never replace an
existing role. Only `updated` events replace that role. The core copies the
stored record when updating it, retaining `membershipId`, `createdAt`,
`invitedAt`, `acceptedAt`, `grants`, and any caller-owned fields. A repository
keeps event claims and `ExternalMembershipEventCursor` values transactionally;
that makes retries, out-of-order events, and deleted rows safe to handle.

For post-auth redirects, create the allowlist once and resolve only destinations
that meet it:

```ts
import { createAllowedOriginPolicy, resolveSafeRedirect } from "@vespeneventures/auth";

const policy = createAllowedOriginPolicy(["https://app.example.test"]);
const destination = resolveSafeRedirect("/settings", policy, "https://app.example.test");
// destination is "https://app.example.test/settings" or undefined.
```

`resolveSafeRedirect` rejects malformed, cross-origin, protocol-relative,
backslash, non-HTTP(S), and credential-bearing targets. Relative paths require
an explicit, allowlisted `baseOrigin`.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `QueryAdapter` | type | Minimal generic query contract supplied to repository operations. |
| `TransactionalQueryAdapter` | type | A `QueryAdapter` with `transaction` for atomic units of work. |
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
| `isAuthorized(predicate, session, context)` | function | Denies missing, malformed, expired, or failed sessions before returning an authorization decision. |
| `ExternalMembershipIdentity` | type | Immutable `provider` plus `providerMembershipId` identity. |
| `ExternalMembership` | type | Stored provider membership with caller-extensible local fields. |
| `ExternalMembershipEvent` | type | Normalized `created`, `updated`, or `deleted` provider event. |
| `ExternalMembershipEventCursor` | type | Per-identity ordering state retained independently of a row. |
| `ExternalMembershipCreateInput` | type | Repository input for creating locally owned membership fields. |
| `ExternalMembershipRepository` | type | Transaction-scoped persistence seam for claims, membership records, and cursors. |
| `ReconcileExternalMembershipCommand` | type | Dependencies and event for one reconciliation. |
| `ExternalMembershipReconciliationResult` | type | Status and optional membership returned by reconciliation. |
| `reconcileExternalMembership(command)` | function | Atomically reconciles a normalized provider event. |
| `AllowedOriginPolicy` | type | Strict, validated set of allowed origins. |
| `createAllowedOriginPolicy(origins)` | function | Creates a policy from absolute HTTP(S) origins. |
| `isAllowedOrigin(origin, policy)` | function | Tests an HTTP(S), credential-free URL against a policy. |
| `resolveSafeRedirect(target, policy, baseOrigin?)` | function | Resolves an allowed destination or returns `undefined`. |

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
