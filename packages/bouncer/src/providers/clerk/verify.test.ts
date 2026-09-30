/**
 * Signature verification for one provider's deliveries, and the peer-version
 * guard that stands in front of it.
 *
 * This is the boundary at which "the provider said so" becomes something this
 * package will act on. Everything upstream of a verified signature is an
 * assertion by whoever made the HTTP request; nothing here trusts a body it
 * has not verified byte for byte, and no signing material is retained on the
 * way out.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { ClerkWebhookSignatureError, verifyClerkWebhook } from "./index.js";
import type { ClerkWebhookHeaders } from "./index.js";
import { SVIX_DECLARED_RANGE } from "./verify.js";

const signingSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

function signedHeaders(rawBody: string): ClerkWebhookHeaders {
  const sender = new Webhook(signingSecret);
  const deliveryTime = new Date();
  return {
    "svix-id": "msg_synthetic",
    "svix-timestamp": String(Math.floor(deliveryTime.getTime() / 1_000)),
    "svix-signature": sender.sign("msg_synthetic", deliveryTime, rawBody),
  };
}

const bodySentinel = "BODY_SENTINEL_7c1e9b";
const headerSentinel = "msg_sentinel_5d2a84";

type SigningKey = string | Uint8Array;

function senderFor(key: SigningKey): Webhook {
  return typeof key === "string" ? new Webhook(key.trim()) : new Webhook(key, { format: "raw" });
}

function signedHeadersFor(key: SigningKey, rawBody: string, id = "msg_synthetic"): ClerkWebhookHeaders {
  const deliveryTime = new Date();
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(deliveryTime.getTime() / 1_000)),
    "svix-signature": senderFor(key).sign(id, deliveryTime, rawBody),
  };
}

function base64Key(byteLength: number, fill = 7): string {
  return Buffer.alloc(byteLength, fill).toString("base64");
}

function captureError(run: () => unknown): ClerkWebhookSignatureError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ClerkWebhookSignatureError);
    return error as ClerkWebhookSignatureError;
  }
  throw new Error("expected the call to throw");
}

function surfaces(error: ClerkWebhookSignatureError): string[] {
  const cause = (error as { cause?: unknown }).cause;
  return [error.message, String(error), JSON.stringify(error), String(cause), JSON.stringify(cause ?? null)];
}

describe("verifyClerkWebhook", () => {
  it("verifies the exact signed raw body and returns no signature material", () => {
    const rawBody = JSON.stringify({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } });
    const verified = verifyClerkWebhook(rawBody, signedHeaders(rawBody), signingSecret);

    expect(verified).toEqual({
      eventId: "msg_synthetic",
      event: { type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } },
    });
    expect(Object.keys(verified)).toEqual(["eventId", "event"]);
  });

  it("fails closed for altered bodies and reports a typed signature error", () => {
    const rawBody = JSON.stringify({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } });
    const alteredBody = JSON.stringify({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "other_user" } });

    expect(() => verifyClerkWebhook(alteredBody, signedHeaders(rawBody), signingSecret)).toThrow(ClerkWebhookSignatureError);
    try {
      verifyClerkWebhook(alteredBody, signedHeaders(rawBody), signingSecret);
    } catch (error) {
      expect(error).toBeInstanceOf(ClerkWebhookSignatureError);
      expect((error as ClerkWebhookSignatureError).code).toBe("signature-invalid");
    }
  });

  it("requires every Svix signature header before verification", () => {
    expect(() => verifyClerkWebhook("{}", { "svix-id": "msg_synthetic" }, signingSecret)).toThrow(ClerkWebhookSignatureError);
    try {
      verifyClerkWebhook("{}", { "svix-id": "msg_synthetic" }, signingSecret);
    } catch (error) {
      expect((error as ClerkWebhookSignatureError).code).toBe("signature-headers-missing");
      expect((error as ClerkWebhookSignatureError).missingHeaders).toEqual(["svix-timestamp", "svix-signature"]);
    }
  });

  it("a missing, prefix-only, malformed or short key is refused first", () => {
    const refused: Array<[string, unknown]> = [
      ["empty", ""],
      ["blank", "   "],
      ["undefined", undefined],
      ["prefix only", "whsec_"],
      ["15-byte key", `whsec_${base64Key(15)}`],
      ["15-byte bare key", base64Key(15)],
      ["1-mod-4 key", `whsec_${base64Key(32).slice(0, 41)}`],
      ["non-base64 key", `whsec_${"!".repeat(24)}`],
      ["15-byte Uint8Array", Buffer.alloc(15, 7)],
      ["empty Uint8Array", new Uint8Array(0)],
    ];
    for (const [label, key] of refused) {
      const error = captureError(() => verifyClerkWebhook("{}", {}, key as SigningKey));
      expect(error.code, label).toBe("signing-secret-invalid");
      expect(error.missingHeaders, label).toEqual([]);
    }
  });

  it("a 16-byte key, a padded key and a 32-byte Uint8Array key verify", () => {
    const rawBody = JSON.stringify({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } });
    const accepted: Array<[string, SigningKey, SigningKey]> = [
      ["16-byte key", `whsec_${base64Key(16)}`, `whsec_${base64Key(16)}`],
      ["padded key", `\n  whsec_${base64Key(32)} \t`, `whsec_${base64Key(32)}`],
      ["32-byte Uint8Array key", Buffer.alloc(32, 9), Buffer.alloc(32, 9)],
    ];
    for (const [label, key, signerKey] of accepted) {
      const verified = verifyClerkWebhook(rawBody, signedHeadersFor(signerKey, rawBody), key);
      expect(verified.eventId, label).toBe("msg_synthetic");
      expect(verified.event, label).toEqual({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } });
    }
  });

  it("a signed non-JSON body is payload-invalid, an unsigned one signature-invalid", () => {
    const signedNonJson = `not json ${bodySentinel}`;
    const signedError = captureError(() => verifyClerkWebhook(signedNonJson, signedHeadersFor(signingSecret, signedNonJson), signingSecret));
    expect(signedError.code).toBe("payload-invalid");

    const unsignedError = captureError(() => verifyClerkWebhook(signedNonJson, signedHeadersFor(signingSecret, "{}"), signingSecret));
    expect(unsignedError.code).toBe("signature-invalid");
  });

  it("a signed null, array or scalar event is payload-invalid", () => {
    for (const rawBody of ["null", "[]", '[{"type":"user.created"}]', "42", '"text"', "true"]) {
      const error = captureError(() => verifyClerkWebhook(rawBody, signedHeadersFor(signingSecret, rawBody), signingSecret));
      expect(error.code, rawBody).toBe("payload-invalid");
    }
  });

  it("no error carries key material or body text", () => {
    const shortKeyBytes = Buffer.alloc(15, 0x5a);
    const shortKey = `whsec_${shortKeyBytes.toString("base64")}`;
    const validBytes = Buffer.alloc(32, 7);
    const secretMaterial = [validBytes.toString("base64"), shortKeyBytes.toString("base64"), signingSecret, shortKey];
    const signedNonJson = `not json ${bodySentinel}`;
    const signedScalar = `"${bodySentinel}"`;

    const errors: Array<[string, ClerkWebhookSignatureError]> = [
      ["signing-secret-invalid", captureError(() => verifyClerkWebhook(`{"${bodySentinel}":1}`, {}, shortKey))],
      ["signing-secret-invalid (bytes)", captureError(() => verifyClerkWebhook(`{"${bodySentinel}":1}`, {}, shortKeyBytes))],
      ["signature-headers-missing", captureError(() => verifyClerkWebhook(`{"${bodySentinel}":1}`, { "svix-id": headerSentinel }, signingSecret))],
      ["signature-invalid", captureError(() => verifyClerkWebhook(`{"${bodySentinel}":1}`, signedHeadersFor(signingSecret, "{}", headerSentinel), signingSecret))],
      ["payload-invalid (non-JSON)", captureError(() => verifyClerkWebhook(signedNonJson, signedHeadersFor(signingSecret, signedNonJson, headerSentinel), signingSecret))],
      ["payload-invalid (scalar)", captureError(() => verifyClerkWebhook(signedScalar, signedHeadersFor(signingSecret, signedScalar, headerSentinel), signingSecret))],
    ];
    expect(new Set(errors.map(([, error]) => error.code))).toEqual(
      new Set(["signing-secret-invalid", "signature-headers-missing", "signature-invalid", "payload-invalid"]),
    );
    for (const [label, error] of errors) {
      for (const surface of surfaces(error)) {
        for (const forbidden of [...secretMaterial, bodySentinel, headerSentinel]) {
          expect(surface.includes(forbidden), `${label} leaked ${forbidden.slice(0, 6)}...`).toBe(false);
        }
      }
    }
  });

  it("accepts a Fetch Headers object directly without weakening header checks", () => {
    const rawBody = JSON.stringify({ type: "user.created", timestamp: 1_786_313_600_000, data: { id: "user_synthetic" } });
    const headers = new Headers(signedHeaders(rawBody));

    expect(verifyClerkWebhook(rawBody, headers, signingSecret)).toMatchObject({
      eventId: "msg_synthetic",
      event: { type: "user.created" },
    });
  });
});

describe("the svix peer-version guard (#182)", () => {
  it("keeps SVIX_DECLARED_RANGE in sync with package.json's declared peer range", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(SVIX_DECLARED_RANGE).toBe(manifest.peerDependencies.svix);
    expect(manifest.peerDependenciesMeta.svix?.optional).toBe(true);
  });

  it("importing verify.ts does not throw against this repository's own real installed svix", () => {
    // verify.ts calls assertPeerVersion(...) at module load time (see its
    // own header comment); this file already imported from it above, so
    // reaching this test at all is itself the assertion that it didn't
    // throw against the real svix this workspace has installed.
    expect(SVIX_DECLARED_RANGE).toBe("^1.96.0");
  });
});
