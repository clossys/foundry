import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  RESEND_DECLARED_RANGE,
  ResendMessengerError,
  createResendAdapter,
  verifyResendWebhook,
  type ResendClient,
} from "./index.js";
import { assertPeerVersion } from "../../internal/peer-version.js";
import { resolveInstalledPeerVersion } from "../../internal/resolve-installed-peer-version.js";

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

describe("the resend peer-version guard (#886)", () => {
  it("keeps RESEND_DECLARED_RANGE in sync with package.json's declared optional peer range", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(RESEND_DECLARED_RANGE).toBe(manifest.peerDependencies.resend);
    expect(manifest.peerDependenciesMeta.resend?.optional).toBe(true);
  });

  it("importing index.ts does not throw against this repository's own real installed resend (peer present)", () => {
    // index.ts calls assertPeerVersion(...) at module load time (see its
    // own header comment); this file already imported from it above, so
    // reaching this test at all is itself the assertion that it didn't
    // throw against the real resend this workspace has installed.
    expect(RESEND_DECLARED_RANGE).toBe("^6.19.0");
    expect(resolveInstalledPeerVersion("resend", import.meta.url)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names resend and the declared range when the peer is absent or incompatible", () => {
    // The other direction: the exact inputs the module-scope call would
    // have produced had resend been absent, or installed out of range.
    // This is what a consumer now sees instead of whatever the Resend SDK
    // happened to throw deep inside its own call surface.
    expect(() =>
      assertPeerVersion({ peer: "resend", declaredRange: RESEND_DECLARED_RANGE, foundVersion: undefined }),
    ).toThrow(/resend is required for this import but is not installed/);
    expect(() =>
      assertPeerVersion({ peer: "resend", declaredRange: RESEND_DECLARED_RANGE, foundVersion: "5.1.0" }),
    ).toThrow(/resend@5\.1\.0 is installed, but this package requires resend@"\^6\.19\.0"/);
  });
});
