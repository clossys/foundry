import { Buffer } from "node:buffer";
import { Webhook } from "svix";
import type { ClerkWebhookHeaders, ClerkWebhookRawBody, VerifiedClerkWebhook } from "./types.js";

type ClerkWebhookSignatureErrorCode = "signature-headers-missing" | "signature-invalid";

/** A typed error for absent or invalid Svix signature material. */
export class ClerkWebhookSignatureError extends Error {
  override readonly name = "ClerkWebhookSignatureError";

  constructor(readonly code: ClerkWebhookSignatureErrorCode, readonly missingHeaders: readonly string[] = []) {
    super(code === "signature-headers-missing" ? "Clerk webhook verification requires the Svix signature headers." : "Clerk webhook signature verification failed.");
  }
}

const requiredHeaderNames = ["svix-id", "svix-timestamp", "svix-signature"] as const;

function isHeaderAccessor(headers: ClerkWebhookHeaders): headers is Pick<Headers, "get"> {
  return typeof (headers as { get?: unknown }).get === "function";
}

function readRequiredHeaders(headers: ClerkWebhookHeaders): Record<(typeof requiredHeaderNames)[number], string> {
  if (isHeaderAccessor(headers)) {
    const values = Object.fromEntries(requiredHeaderNames.map((name) => [name, headers.get(name) ?? undefined])) as Record<(typeof requiredHeaderNames)[number], string | undefined>;
    const missingHeaders = requiredHeaderNames.filter((name) => !values[name]?.trim());
    if (missingHeaders.length > 0) throw new ClerkWebhookSignatureError("signature-headers-missing", missingHeaders);
    return values as Record<(typeof requiredHeaderNames)[number], string>;
  }
  const normalized = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) if (typeof value === "string") normalized.set(name.toLowerCase(), value);
  const missingHeaders = requiredHeaderNames.filter((name) => !normalized.get(name)?.trim());
  if (missingHeaders.length > 0) throw new ClerkWebhookSignatureError("signature-headers-missing", missingHeaders);
  return {
    "svix-id": normalized.get("svix-id") as string,
    "svix-timestamp": normalized.get("svix-timestamp") as string,
    "svix-signature": normalized.get("svix-signature") as string,
  };
}

/** Verifies the exact bytes received through Svix without retaining signing material. */
export function verifyClerkWebhook(rawBody: ClerkWebhookRawBody, headers: ClerkWebhookHeaders, signingSecret: string | Uint8Array): VerifiedClerkWebhook {
  const signatureHeaders = readRequiredHeaders(headers);
  const payload = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody);
  try {
    const event = new Webhook(signingSecret).verify(payload, signatureHeaders);
    return { eventId: signatureHeaders["svix-id"], event };
  } catch {
    throw new ClerkWebhookSignatureError("signature-invalid");
  }
}
