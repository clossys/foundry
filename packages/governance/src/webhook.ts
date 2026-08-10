import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's `x-hub-signature-256` format without parsing the payload
 * or retaining the caller-provided secret. The caller owns secret retrieval.
 */
export function verifyWebhookSignature(
  payload: Uint8Array,
  signature: string | undefined,
  secret: string | Uint8Array,
): boolean {
  if (signature === undefined || !signature.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const received = signature.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
