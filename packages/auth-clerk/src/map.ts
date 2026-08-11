import type {
  ClerkEventMapping,
  ClerkEventMappingOptions,
  ClerkLifecycleType,
  ClerkLocalIdResolution,
  ClerkLocalIdResolver,
  ClerkMembershipEvent,
  ClerkNormalizedEvent,
  ClerkRoleMappingInput,
  ClerkWebhookFinding,
} from "./types.js";

type RecordValue = Record<string, unknown>;

const lifecycleByEventName: Readonly<Record<string, { kind: "user" | "organization" | "membership"; type: ClerkLifecycleType }>> = {
  "user.created": { kind: "user", type: "created" },
  "user.updated": { kind: "user", type: "updated" },
  "user.deleted": { kind: "user", type: "deleted" },
  "organization.created": { kind: "organization", type: "created" },
  "organization.updated": { kind: "organization", type: "updated" },
  "organization.deleted": { kind: "organization", type: "deleted" },
  "organizationMembership.created": { kind: "membership", type: "created" },
  "organizationMembership.updated": { kind: "membership", type: "updated" },
  "organizationMembership.deleted": { kind: "membership", type: "deleted" },
  // Earlier webhook spellings are accepted explicitly; no fuzzy matching is
  // used, so unrelated event names remain ignored.
  "organization_membership.created": { kind: "membership", type: "created" },
  "organization_membership.updated": { kind: "membership", type: "updated" },
  "organization_membership.deleted": { kind: "membership", type: "deleted" },
};

function finding(code: ClerkWebhookFinding["code"], message: string, path?: string): ClerkEventMapping {
  return { status: "invalid", findings: [{ code, message, ...(path ? { path } : {}) }] };
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstRequiredString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = requiredString(value);
    if (found) return found;
  }
  return undefined;
}

