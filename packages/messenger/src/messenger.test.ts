import { describe, expect, it, vi } from "vitest";
import { MessengerDeliveryError, MessengerValidationError } from "./errors.js";
import { createMessenger } from "./messenger.js";
import type { DeliveryIntent, DispatchLedger, DispatchResult, MessageAdapter } from "./types.js";

const intent: DeliveryIntent = {
  message: {
    id: "invitation-123",
    event: "account.invitation.created",
    category: "security",
    channel: "email",
    from: "sender@example.com",
    to: ["recipient@example.com"],
    subject: "You are invited",
    text: "Open the invitation.",
  },
  authorization: {
    id: "authorization-123",
    intentId: "invitation-123",
    policy: "account-security",
    authorizedAt: "2026-08-23T10:00:00.000Z",
  },
  windowOpensAt: "2026-08-23T10:00:00.000Z",
  windowClosesAt: "2026-08-23T10:05:00.000Z",
};

function adapter(deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }))): MessageAdapter {
  return { channel: "email", deliver };
}

function ledger(): DispatchLedger & { results: Map<string, DispatchResult>; claims: number } {
  const inFlight = new Map<string, string>();
  const results = new Map<string, DispatchResult>();
  let sequence = 0;
  return {
    results,
    get claims() { return sequence; },
    async claim(next) {
      if (inFlight.has(next.message.id) || results.has(next.message.id)) return { outcome: "duplicate" };
      const leaseId = `lease-${++sequence}`;
      inFlight.set(next.message.id, leaseId);
      return { outcome: "claimed", leaseId };
    },
    async complete(claim, result) {
      if (inFlight.get(result.intentId) !== claim.leaseId) throw new Error("stale lease");
      inFlight.delete(result.intentId);
      results.set(result.intentId, result);
    },
  };
}

describe("createMessenger", () => {
  it("requires policy and durable ledger configuration", () => {
    expect(() => createMessenger({ adapters: {}, policy: undefined, ledger: ledger() } as never)).toThrow(
      "requires an authorization policy",
    );
    expect(() => createMessenger({ adapters: {}, policy: () => ({ outcome: "allow" }), ledger: undefined } as never)).toThrow(
      "requires a durable dispatch ledger",
    );
  });

  it("durably completes a denied intent without invoking transport", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const durable = ledger();
    const result = await createMessenger({
      adapters: { email: adapter(deliver) },
      policy: () => ({ outcome: "deny", reason: "authorization-revoked" }),
      ledger: durable,
    }).dispatch(intent);
    expect(result).toMatchObject({ state: "skipped", reason: "authorization-revoked" });
    expect(durable.claims).toBe(1);
    expect(durable.results.get(intent.message.id)).toEqual(result);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects malformed policy results rather than default-allowing", async () => {
    const deliver = vi.fn();
    const durable = ledger();
    await expect(createMessenger({
      adapters: { email: adapter(deliver) },
      policy: () => undefined as never,
      ledger: durable,
    }).dispatch(intent)).rejects.toThrow("invalid decision");
    expect(durable.claims).toBe(1);
    expect(durable.results.size).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("leaves a thrown policy judgment uncompleted rather than fabricating a terminal result", async () => {
    const durable = ledger();
    const deliver = vi.fn();
    await expect(createMessenger({
      adapters: { email: adapter(deliver) },
      policy: () => { throw new Error("policy source unavailable"); },
      ledger: durable,
    }).dispatch(intent)).rejects.toThrow("policy source unavailable");
    expect(durable.claims).toBe(1);
    expect(durable.results.size).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("claims, transports, and durably completes provider acceptance", async () => {
    const durable = ledger();
    const result = await createMessenger({
      adapters: { email: adapter() },
      policy: () => ({ outcome: "allow" }),
      ledger: durable,
    }).dispatch(intent);
    expect(result).toMatchObject({ state: "accepted", acceptance: { provider: "example", messageId: "provider-1" } });
    expect(durable.results.get(intent.message.id)).toEqual(result);
  });

  it("deduplicates before transport", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const durable = ledger();
    const messenger = createMessenger({
      adapters: { email: adapter(deliver) },
      policy: () => ({ outcome: "allow" }),
      ledger: durable,
    });
    await messenger.dispatch(intent);
    await expect(messenger.dispatch(intent)).resolves.toMatchObject({ state: "duplicate" });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("normalizes adapter failure and durably records it", async () => {
    const durable = ledger();
    const failing = adapter(vi.fn(async () => {
      throw new MessengerDeliveryError("network", "Network unavailable", { retryable: true, provider: "example" });
    }));
    const result = await createMessenger({
      adapters: { email: failing },
      policy: () => ({ outcome: "allow" }),
      ledger: durable,
    }).dispatch(intent);
    expect(result).toMatchObject({ state: "failed", failure: { code: "network", retryable: true, provider: "example" } });
    expect(durable.results.get(intent.message.id)).toEqual(result);
  });

  it("never reports acceptance when durable completion fails", async () => {
    const messenger = createMessenger({
      adapters: { email: adapter() },
      policy: () => ({ outcome: "allow" }),
      ledger: {
        async claim() { return { outcome: "claimed", leaseId: "lease-1" }; },
        async complete() { throw new Error("ledger unavailable"); },
      },
    });
    await expect(messenger.dispatch(intent)).rejects.toThrow("ledger unavailable");
  });

  it("rejects absent authorization evidence before policy", async () => {
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    await expect(createMessenger({ adapters: {}, policy, ledger: ledger() }).dispatch({
      ...intent,
      authorization: { ...intent.authorization, id: "" },
    })).rejects.toBeInstanceOf(MessengerValidationError);
    expect(policy).not.toHaveBeenCalled();
  });

  it("rejects authorization evidence bound to a different intent", async () => {
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    await expect(createMessenger({ adapters: {}, policy, ledger: ledger() }).dispatch({
      ...intent,
      authorization: { ...intent.authorization, intentId: "other-intent" },
    })).rejects.toBeInstanceOf(MessengerValidationError);
    expect(policy).not.toHaveBeenCalled();
  });
});
