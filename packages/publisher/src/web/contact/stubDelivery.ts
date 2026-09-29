import { STUB_CONTACT_DELIVERY, type ContactOutboundMessage, type StubContactDelivery } from "./types.js";

/**
 * An in-memory {@link ContactDelivery} for tests and preview round-trips.
 *
 * Each `deliver` call stores a frozen copy of the message, so a later mutation
 * by the caller cannot rewrite what the stub recorded, then resolves with the
 * stub's own acceptance. The brand from `types.ts` is what lets a handler
 * constructed for the production target refuse it; see
 * {@link STUB_CONTACT_DELIVERY}.
 */
export function createStubContactDelivery(): StubContactDelivery {
  const deliveries: ContactOutboundMessage[] = [];
  return {
    channel: "email",
    [STUB_CONTACT_DELIVERY]: true,
    deliveries,
    deliver: async (message) => {
      const copy: ContactOutboundMessage = Object.freeze({
        ...message,
        to: Object.freeze([...message.to]) as unknown as ContactOutboundMessage["to"],
        replyTo: Object.freeze([...message.replyTo]) as unknown as ContactOutboundMessage["replyTo"],
      });
      deliveries.push(copy);
      return { provider: "stub", messageId: message.id };
    },
  };
}
