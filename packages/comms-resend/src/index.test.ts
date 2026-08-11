import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ResendCommunicationError,
  createResendAdapter,
  verifyResendWebhook,
  type ResendClient,
} from "./index.js";

const message = {
  id: "account-invitation/user-123",
  event: "account.invitation.created",
  category: "security",
  channel: "email" as const,
  from: "sender@example.com",
  to: ["recipient@example.com"],
  cc: ["copy@example.com"],
  replyTo: ["support@example.com"],
  subject: "You are invited",
  text: "Open the invitation.",
  html: "<p>Open the invitation.</p>",
  headers: { "List-Unsubscribe": "<mailto:unsubscribe@example.com>" },
  tags: [{ name: "event.name", value: "account.invitation.created" }],
  attachments: [{ filename: "note.txt", content: new Uint8Array([104, 105]), contentType: "text/plain" }],
};

function client(
  send: ResendClient["emails"]["send"],
  verify: ResendClient["webhooks"]["verify"] = vi.fn(),
): ResendClient {
  return { emails: { send }, webhooks: { verify } };
}

describe("createResendAdapter", () => {
  it("maps a finished email, normalizes tags and forwards the stable id", async () => {
    const send = vi.fn(async () => ({ data: { id: "email-1" }, error: null }));
    const adapter = createResendAdapter({ apiKey: "test-key", createClient: () => client(send) });

    await expect(adapter.deliver(message)).resolves.toEqual({ provider: "resend", messageId: "email-1" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "sender@example.com",
        to: ["recipient@example.com"],
        cc: ["copy@example.com"],
        replyTo: ["support@example.com"],
        text: "Open the invitation.",
        html: "<p>Open the invitation.</p>",
        tags: [{ name: "event-name", value: "account-invitation-created" }],
        attachments: [{ filename: "note.txt", content: Buffer.from("hi"), contentType: "text/plain" }],
      }),
      { idempotencyKey: message.id },
    );
  });

  it("fails explicitly when the credential resolver is empty", async () => {
    const adapter = createResendAdapter({ apiKey: () => undefined });
    await expect(adapter.deliver(message)).rejects.toMatchObject({
      name: "ResendCommunicationError",
      code: "configuration_error",
      retryable: false,
    });
  });

  it("rejects tag names that collide after provider normalization", async () => {
    const send = vi.fn(async () => ({ data: { id: "email-1" }, error: null }));
    const adapter = createResendAdapter({ apiKey: "test-key", createClient: () => client(send) });
    await expect(adapter.deliver({
      ...message,
      tags: [
        { name: "event.name", value: "one" },
        { name: "event-name", value: "two" },
      ],
    })).rejects.toMatchObject({ code: "duplicate_normalized_tag", retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves provider error codes and retryability", async () => {
    const send = vi.fn(async () => ({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Slow down", statusCode: 429 },
    }));
    const adapter = createResendAdapter({ apiKey: "test-key", createClient: () => client(send) });
    await expect(adapter.deliver(message)).rejects.toMatchObject({
      code: "rate_limit_exceeded",
      statusCode: 429,
      retryable: true,
    });
  });

  it("wraps transport exceptions as retryable", async () => {
    const send = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const adapter = createResendAdapter({ apiKey: "test-key", createClient: () => client(send) });
    await expect(adapter.deliver(message)).rejects.toMatchObject({ code: "transport_error", retryable: true });
  });

  it("times out with a retry-safe idempotency key", async () => {
    const send = vi.fn(() => new Promise<never>(() => undefined));
    const adapter = createResendAdapter({
      apiKey: "test-key",
      timeoutMs: 5,
      createClient: () => client(send),
    });
    await expect(adapter.deliver(message)).rejects.toMatchObject({ code: "timeout", retryable: true });
    expect(send).toHaveBeenCalledWith(expect.any(Object), { idempotencyKey: message.id });
  });

  it("rejects ids outside the provider idempotency bound before constructing a client", async () => {
    const createClient = vi.fn();
    const adapter = createResendAdapter({ apiKey: "test-key", createClient });
    await expect(adapter.deliver({ ...message, id: "x".repeat(257) })).rejects.toBeInstanceOf(
      ResendCommunicationError,
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("verifyResendWebhook", () => {
  const headers = { id: "event-1", timestamp: "1723291200", signature: "v1,signature" };

  it("passes the exact raw body to verification and maps delivery state", async () => {
    const payload = '{"type":"email.delivered","data":{"email_id":"email-1"}}';
    const verify = vi.fn(() => ({
      type: "email.delivered",
      created_at: "2026-08-10T12:00:00.000Z",
      data: { email_id: "email-1", tags: { category: "security" } },
    }));
    const result = await verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload,
      headers,
      createClient: () => client(vi.fn(), verify),
    });

    expect(verify).toHaveBeenCalledWith({ payload, headers, webhookSecret: "test-secret" });
    expect(result).toEqual({
      kind: "delivery",
      event: {
        provider: "resend",
        eventId: "event-1",
        providerMessageId: "email-1",
        type: "delivered",
        providerType: "email.delivered",
        occurredAt: "2026-08-10T12:00:00.000Z",
        tags: { category: "security" },
      },
    });
  });

  it("verifies a valid signature through the real SDK without a sending credential", async () => {
    const payload = JSON.stringify({
      type: "email.sent",
      created_at: "2026-08-10T12:00:00.000Z",
      data: { email_id: "email-real-sdk", tags: {} },
    });
    const id = "event-real-sdk";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secretBytes = Buffer.from("local webhook verification fixture");
    const webhookSecret = `whsec_${secretBytes.toString("base64")}`;
    const signature = `v1,${createHmac("sha256", secretBytes)
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64")}`;

    await expect(verifyResendWebhook({
      webhookSecret,
      payload,
      headers: { id, timestamp, signature },
    })).resolves.toMatchObject({
      kind: "delivery",
      event: { eventId: id, providerMessageId: "email-real-sdk", type: "accepted" },
    });
  });

  it("maps received email to a privacy-minimal inbound signal", async () => {
    const verify = vi.fn(() => ({
      type: "email.received",
      created_at: "2026-08-10T12:00:00.000Z",
      data: { email_id: "email-inbound-1", from: "not-retained@example.com" },
    }));
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "raw",
      headers,
      createClient: () => client(vi.fn(), verify),
    })).resolves.toEqual({
      kind: "inbound",
      event: {
        provider: "resend",
        eventId: "event-1",
        providerMessageId: "email-inbound-1",
        channel: "email",
        occurredAt: "2026-08-10T12:00:00.000Z",
      },
    });
  });

  it("returns ignored for a verified event outside this package's ownership", async () => {
    const verify = vi.fn(() => ({ type: "domain.updated" }));
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "raw",
      headers,
      createClient: () => client(vi.fn(), verify),
    })).resolves.toEqual({ kind: "ignored", providerType: "domain.updated" });
  });

  it("acknowledges a future signed email event without requiring its payload shape", async () => {
    const verify = vi.fn(() => ({ type: "email.future_event" }));
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "raw",
      headers,
      createClient: () => client(vi.fn(), verify),
    })).resolves.toEqual({ kind: "ignored", providerType: "email.future_event" });
  });

  it("normalizes signature failures without exposing the signed body", async () => {
    const verify = vi.fn(() => {
      throw new Error("bad signature");
    });
    await expect(verifyResendWebhook({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      payload: "private raw body",
      headers,
      createClient: () => client(vi.fn(), verify),
    })).rejects.toMatchObject({ code: "invalid_webhook_signature", retryable: false });
  });
});
