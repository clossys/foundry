import { describe, expect, it } from "vitest";
import { createMemoryDeliveryEventLedger } from "./testing.js";

describe("createMemoryDeliveryEventLedger", () => {
  it("atomically-shaped deduplicates provider-scoped event ids", async () => {
    const ledger = createMemoryDeliveryEventLedger();
    const event = {
      provider: "example",
      eventId: "event-1",
      providerMessageId: "message-1",
      type: "delivered" as const,
      providerType: "message.delivered",
      occurredAt: "2026-08-10T12:00:00.000Z",
      tags: {},
    };
    await expect(ledger.apply(event)).resolves.toBe("applied");
    await expect(ledger.apply(event)).resolves.toBe("duplicate");
    await expect(ledger.apply({ ...event, provider: "other-provider" })).resolves.toBe("applied");
    expect(ledger.events).toEqual([event, { ...event, provider: "other-provider" }]);
  });
});
