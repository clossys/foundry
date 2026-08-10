import { mapClerkEvent } from "./map.js";
import type {
  ClerkEventMapping,
  ClerkVerifiedEventMappingOptions,
  ClerkWebhookHeaders,
  ClerkWebhookRawBody,
} from "./types.js";
import { verifyClerkWebhook } from "./verify.js";

/** Verifies a raw Svix delivery and then maps its parsed event. */
export async function verifyAndMapClerkWebhook(
  rawBody: ClerkWebhookRawBody,
  headers: ClerkWebhookHeaders,
  signingSecret: string | Uint8Array,
  options: ClerkVerifiedEventMappingOptions,
): Promise<ClerkEventMapping> {
  const verified = verifyClerkWebhook(rawBody, headers, signingSecret);
  return mapClerkEvent(verified.event, { ...options, eventId: verified.eventId });
}
