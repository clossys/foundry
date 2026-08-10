# @vespeneventures/auth-clerk

`@vespeneventures/auth-clerk` verifies Clerk webhook deliveries with Svix and
maps the supported lifecycle events into small, deterministic values. It keeps
only the identifiers and ordering facts needed by a reconciliation boundary.
It never copies addresses, names, profile fields, metadata, the raw body,
signature headers, or the signing secret into a normalized event.

```bash
npm install @vespeneventures/auth-clerk
```

## Requirements

- Node.js 20 or later.
- A Clerk webhook signing secret.
- `@vespeneventures/auth` version compatible with `~0.1.0`.

Pass the exact raw request body to `verifyAndMapClerkWebhook`. Do not parse and
serialize the body first: signature verification must operate on the received
bytes.

## Usage

```ts
import { verifyAndMapClerkWebhook } from "@vespeneventures/auth-clerk";

const mapping = await verifyAndMapClerkWebhook(rawBody, requestHeaders, signingSecret, {
  roleMapper: ({ providerRole }) => {
    if (providerRole === "source:manager") return "manager";
    return undefined;
  },
  localIdResolver: {
    resolveUserId: async (providerUserId) => findLocalUserId(providerUserId),
    resolveTenantId: async (providerTenantId) => findLocalTenantId(providerTenantId),
  },
});

if (mapping.status === "invalid") {
  // Report mapping.findings without recording the webhook body.
} else if (mapping.status === "mapped" && mapping.event.kind === "membership") {
  // Pass mapping.event to your reconciliation boundary.
}
```

`roleMapper` is required. It is the consumer's explicit translation from a
provider role to a product role; this package does not define product roles.
`localIdResolver` is optional. When supplied, mapped membership events include
the consumer's `localIds`; an unsuccessful lookup produces an explicit finding.

## Supported events

| Clerk event | Normalized `kind` | Normalized `type` |
| --- | --- | --- |
| `user.created`, `user.updated`, `user.deleted` | `user` | `created`, `updated`, `deleted` |
| `organization.created`, `organization.updated`, `organization.deleted` | `organization` | `created`, `updated`, `deleted` |
| `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted` | `membership` | `created`, `updated`, `deleted` |

The explicit `organization_membership.*` aliases are accepted for compatibility.
Any other event name returns `{ status: "ignored" }` and no input data.

For membership creation and updates, the mapper requires a provider membership
id, provider user id, provider organization id, mapped role, delivery event id,
and event timestamp. Deletions retain the same identifiers and ordering facts;
their role is optional because it is no longer needed to replace a role.

## API

| Export | Description |
| --- | --- |
| `mapClerkEvent` | Maps a parsed event using a trusted event id. |
| `resolveClerkMembershipLocalIds` | Resolves consumer-owned identifiers for a `ClerkMembershipEvent`. |
| `verifyAndMapClerkWebhook` | Verifies raw bytes and then calls `mapClerkEvent`. |
| `verifyClerkWebhook` | Verifies raw bytes and returns a `VerifiedClerkWebhook`. |
| `ClerkWebhookSignatureError` | Typed error for missing or invalid signature material. |
| `ClerkEventMapping` | Result union for mapped, ignored, and invalid events. |
| `ClerkEventMappingOptions` | Direct mapping configuration. |
| `ClerkLifecycleEventName` | Supported Clerk event-name union. |
| `ClerkLifecycleType` | Normalized lifecycle operation union. |
| `ClerkLocalIdResolution` | Result union for a local-id lookup. |
| `ClerkLocalIdResolver` | Consumer-owned local-id resolver interface. |
| `ClerkMembershipEvent` | `ExternalMembershipEvent` enriched with Clerk provider identifiers. |
| `ClerkNormalizedEvent` | Any successful normalized event. |
| `ClerkOrganizationEvent` | Normalized organization lifecycle event. |
| `ClerkResolvedMembershipEvent` | Membership event with resolved `localIds`. |
| `ClerkRoleMapper` | Provider-role to product-role mapper type. |
| `ClerkRoleMappingInput` | Input supplied to `ClerkRoleMapper`. |
| `ClerkUserEvent` | Normalized user lifecycle event. |
| `ClerkVerifiedEventMappingOptions` | Verification-and-mapping configuration. |
| `ClerkWebhookFinding` | Explicit malformed-event finding. |
| `ClerkWebhookHeaders` | Accepted HTTP header record. |
| `ClerkWebhookRawBody` | Exact raw-body input type. |
| `VerifiedClerkWebhook` | Verified parsed event without raw delivery material. |

## Failure behavior

`verifyClerkWebhook` and `verifyAndMapClerkWebhook` throw
`ClerkWebhookSignatureError` when the required Svix headers are absent or the
signature is invalid. Known lifecycle events that are malformed return
`{ status: "invalid", findings }`; they are never treated as ignored.

## License

MIT
