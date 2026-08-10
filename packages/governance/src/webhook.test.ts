import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook.js";

describe("verifyWebhookSignature", () => {
  const payload = new TextEncoder().encode('{"action":"opened"}');
  const secret = "test-secret-material";
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

  it("accepts a valid GitHub sha256 HMAC", () => {
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("fails closed for absent, malformed, and mismatched signatures", () => {
    expect(verifyWebhookSignature(payload, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(payload, "sha1=abc", secret)).toBe(false);
    expect(verifyWebhookSignature(payload, `sha256=${"0".repeat(64)}`, secret)).toBe(false);
  });
});
