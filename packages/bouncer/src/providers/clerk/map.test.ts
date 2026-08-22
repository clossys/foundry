/**
 * The adapter's mapping: one provider's event vocabulary reduced to the
 * minimal, provider-neutral lifecycle events the root of this package
 * understands.
 *
 * This is the file `bouncer-check provider-contract` exists to protect. The
 * mapping below is a set of assumptions about a shape this package does not
 * own and cannot version — every field read, every event name recognised, and
 * every one deliberately ignored. When the provider's declared shape moves,
 * nothing here fails on its own: the adapter goes on reading a field that is
 * no longer there and reports a clean `{ status: "ignored" }`. That is the
 * exact silence `checkProviderContract` in `../../contract.ts` is built to
 * break.
 */
import { describe, expect, it, vi } from "vitest";
import { mapClerkEvent, resolveClerkMembershipLocalIds } from "./index.js";
import type { ClerkEventMappingOptions, ClerkMembershipEvent } from "./index.js";

const mappingOptions: ClerkEventMappingOptions = {
  eventId: "msg_synthetic",
  roleMapper: ({ providerRole }) => (providerRole === "source:manager" ? "manager" : undefined),
};

function membershipData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "membership_synthetic",
    role: "source:manager",
    public_user_data: { user_id: "user_synthetic" },
    organization: { id: "organization_synthetic" },
    ...overrides,
  };
}

