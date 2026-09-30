/**
 * The production delivery for the contact form: Messenger's Resend adapter.
 *
 * The only thing this file adds is where the provider key comes from. It is
 * read from the environment inside a function the adapter calls on each send,
 * never held in a variable or captured when the module loads, so a rotated key
 * takes effect without a restart and the value never sits in this module's
 * state. Nothing here logs, returns or forwards the key.
 *
 * Server-only. It is built only for the `production` target: other targets
 * use the in-memory stub `selectContactDelivery` gives them, and never reach
 * this file's factory.
 */
import { createResendAdapter } from "@clossys/messenger/providers/resend";
import type { ContactDelivery } from "@clossys/publisher/web";

/** A send that has not answered by then fails as `unavailable` instead of holding the visitor's request open. */
const SEND_TIMEOUT_MS = 10_000;

export function createProductionDelivery(): ContactDelivery {
  return createResendAdapter({ apiKey: () => process.env.RESEND_API_KEY, timeoutMs: SEND_TIMEOUT_MS });
}
