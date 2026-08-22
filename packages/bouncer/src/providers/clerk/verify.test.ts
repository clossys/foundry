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
