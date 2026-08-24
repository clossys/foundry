import { Buffer } from "node:buffer";
import { Resend } from "resend";
import { MessengerDeliveryError } from "../../errors.js";
import type {
  DeliveryEvent,
  DeliveryEventType,
  EmailMessage,
  MessageAdapter,
} from "../../types.js";
import { assertValidMessage } from "../../validation.js";

export const RESEND_DECLARED_RANGE = "^6.19.0";

const PROVIDER = "resend";
const IDEMPOTENCY_KEY_MAX_LENGTH = 256;
const TAG_PART_MAX_LENGTH = 256;
const TAG_UNSAFE = /[^A-Za-z0-9_-]+/g;
const LOCAL_VERIFICATION_CLIENT_KEY = "webhook-verification-only";

export interface ResendEmailPayload {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}

export interface ResendApiError {
  message: string;
  name?: string;
  statusCode?: number | null;
}

export interface ResendClient {
  emails: {
    send(
      payload: ResendEmailPayload,
      options: { idempotencyKey: string },
    ): Promise<{ data: { id: string } | null; error: ResendApiError | null }>;
  };
  webhooks: {
    verify(input: {
      payload: string;
      headers: { id: string; timestamp: string; signature: string };
      webhookSecret: string;
    }): unknown;
  };
}

export type ResendApiKey = string | (() => string | undefined | Promise<string | undefined>);
export type ResendClientFactory = (apiKey: string) => ResendClient;
export type ResendWebhookClientFactory = (apiKey?: string) => ResendClient;

export interface ResendAdapterConfig {
  /** Required explicit credential resolver; the package never reads the environment. */
  apiKey: ResendApiKey;
  timeoutMs?: number;
  createClient?: ResendClientFactory;
}

/** These map directly to the provider's signed webhook headers. */
export interface ResendWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export interface VerifyResendWebhookInput {
  apiKey?: ResendApiKey;
  createClient?: ResendWebhookClientFactory;
  /** Exact raw request body; parsed and reserialized JSON will not verify. */
  payload: string;
  headers: ResendWebhookHeaders;
  webhookSecret: string;
}

export type ResendWebhookEvent =
  | { kind: "delivery"; event: DeliveryEvent }
  | { kind: "ignored"; providerType: string };

export class ResendMessengerError extends MessengerDeliveryError {
  readonly statusCode?: number;

  constructor(
    code: string,
    message: string,
    options: { retryable: boolean; statusCode?: number; cause?: unknown },
  ) {
    super(code, message, { retryable: options.retryable, provider: PROVIDER, cause: options.cause });
    this.name = "ResendMessengerError";
    this.statusCode = options.statusCode;
  }
}

function defaultClient(apiKey?: string): ResendClient {
  return new Resend(apiKey ?? LOCAL_VERIFICATION_CLIENT_KEY);
}

async function resolveApiKey(value: ResendApiKey): Promise<string> {
  const apiKey = typeof value === "function" ? await value() : value;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new ResendMessengerError("configuration_error", "Resend API key is not configured", { retryable: false });
  }
  return apiKey.trim();
}

function assertValidTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new ResendMessengerError(
      "configuration_error",
      "Resend timeoutMs must be a positive finite number of milliseconds",
      { retryable: false },
    );
  }
}

function normalizeTagPart(value: string, fallback: string): string {
  const normalized = value.trim().replace(TAG_UNSAFE, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (normalized || fallback).slice(0, TAG_PART_MAX_LENGTH);
}

function normalizeTags(tags: EmailMessage["tags"]): Array<{ name: string; value: string }> | undefined {
  if (tags === undefined) return undefined;
  const names = new Set<string>();
  return tags.map((tag) => {
    const name = normalizeTagPart(tag.name, "tag");
    if (names.has(name)) {
      throw new ResendMessengerError(
        "duplicate_normalized_tag",
        `Multiple email tags normalize to the provider name "${name}"`,
        { retryable: false },
      );
    }
    names.add(name);
    return { name, value: normalizeTagPart(tag.value, "empty") };
  });
}

function toPayload(message: EmailMessage): ResendEmailPayload {
  const tags = normalizeTags(message.tags);
  return {
    from: message.from,
    to: [...message.to],
    ...(message.cc?.length ? { cc: [...message.cc] } : {}),
    ...(message.bcc?.length ? { bcc: [...message.bcc] } : {}),
    ...(message.replyTo?.length ? { replyTo: [...message.replyTo] } : {}),
    subject: message.subject,
    text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
    ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
    ...(tags === undefined ? {} : { tags }),
    ...(message.attachments === undefined
      ? {}
      : {
          attachments: message.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: typeof attachment.content === "string" ? attachment.content : Buffer.from(attachment.content),
            ...(attachment.contentType === undefined ? {} : { contentType: attachment.contentType }),
          })),
        }),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ResendMessengerError("timeout", `Resend request timed out after ${timeoutMs}ms`, { retryable: true })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isRetryable(error: ResendApiError): boolean {
  return error.statusCode === 429
    || (typeof error.statusCode === "number" && error.statusCode >= 500)
    || error.name === "concurrent_idempotent_requests";
}