function occurredAtFrom(value: unknown): string | undefined {
  let date: Date;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Current Clerk event timestamps are milliseconds. Supporting seconds is
    // safe for explicitly supplied values and keeps the cursor chronological.
    date = new Date(Math.abs(value) < 100_000_000_000 ? value * 1_000 : value);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  } else {
    return undefined;
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function membershipFields(data: RecordValue):
  | { providerMembershipId: string; providerUserId: string; providerTenantId: string; providerRole?: string }
  | ClerkEventMapping {
  const publicUserData = isRecord(data.public_user_data)
    ? data.public_user_data
    : isRecord(data.publicUserData)
      ? data.publicUserData
      : undefined;
  const organization = isRecord(data.organization) ? data.organization : undefined;

  const providerMembershipId = firstRequiredString(data.id, data.membership_id, data.membershipId);
  if (!providerMembershipId) {
    return finding("provider-membership-id-missing", "A recognized membership event has no provider membership id.", "data.id");
  }

  const providerUserId = firstRequiredString(
    publicUserData?.user_id,
    publicUserData?.userId,
    data.user_id,
    data.userId,
  );
  if (!providerUserId) {
    return finding("provider-user-id-missing", "A recognized membership event has no provider user id.", "data.public_user_data.user_id");
  }

  const providerTenantId = firstRequiredString(
    organization?.id,
    data.organization_id,
    data.organizationId,
  );
  if (!providerTenantId) {
    return finding(
      "provider-organization-id-missing",
      "A recognized membership event has no provider organization id.",
      "data.organization.id",
    );
  }

  return {
    providerMembershipId,
    providerUserId,
    providerTenantId,
    providerRole: requiredString(data.role),
  };
}

function isMapping(value: ClerkEventMapping | { providerMembershipId: string; providerUserId: string; providerTenantId: string; providerRole?: string }): value is ClerkEventMapping {
  return "status" in value;
}

/** Resolves the local identifiers for an already-safe membership event. */
export async function resolveClerkMembershipLocalIds(
  event: ClerkMembershipEvent,
  resolver: ClerkLocalIdResolver,
): Promise<ClerkLocalIdResolution> {
  let userId: string | undefined;
  let tenantId: string | undefined;
  try {
    [userId, tenantId] = await Promise.all([
      resolver.resolveUserId(event.providerUserId),
      resolver.resolveTenantId(event.providerTenantId),
    ]);
  } catch {
    return {
      status: "invalid",
      findings: [
        {
          code: "local-id-resolution-failed",
          message: "The local identifier resolver could not resolve the membership identifiers.",
        },
      ],
    };
  }

  const resolvedUserId = requiredString(userId);
  if (!resolvedUserId) {
    return {
      status: "invalid",
      findings: [{ code: "local-user-id-unresolved", message: "No local user id was resolved for the provider user id." }],
    };
  }
  const resolvedTenantId = requiredString(tenantId);
  if (!resolvedTenantId) {
    return {
      status: "invalid",
      findings: [{ code: "local-tenant-id-unresolved", message: "No local tenant id was resolved for the provider organization id." }],
    };
  }
  return { status: "resolved", localIds: { userId: resolvedUserId, tenantId: resolvedTenantId } };
}

/**
 * Maps a parsed Clerk event into an intentionally minimal lifecycle event.
 * Recognized malformed events produce findings; unrecognized event names are
 * ignored without preserving their input data.
 */
export async function mapClerkEvent(event: unknown, options: ClerkEventMappingOptions): Promise<ClerkEventMapping> {
  if (!isRecord(event)) {
    return finding("event-shape-invalid", "The Clerk event must be an object.");
  }

  const rawEventType = event.type;
  if (typeof rawEventType !== "string" || !rawEventType.trim()) {
    return finding("event-type-missing", "The Clerk event has no event type.", "type");
  }
  const lifecycle = lifecycleByEventName[rawEventType];
  if (!lifecycle) return { status: "ignored" };

  const eventId = requiredString(options.eventId);
  if (!eventId) return finding("event-id-missing", "A recognized Clerk event requires a trusted event id.");

  const occurredAt = occurredAtFrom(event.timestamp);
  if (!occurredAt) {
    return finding("event-timestamp-invalid", "A recognized Clerk event requires a valid timestamp cursor.", "timestamp");
  }

  if (!isRecord(event.data)) {
    return finding("event-data-missing", "A recognized Clerk event requires an object data payload.", "data");
  }
  const data = event.data;

  if (lifecycle.kind === "user") {
    const providerUserId = requiredString(data.id);
    if (!providerUserId) {
      return finding("provider-user-id-missing", "A recognized user event has no provider user id.", "data.id");
    }
    return {
      status: "mapped",
      event: { kind: "user", type: lifecycle.type, provider: "clerk", providerUserId, eventId, occurredAt },
    };
  }

  if (lifecycle.kind === "organization") {
    const providerOrganizationId = requiredString(data.id);
    if (!providerOrganizationId) {
      return finding("provider-organization-id-missing", "A recognized organization event has no provider organization id.", "data.id");
    }
    return {
      status: "mapped",
      event: { kind: "organization", type: lifecycle.type, provider: "clerk", providerOrganizationId, eventId, occurredAt },
    };
  }

  const fields = membershipFields(data);
  if (isMapping(fields)) return fields;

  let role: string | undefined;
  if (lifecycle.type !== "deleted" && !fields.providerRole) {
    return finding("membership-role-missing", "A created or updated membership event requires a provider role.", "data.role");
  }
  if (lifecycle.type !== "deleted" && fields.providerRole) {
    const roleInput: ClerkRoleMappingInput = { ...fields, providerRole: fields.providerRole, type: lifecycle.type };
    try {
      role = await options.roleMapper(roleInput);
    } catch {
      return finding("role-mapping-failed", "The configured role mapper failed for a membership event.");
    }
    if (!requiredString(role)) {
      return finding("membership-role-unmapped", "The provider membership role has no mapped product role.", "data.role");
    }
  }

  const membershipEvent: ClerkMembershipEvent = {
    kind: "membership",
    type: lifecycle.type,
    provider: "clerk",
    providerMembershipId: fields.providerMembershipId,
    providerUserId: fields.providerUserId,
    providerTenantId: fields.providerTenantId,
    eventId,
    occurredAt,
    ...(role ? { role } : {}),
  } as ClerkMembershipEvent;

  // Deletion is fully identified by the provider membership id. Requiring
  // user or tenant lookups here could retain access when related mappings were
  // removed before an out-of-order deletion arrived.
  if (lifecycle.type === "deleted" || !options.localIdResolver) {
    return { status: "mapped", event: membershipEvent };
  }

  const resolution = await resolveClerkMembershipLocalIds(membershipEvent, options.localIdResolver);
  if (resolution.status === "invalid") return resolution;

  const normalizedEvent: ClerkNormalizedEvent = { ...membershipEvent, localIds: resolution.localIds };
  return { status: "mapped", event: normalizedEvent };
}
