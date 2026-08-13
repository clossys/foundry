import { describe, expect, it, vi } from "vitest";
import { CommunicationDeliveryError, CommunicationValidationError } from "./errors.js";
import { createCommunicationDispatcher } from "./dispatcher.js";
import type {
  CommunicationAdapter,
  CommunicationDispatchLedger,
  CommunicationDispatchResult,
  EmailMessage,
} from "./types.js";

const message: EmailMessage = {
  id: "account-invitation/user-123",
  event: "account.invitation.created",
  category: "security",
  channel: "email",
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "You are invited",
  text: "Open the invitation.",
  html: "<p>Open the invitation.</p>",
};

function adapter(deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }))): CommunicationAdapter {
  return { channel: "email", deliver };
}

function createTestLedger(): CommunicationDispatchLedger & { readonly results: ReadonlyMap<string, CommunicationDispatchResult> } {
  const inFlight = new Map<string, string>();
  const results = new Map<string, CommunicationDispatchResult>();
  let sequence = 0;
  return {
    results,
    async claim(nextMessage) {
      if (inFlight.has(nextMessage.id) || results.has(nextMessage.id)) return { outcome: "duplicate" };
      const leaseId = `test-lease-${++sequence}`;
      inFlight.set(nextMessage.id, leaseId);
      return { outcome: "claimed", leaseId };
    },
    async complete(claim, result) {
      if (inFlight.get(result.messageId) !== claim.leaseId) throw new Error("stale test ledger lease");
      inFlight.delete(result.messageId);
      if (result.state !== "failed") results.set(result.messageId, result);
    },
  };
}

describe("createCommunicationDispatcher", () => {
  it("returns provider acceptance without claiming inbox delivery", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const result = await createCommunicationDispatcher({ adapters: { email: adapter(deliver) } }).dispatch(message);

    expect(result).toMatchObject({ state: "accepted", acceptance: { provider: "example", messageId: "provider-1" } });
    expect(deliver).toHaveBeenCalledWith(message);
  });

  it("applies policy before claiming or sending", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const ledger = createTestLedger();
    const result = await createCommunicationDispatcher({
      adapters: { email: adapter(deliver) },
      policy: () => ({ outcome: "deny", reason: "consent_withdrawn" }),
      ledger,
    }).dispatch(message);

    expect(result).toMatchObject({ state: "skipped", reason: "consent_withdrawn" });
    expect(deliver).not.toHaveBeenCalled();
    expect(ledger.results.size).toBe(0);
  });

  it("deduplicates accepted messages with an opaque ledger lease", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const ledger = createTestLedger();
    const dispatcher = createCommunicationDispatcher({ adapters: { email: adapter(deliver) }, ledger });

    await expect(dispatcher.dispatch(message)).resolves.toMatchObject({ state: "accepted" });
    await expect(dispatcher.dispatch(message)).resolves.toMatchObject({ state: "duplicate" });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("makes a failed test-ledger attempt claimable again", async () => {
    const deliver = vi
      .fn<CommunicationAdapter["deliver"]>()
      .mockRejectedValueOnce(new CommunicationDeliveryError("network", "Network unavailable", { retryable: true }))
      .mockResolvedValueOnce({ provider: "example", messageId: "provider-2" });
    const ledger = createTestLedger();
    const dispatcher = createCommunicationDispatcher({ adapters: { email: adapter(deliver) }, ledger });

    await expect(dispatcher.dispatch(message)).resolves.toMatchObject({ state: "failed", failure: { retryable: true } });
    await expect(dispatcher.dispatch(message)).resolves.toMatchObject({ state: "accepted" });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("normalizes a missing adapter as an explicit failure", async () => {
    await expect(createCommunicationDispatcher({ adapters: {} }).dispatch(message)).resolves.toMatchObject({
      state: "failed",
      failure: { code: "channel_unconfigured", retryable: false },
    });
  });

  it("rejects empty adapter success handles", async () => {
    const empty = adapter(vi.fn(async () => ({ provider: "example", messageId: "" })));
    await expect(createCommunicationDispatcher({ adapters: { email: empty } }).dispatch(message)).resolves.toMatchObject({
      state: "failed",
      failure: { code: "invalid_adapter_result" },
    });
  });

  it("does not let observability failure change delivery state", async () => {
    const result = await createCommunicationDispatcher({
      adapters: { email: adapter() },
      onResult: () => {
        throw new Error("logger unavailable");
      },
    }).dispatch(message);
    expect(result.state).toBe("accepted");
  });

  it("does not report success when durable completion fails", async () => {
    const onResult = vi.fn();
    const dispatcher = createCommunicationDispatcher({
      adapters: { email: adapter() },
      ledger: {
        async claim() {
          return { outcome: "claimed", leaseId: "lease-1" };
        },
        async complete() {
          throw new Error("durable ledger unavailable");
        },
      },
      onResult,
    });
    await expect(dispatcher.dispatch(message)).rejects.toThrow("durable ledger unavailable");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("throws before policy or transport for an invalid message", async () => {
    const dispatcher = createCommunicationDispatcher({ adapters: { email: adapter() } });
    await expect(dispatcher.dispatch({ ...message, id: "", to: [] })).rejects.toBeInstanceOf(
      CommunicationValidationError,
    );
  });

  /**
   * `CommunicationChannel` reserves `"sms"` as a name this package's
   * contract owns, but `CommunicationMessage` ships no message shape for it.
   * A message claiming that channel must still fail validation before
   * policy, claim or transport run — reserving the name must not open a way
   * to smuggle an unvalidated, unimplemented-channel message through.
   */
  it("rejects a reserved-but-unshipped channel before policy or transport, not by silently dispatching it", async () => {
    const deliver = vi.fn(async () => ({ provider: "example", messageId: "provider-1" }));
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const dispatcher = createCommunicationDispatcher({ adapters: { email: adapter(deliver) }, policy });

    await expect(
      dispatcher.dispatch({ ...message, channel: "sms" } as unknown as EmailMessage),
    ).rejects.toBeInstanceOf(CommunicationValidationError);
    expect(policy).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
