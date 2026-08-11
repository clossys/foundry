import type {
  CommunicationDispatchLedger,
  CommunicationDispatchResult,
  CommunicationMessage,
  DeliveryEvent,
  DeliveryEventLedger,
} from "./types.js";

export interface MemoryDispatchLedger extends CommunicationDispatchLedger {
  readonly results: ReadonlyMap<string, CommunicationDispatchResult>;
}

/** Single-process fake for tests; failed attempts become claimable again. */
export function createMemoryDispatchLedger(): MemoryDispatchLedger {
  const inFlight = new Map<string, string>();
  const results = new Map<string, CommunicationDispatchResult>();
  let sequence = 0;
  return {
    results,
    async claim(message: CommunicationMessage) {
      if (inFlight.has(message.id) || results.has(message.id)) return { outcome: "duplicate" };
      const leaseId = `memory-lease-${++sequence}`;
      inFlight.set(message.id, leaseId);
      return { outcome: "claimed", leaseId };
    },
    async complete(claim, result) {
      if (inFlight.get(result.messageId) !== claim.leaseId) {
        throw new Error(`Stale or unknown memory-ledger lease for message "${result.messageId}"`);
      }
      inFlight.delete(result.messageId);
      if (result.state !== "failed") results.set(result.messageId, result);
    },
  };
}

export interface MemoryDeliveryEventLedger extends DeliveryEventLedger {
  readonly events: readonly DeliveryEvent[];
}

/** Single-process event fake that deduplicates provider event ids. */
export function createMemoryDeliveryEventLedger(): MemoryDeliveryEventLedger {
  const ids = new Set<string>();
  const events: DeliveryEvent[] = [];
  return {
    events,
    async apply(event) {
      const key = `${event.provider}\0${event.eventId}`;
      if (ids.has(key)) return "duplicate";
      ids.add(key);
      events.push(event);
      return "applied";
    },
  };
}
