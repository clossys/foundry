import { Buffer } from "node:buffer";
import { Webhook } from "svix";
import type { ClerkWebhookHeaders, ClerkWebhookRawBody, VerifiedClerkWebhook } from "./types.js";
import { assertPeerVersion } from "../../internal/peer-version.js";
import { resolveInstalledPeerVersion } from "../../internal/resolve-installed-peer-version.js";

/**
 * `svix` is one of this package's optional peers (see package.json's
 * `peerDependenciesMeta`) — optional so a consumer can install
 * `@clossys/bouncer` and use the provider-neutral root or `./agent` without
 * ever installing it; only webhook signature verification needs it. This
 * is the one module that imports it, so it's the adapter entry point
 * #182 asks for: an absent or out-of-range `svix` previously surfaced as
 * whatever `new Webhook(...).verify(...)` happened to crash on, with
 * nothing naming a version range as the cause. This file already does
 * `import { Buffer } from "node:buffer"`, so it is unambiguously a
 * Node-context module — safe for the `node:module`/`node:fs`-based
 * `resolveInstalledPeerVersion`, unlike the edge-safe `proxy.ts`/
 * `proxy-entry.ts` or the browser-side `client.tsx` (see those files'
 * own comments). `SVIX_DECLARED_RANGE` must match package.json's
 * `peerDependencies.svix` exactly, confirmed directly by this package's
 * own (unshipped) test suite.
 */
export const SVIX_DECLARED_RANGE = "^1.96.0";
assertPeerVersion({
  peer: "svix",
  declaredRange: SVIX_DECLARED_RANGE,
  foundVersion: resolveInstalledPeerVersion("svix", import.meta.url),
});

export type ClerkWebhookSignatureErrorCode = "signing-secret-invalid" | "signature-headers-missing" | "signature-invalid" | "payload-invalid";

const errorMessages: Record<ClerkWebhookSignatureErrorCode, string> = {
  "signing-secret-invalid": "Clerk webhook verification requires a valid signing secret.",
  "signature-headers-missing": "Clerk webhook verification requires the Svix signature headers.",
  "signature-invalid": "Clerk webhook signature verification failed.",
  "payload-invalid": "Clerk webhook payload is not a valid signed event object.",
};

/** A typed error for an unusable signing secret, absent or invalid Svix signature material, or a signed payload that is not an event object. */
export class ClerkWebhookSignatureError extends Error {
  override readonly name = "ClerkWebhookSignatureError";

  constructor(readonly code: ClerkWebhookSignatureErrorCode, readonly missingHeaders: readonly string[] = []) {
    super(errorMessages[code]);
  }
}

const signingSecretPrefix = "whsec_";
const signingSecretMinimumBytes = 16;
const base64Shape = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Refuses, before any delivery is read, a signing secret that could never
 * authenticate one: a missing or blank value, a prefix with nothing after it
 * (an empty HMAC key that would verify anything signed with it), a value
 * that is not strict base64, or a key under 16 bytes. A string is trimmed
 * once and may carry the `whsec_` prefix; bytes are used as given. Returns
 * the value to hand the verifier and never echoes the secret.
 */
export function assertClerkWebhookSigningSecret(signingSecret: unknown): string | Uint8Array {
  if (signingSecret instanceof Uint8Array) {
    if (signingSecret.byteLength < signingSecretMinimumBytes) throw new ClerkWebhookSignatureError("signing-secret-invalid");
    return signingSecret;
  }
  if (typeof signingSecret !== "string") throw new ClerkWebhookSignatureError("signing-secret-invalid");
  const trimmed = signingSecret.trim();
  const encoded = trimmed.startsWith(signingSecretPrefix) ? trimmed.slice(signingSecretPrefix.length) : trimmed;
  if (!base64Shape.test(encoded) || encoded.length % 4 !== 0) throw new ClerkWebhookSignatureError("signing-secret-invalid");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if ((encoded.length / 4) * 3 - padding < signingSecretMinimumBytes) throw new ClerkWebhookSignatureError("signing-secret-invalid");
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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

/**
 * Verifies the exact bytes received through Svix without retaining signing material.
 * Checks run in a fixed order: signing secret, headers, signature, JSON parse, event shape.
 */
export function verifyClerkWebhook(rawBody: ClerkWebhookRawBody, headers: ClerkWebhookHeaders, signingSecret: string | Uint8Array): VerifiedClerkWebhook {
  const secret = assertClerkWebhookSigningSecret(signingSecret);
  const signatureHeaders = readRequiredHeaders(headers);
  const payload = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody);
  let event: unknown;
  try {
    const webhook = typeof secret === "string" ? new Webhook(secret) : new Webhook(secret, { format: "raw" });
    event = webhook.verify(payload, signatureHeaders);
  } catch (error) {
    // svix parses only after a signature match, so a SyntaxError is a signed non-JSON body.
    throw new ClerkWebhookSignatureError(error instanceof SyntaxError ? "payload-invalid" : "signature-invalid");
  }
  if (!isPlainObject(event)) throw new ClerkWebhookSignatureError("payload-invalid");
  return { eventId: signatureHeaders["svix-id"], event };
}