describe("mapClerkEvent", () => {
  it.each(["created", "updated", "deleted"] as const)("maps user.%s without profile fields", async (type) => {
    const result = await mapClerkEvent(
      {
        type: `user.${type}`,
        timestamp: 1_786_313_600_000,
        data: {
          id: "user_synthetic",
          email_addresses: [{ email_address: "not-retained@example.test" }],
          first_name: "Not Retained",
          private_metadata: { secret_marker: "not-retained-private" },
          public_metadata: { marker: "not-retained-public" },
        },
      },
      mappingOptions,
    );

    expect(result).toEqual({
      status: "mapped",
      event: {
        kind: "user",
        type,
        provider: "clerk",
        providerUserId: "user_synthetic",
        eventId: "msg_synthetic",
        occurredAt: "2026-08-09T22:13:20.000Z",
      },
    });
    const normalized = JSON.stringify(result);
    expect(normalized).not.toContain("not-retained@example.test");
    expect(normalized).not.toContain("not-retained-private");
    expect(normalized).not.toContain("not-retained-public");
  });

  it.each(["created", "updated", "deleted"] as const)("maps organization.%s", async (type) => {
    const result = await mapClerkEvent(
      { type: `organization.${type}`, timestamp: "2026-08-10T13:20:00.000Z", data: { id: "organization_synthetic", name: "not retained" } },
      mappingOptions,
    );

    expect(result).toEqual({
      status: "mapped",
      event: {
        kind: "organization",
        type,
        provider: "clerk",
        providerOrganizationId: "organization_synthetic",
        eventId: "msg_synthetic",
        occurredAt: "2026-08-10T13:20:00.000Z",
      },
    });
  });

  it.each(["created", "updated", "deleted"] as const)("maps current organizationMembership.%s events", async (type) => {
    const result = await mapClerkEvent(
      { type: `organizationMembership.${type}`, timestamp: 1_786_313_600_000, data: membershipData() },
      mappingOptions,
    );

    expect(result).toEqual({
      status: "mapped",
      event: {
        kind: "membership",
        type,
        provider: "clerk",
        providerMembershipId: "membership_synthetic",
        providerUserId: "user_synthetic",
        providerTenantId: "organization_synthetic",
        ...(type === "deleted" ? {} : { role: "manager" }),
        eventId: "msg_synthetic",
        occurredAt: "2026-08-09T22:13:20.000Z",
      },
    });
  });

  it("accepts the explicit organization_membership compatibility alias", async () => {
    const result = await mapClerkEvent(
      { type: "organization_membership.created", timestamp: 1_786_313_600_000, data: membershipData() },
      mappingOptions,
    );

    expect(result).toMatchObject({ status: "mapped", event: { kind: "membership", type: "created" } });
  });

  it.each(["0", "2026-08-10T13:20:00", "2026-02-30T00:00:00Z"])(
    "rejects malformed timestamp %s instead of coercing it",
    async (timestamp) => {
      const result = await mapClerkEvent(
        { type: "organization.created", timestamp, data: { id: "organization_synthetic" } },
        mappingOptions,
      );
      expect(result).toMatchObject({
        status: "invalid",
        findings: [expect.objectContaining({ code: "event-timestamp-invalid" })],
      });
    },
  );

  it("requires every reconciliation field for created membership events", async () => {
    const result = await mapClerkEvent(
      {
        type: "organizationMembership.created",
        timestamp: 1_786_313_600_000,
        data: membershipData({ id: undefined }),
      },
      mappingOptions,
    );

    expect(result).toEqual({
      status: "invalid",
      findings: [
        {
          code: "provider-membership-id-missing",
          message: "A recognized membership event has no provider membership id.",
          path: "data.id",
        },
      ],
    });
  });

  it("rejects an unmapped role instead of inventing a product role", async () => {
    const result = await mapClerkEvent(
      {
        type: "organizationMembership.updated",
        timestamp: 1_786_313_600_000,
        data: membershipData({ role: "source:unmapped" }),
      },
      mappingOptions,
    );

    expect(result).toMatchObject({ status: "invalid", findings: [expect.objectContaining({ code: "membership-role-unmapped" })] });
  });

  it("allows deletion events to omit an obsolete role", async () => {
    const result = await mapClerkEvent(
      { type: "organizationMembership.deleted", timestamp: 1_786_313_600_000, data: membershipData({ role: undefined }) },
      mappingOptions,
    );

    expect(result).toMatchObject({ status: "mapped", event: { kind: "membership", type: "deleted" } });
    expect(JSON.stringify(result)).not.toContain('"role"');
  });

  it("never makes deletion depend on translating an obsolete role", async () => {
    const roleMapper = vi.fn(() => {
      throw new Error("obsolete role");
    });
    const result = await mapClerkEvent(
      {
        type: "organizationMembership.deleted",
        timestamp: 1_786_313_600_000,
        data: membershipData({ role: "source:obsolete" }),
      },
      { ...mappingOptions, roleMapper },
    );

    expect(result).toMatchObject({ status: "mapped", event: { kind: "membership", type: "deleted" } });
    expect(JSON.stringify(result)).not.toContain('"role"');
    expect(roleMapper).not.toHaveBeenCalled();
  });

  it("never makes deletion depend on resolving removed local identifiers", async () => {
    const resolveUserId = vi.fn(() => {
      throw new Error("mapping removed");
    });
    const resolveTenantId = vi.fn(() => {
      throw new Error("mapping removed");
    });
    const result = await mapClerkEvent(
      {
        type: "organizationMembership.deleted",
        timestamp: 1_786_313_600_000,
        data: membershipData(),
      },
      {
        ...mappingOptions,
        localIdResolver: { resolveUserId, resolveTenantId },
      },
    );

    expect(result).toMatchObject({ status: "mapped", event: { kind: "membership", type: "deleted" } });
    expect(resolveUserId).not.toHaveBeenCalled();
    expect(resolveTenantId).not.toHaveBeenCalled();
  });

  it("uses an injected local-id resolver without exposing its source data", async () => {
    const result = await mapClerkEvent(
      { type: "organizationMembership.created", timestamp: 1_786_313_600_000, data: membershipData() },
      {
        ...mappingOptions,
        localIdResolver: {
          resolveUserId: () => "local_user_synthetic",
          resolveTenantId: () => "local_tenant_synthetic",
        },
      },
    );

    expect(result).toMatchObject({
      status: "mapped",
      event: { kind: "membership", localIds: { userId: "local_user_synthetic", tenantId: "local_tenant_synthetic" } },
    });
  });

  it("reports an unresolved local identifier explicitly", async () => {
    const membershipEvent: ClerkMembershipEvent = {
      kind: "membership",
      type: "created",
      provider: "clerk",
      providerMembershipId: "membership_synthetic",
      providerUserId: "user_synthetic",
      providerTenantId: "organization_synthetic",
      role: "manager",
      eventId: "msg_synthetic",
      occurredAt: "2026-08-10T13:20:00.000Z",
    };
    const result = await resolveClerkMembershipLocalIds(membershipEvent, {
      resolveUserId: () => undefined,
      resolveTenantId: () => "local_tenant_synthetic",
    });

    expect(result).toMatchObject({ status: "invalid", findings: [expect.objectContaining({ code: "local-user-id-unresolved" })] });
  });

  it("ignores unknown events without retaining their payload", async () => {
    const result = await mapClerkEvent(
      { type: "session.created", timestamp: 1_786_313_600_000, data: { value: "not-retained" } },
      mappingOptions,
    );
    expect(result).toEqual({ status: "ignored" });
  });
});
