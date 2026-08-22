/**
 * The one-call composition of verification and mapping: a raw delivery in,
 * a normalized event or an explicit finding out, with no intermediate state a
 * caller could accidentally act on before the signature was checked.
 */
import { Buffer } from "node:buffer";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { verifyAndMapClerkWebhook } from "./index.js";
import type { ClerkEventMappingOptions, ClerkWebhookHeaders } from "./index.js";

const signingSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

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

function signedHeaders(rawBody: string): ClerkWebhookHeaders {
  const sender = new Webhook(signingSecret);
  const deliveryTime = new Date();
  return {
    "svix-id": "msg_synthetic",
    "svix-timestamp": String(Math.floor(deliveryTime.getTime() / 1_000)),
    "svix-signature": sender.sign("msg_synthetic", deliveryTime, rawBody),
  };
}

describe("verifyAndMapClerkWebhook", () => {
  it("only maps a valid raw-body-verified delivery", async () => {
    const rawBody = JSON.stringify({
      type: "organizationMembership.created",
      timestamp: 1_786_313_600_000,
      data: membershipData(),
    });

    const result = await verifyAndMapClerkWebhook(rawBody, signedHeaders(rawBody), signingSecret, {
      roleMapper: mappingOptions.roleMapper,
    });

    expect(result).toMatchObject({
      status: "mapped",
      event: {
        kind: "membership",
        eventId: "msg_synthetic",
        providerMembershipId: "membership_synthetic",
        providerUserId: "user_synthetic",
        providerTenantId: "organization_synthetic",
      },
    });
  });
});
