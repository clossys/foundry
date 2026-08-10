import type { ExternalMembershipEvent } from "@vespeneventures/auth";

/** The Clerk event names understood by this package. */
export type ClerkLifecycleEventName =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organizationMembership.created"
  | "organizationMembership.updated"
  | "organizationMembership.deleted";

/** A lifecycle operation, normalized independently of Clerk's event-name spelling. */
export type ClerkLifecycleType = "created" | "updated" | "deleted";

/** An explicit finding for a recognized event that cannot be safely mapped. */
export interface ClerkWebhookFinding {
  code:
    | "event-shape-invalid"
    | "event-type-missing"
    | "event-id-missing"
    | "event-timestamp-invalid"
    | "event-data-missing"
    | "provider-user-id-missing"
    | "provider-organization-id-missing"
    | "provider-membership-id-missing"
    | "membership-role-missing"
    | "membership-role-unmapped"
    | "role-mapping-failed"
    | "local-user-id-unresolved"
    | "local-tenant-id-unresolved"
    | "local-id-resolution-failed";
  message: string;
  path?: string;
}

/** The only fields retained for a Clerk user lifecycle event. */
export interface ClerkUserEvent {
  kind: "user";
  type: ClerkLifecycleType;
  provider: "clerk";
  providerUserId: string;
  eventId: string;
  occurredAt: string;
}

/** The only fields retained for a Clerk organization lifecycle event. */
export interface ClerkOrganizationEvent {
  kind: "organization";
  type: ClerkLifecycleType;
  provider: "clerk";
  providerOrganizationId: string;
  eventId: string;
  occurredAt: string;
}

/**
 * A provider membership event ready for the auth package's reconciliation
 * boundary. `providerUserId` and `providerTenantId` deliberately remain
 * provider identifiers so a consumer can resolve its own local identifiers.
 */
export type ClerkMembershipEvent =
  | (ExternalMembershipEvent & {
      kind: "membership";
      type: "created" | "updated";
      provider: "clerk";
      providerMembershipId: string;
      providerUserId: string;
      providerTenantId: string;
      role: string;
      eventId: string;
      occurredAt: string;
    })
  | (ExternalMembershipEvent & {
      kind: "membership";
      type: "deleted";
      provider: "clerk";
      providerMembershipId: string;
      providerUserId: string;
      providerTenantId: string;
      role?: string;
      eventId: string;
      occurredAt: string;
    });

/** A membership event after an optional consumer-owned local-id lookup. */
export type ClerkResolvedMembershipEvent = ClerkMembershipEvent & {
  localIds: {
    userId: string;
    tenantId: string;
  };
};

/** The normalized event forms returned by a successful mapping. */
export type ClerkNormalizedEvent = ClerkUserEvent | ClerkOrganizationEvent | ClerkMembershipEvent | ClerkResolvedMembershipEvent;

/** The result of attempting to map a Clerk event. */
export type ClerkEventMapping =
  | { status: "mapped"; event: ClerkNormalizedEvent }
  | { status: "ignored" }
  | { status: "invalid"; findings: readonly ClerkWebhookFinding[] };

/** Details supplied to a product-owned role mapper. */
export interface ClerkRoleMappingInput {
  providerRole: string;
  type: "created" | "updated" | "deleted";
  providerMembershipId: string;
  providerUserId: string;
  providerTenantId: string;
}

/** Maps a provider role to a product-owned role without imposing a role vocabulary. */
export type ClerkRoleMapper = (input: ClerkRoleMappingInput) => string | undefined | Promise<string | undefined>;

/** Resolves provider identifiers through a consumer-owned local identity store. */
export interface ClerkLocalIdResolver {
  resolveUserId(providerUserId: string): string | undefined | Promise<string | undefined>;
  resolveTenantId(providerTenantId: string): string | undefined | Promise<string | undefined>;
}

/** Configuration for direct event mapping. */
export interface ClerkEventMappingOptions {
  /** A trusted delivery identifier, normally the verified `svix-id` header. */
  eventId: string;
  roleMapper: ClerkRoleMapper;
  /** When supplied, resolve local identifiers before returning membership events. */
  localIdResolver?: ClerkLocalIdResolver;
}

/** Configuration for verification followed by mapping. */
export type ClerkVerifiedEventMappingOptions = Omit<ClerkEventMappingOptions, "eventId">;

/** A successful local-id lookup. */
export type ClerkLocalIdResolution =
  | { status: "resolved"; localIds: { userId: string; tenantId: string } }
  | { status: "invalid"; findings: readonly ClerkWebhookFinding[] };

/** A verified parsed event without raw body, headers, or signing material. */
export interface VerifiedClerkWebhook {
  eventId: string;
  event: unknown;
}

/** A raw body accepted by the Svix verifier without reparsing or reserializing it. */
export type ClerkWebhookRawBody = string | Uint8Array;

/** Header input from an HTTP framework. Header names are matched case-insensitively. */
export type ClerkWebhookHeaders = Readonly<Record<string, string | undefined>>;
