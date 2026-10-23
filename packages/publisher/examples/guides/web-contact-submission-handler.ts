const body: Record<string, string> = { topic: "general", name: "Example", email: "visitor@example.com", phone: "", message: "Example message", website: "" };
const clientKey: string = "local-example";

import {
  createContactHandler,
  createMemoryRateLimiter,
  createStubContactDelivery,
} from "@clossys/publisher/web";

const handler = createContactHandler({
  topics: ["general", "press"],
  from: "Site <site@example.com>",
  to: ["inbox@example.com"],
  subject: "New contact form message",
  limiter: createMemoryRateLimiter({ limit: 3, windowMs: 60_000, now: () => Date.now() }),
  delivery: createStubContactDelivery(), // refused when target is "production"
  target: "preview",
});

const result = await handler.handle(body, { clientKey });
// { status: "accepted" } | { status: "invalid", fields: [...] }
// | { status: "rate-limited" } | { status: "unavailable" }

export { result };