/** Create the strict outbound adapter for finished email messages. */
export function createResendAdapter(config: ResendAdapterConfig): MessageAdapter<EmailMessage> {
  assertValidTimeout(config.timeoutMs);
  return {
    channel: "email",
    async deliver(message) {
      assertValidMessage(message);
      if (!message.id || message.id.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        throw new ResendMessengerError(
          "invalid_idempotency_key",
          `Email message id must contain 1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters for Resend idempotency`,
          { retryable: false },
        );
      }

      const apiKey = await resolveApiKey(config.apiKey);
      let response: Awaited<ReturnType<ResendClient["emails"]["send"]>>;
      try {
        const client = (config.createClient ?? defaultClient)(apiKey);
        response = await withTimeout(
          client.emails.send(toPayload(message), { idempotencyKey: message.id }),
          config.timeoutMs,
        );
      } catch (error) {
        if (error instanceof ResendMessengerError) throw error;
        throw new ResendMessengerError("transport_error", "Resend request failed before a response was received", {
          retryable: true,
          cause: error,
        });
      }

      if (response.error) {
        throw new ResendMessengerError(response.error.name || "provider_rejected", response.error.message, {
          retryable: isRetryable(response.error),
          ...(typeof response.error.statusCode === "number" ? { statusCode: response.error.statusCode } : {}),
        });
      }
      if (!response.data?.id) {
        throw new ResendMessengerError(
          "invalid_provider_response",
          "Resend returned neither an error nor a message id",
          { retryable: true },
        );
      }
      return { provider: PROVIDER, messageId: response.data.id };
    },
  };
}

const DELIVERY_EVENT_TYPES: Readonly<Record<string, DeliveryEventType>> = {
  "email.sent": "accepted",
  "email.scheduled": "scheduled",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

type WebhookPayload = {
  type?: unknown;
  created_at?: unknown;
  data?: { email_id?: unknown; tags?: unknown };
};

function stringRecord(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Verify the exact raw signed body and normalize delivery evidence. */
export async function verifyResendWebhook(input: VerifyResendWebhookInput): Promise<ResendWebhookEvent> {
  if (!input.webhookSecret.trim()) {
    throw new ResendMessengerError("configuration_error", "Resend webhook secret is not configured", { retryable: false });
  }
  if (!input.headers.id || !input.headers.timestamp || !input.headers.signature) {
    throw new ResendMessengerError(
      "invalid_webhook_signature",
      "Resend webhook signature headers are incomplete",
      { retryable: false },
    );
  }

  const apiKey = input.apiKey === undefined ? undefined : await resolveApiKey(input.apiKey);
  let verified: unknown;
  try {
    const client = (input.createClient ?? defaultClient)(apiKey);
    verified = client.webhooks.verify({
      payload: input.payload,
      headers: input.headers,
      webhookSecret: input.webhookSecret,
    });
  } catch (error) {
    throw new ResendMessengerError(
      "invalid_webhook_signature",
      "Resend webhook signature verification failed",
      { retryable: false, cause: error },
    );
  }

  const payload = verified as WebhookPayload;
  const providerType = typeof payload?.type === "string" ? payload.type : "";
  if (!providerType) {
    throw new ResendMessengerError("invalid_webhook_payload", "Verified Resend webhook has no event type", { retryable: false });
  }
  const type = DELIVERY_EVENT_TYPES[providerType];
  if (!type) return { kind: "ignored", providerType };

  const providerMessageId = typeof payload.data?.email_id === "string" ? payload.data.email_id : "";
  const occurredAt = typeof payload.created_at === "string" ? payload.created_at : "";
  if (!providerMessageId || !occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw new ResendMessengerError("invalid_webhook_payload", "Verified Resend email event is malformed", { retryable: false });
  }
  const tags = stringRecord(payload.data?.tags);
  if (!tags) {
    throw new ResendMessengerError("invalid_webhook_payload", "Verified Resend email event has malformed tags", { retryable: false });
  }
  return {
    kind: "delivery",
    event: {
      provider: PROVIDER,
      eventId: input.headers.id,
      providerMessageId,
      type,
      providerType,
      occurredAt,
      tags,
    },
  };
}
