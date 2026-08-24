import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ResendMessengerError,
  createResendAdapter,
  verifyResendWebhook,
  type ResendClient,
} from "./index.js";

const message = {
  id: "invitation-123",
  event: "account.invitation.created",
  category: "security",
  channel: "email" as const,
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "You are invited",
  text: "Open the invitation.",
  tags: [{ name: "event.name", value: "account.invitation.created" }],
  attachments: [{ filename: "note.txt", content: new Uint8Array([104, 105]), contentType: "text/plain" }],
};

function client(send: ResendClient["emails"]["send"], verify: ResendClient["webhooks"]["verify"] = vi.fn()): ResendClient {
  return { emails: { send }, webhooks: { verify } };
}

describe("Resend provider adapter", () => {
  it("maps a finished email and forwards the stable idempotency key", async () => {
    const send = vi.fn(async () => ({ data: { id: "email-1" }, error: null }));
    const adapter = createResendAdapter({ apiKey: "test-key", createClient: () => client(send) });
    await expect(adapter.deliver(message)).resolves.toEqual({ provider: "resend", messageId: "email-1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      tags: [{ name: "event-name", value: "account-invitation-created" }],
      attachments: [{ filename: "note.txt", content: Buffer.from("hi"), contentType: "text/plain" }],
    }), { idempotencyKey: message.id });
  });

  it("fails explicitly for missing configuration, bad bounds, and provider rejection", async () => {
    await expect(createResendAdapter({ apiKey: () => undefined }).deliver(message)).rejects.toMatchObject({
      code: "configuration_error",
      retryable: false,
    });
    expect(() => createResendAdapter({ apiKey: "test-key", timeoutMs: 0 })).toThrow(ResendMessengerError);
    const send = vi.fn(async () => ({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Slow down", statusCode: 429 },
    }));
    await expect(createResendAdapter({ apiKey: "test-key", createClient: () => client(send) }).deliver(message))
      .rejects.toMatchObject({ code: "rate_limit_exceeded", retryable: true, statusCode: 429 });
  });

  it("times out retryably while retaining the idempotency key", async () => {
    const send = vi.fn(() => new Promise<never>(() => undefined));
    const adapter = createResendAdapter({ apiKey: "test-key", timeoutMs: 5, createClient: () => client(send) });
    await expect(adapter.deliver(message)).rejects.toMatchObject({ code: "timeout", retryable: true });
    expect(send).toHaveBeenCalledWith(expect.any(Object), { idempotencyKey: message.id });
  });
});

describe("signed Resend delivery evidence", () => {
  const headers = { id: "event-1", timestamp: "1723291200", signature: "v1,signature" };

  it("passes the raw body to verification and normalizes a delivery event", async () => {
    const verify = vi.fn(() => ({
      type: "email.delivered",
      created_at: "2026-08-23T10:04:00.000Z",
      data: { email_id: "email-1", tags: { intent: "invitation-123" } },
    }));
    const result = await verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "raw",
      headers,
      createClient: () => client(vi.fn(), verify),
    });
    expect(verify).toHaveBeenCalledWith({ payload: "raw", headers, webhookSecret: "test-secret" });
    expect(result).toMatchObject({
      kind: "delivery",
      event: { provider: "resend", eventId: "event-1", providerMessageId: "email-1", type: "delivered" },
    });
  });

  it("verifies through the real SDK without a sending credential", async () => {
    const payload = JSON.stringify({
      type: "email.sent",
      created_at: "2026-08-23T10:04:00.000Z",
      data: { email_id: "email-real", tags: {} },
    });
    const id = "event-real";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secretBytes = Buffer.from("local messenger webhook fixture");
    const webhookSecret = `whsec_${secretBytes.toString("base64")}`;
    const signature = `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
    await expect(verifyResendWebhook({
      webhookSecret,
      payload,
      headers: { id, timestamp, signature },
    })).resolves.toMatchObject({ kind: "delivery", event: { type: "accepted" } });
  });

  it("ignores signed events outside delivery ownership and rejects bad signatures", async () => {
    const ignored = vi.fn(() => ({ type: "email.received" }));
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "raw",
      headers,
      createClient: () => client(vi.fn(), ignored),
    })).resolves.toEqual({ kind: "ignored", providerType: "email.received" });

    const invalid = vi.fn(() => { throw new Error("bad signature"); });
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "private raw body",
      headers,
      createClient: () => client(vi.fn(), invalid),
    })).rejects.toMatchObject({ code: "invalid_webhook_signature", retryable: false });
  });
});
