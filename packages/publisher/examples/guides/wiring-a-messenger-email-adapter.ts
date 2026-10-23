import { createContactHandler, createMemoryRateLimiter } from "@clossys/publisher/web";
import type { ContactDelivery } from "@clossys/publisher/web";

// Your Messenger email adapter, constructed elsewhere; it is assignable to
// `ContactDelivery` as it is.
const emailAdapter: ContactDelivery = { channel: "email", deliver: async () => ({ accepted: true }) };

const handler = createContactHandler({
  topics: ["general", "press"],
  from: "Site <site@example.com>",
  to: ["inbox@example.com"],
  subject: "New contact form message",
  limiter: createMemoryRateLimiter({ limit: 3, windowMs: 60_000, now: () => Date.now() }),
  delivery: emailAdapter,
  target: "production",
});

export { handler };
