import {
  CONTACT_CLIENT_KEY_MAX_LENGTH,
  CONTACT_DEFAULT_CAPS,
  STUB_CONTACT_DELIVERY,
  type ContactCaps,
  type ContactDelivery,
  type ContactFieldIssue,
  type ContactFieldName,
  type ContactHandler,
  type ContactHandlerConfig,
  type ContactOutboundMessage,
  type ContactRateLimiter,
  type ContactResult,
  type ContactTarget,
  type ContactUnavailableReason,
  type ValidatedContactSubmission,
} from "./types.js";

/**
 * Framework-neutral, server-only contact submission handler. `types.ts` is the
 * contract, including the evaluation order this file follows step for step;
 * the comments here say only why a step is written the way it is.
 */

const TARGETS: readonly string[] = ["production", "preview", "development", "test"];
const CAP_KEYS: readonly (keyof ContactCaps)[] = ["topic", "name", "email", "phone", "message", "total"];
const HONEYPOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DEFAULT_HONEYPOT = "website";

// Category Cc plus, for single-line values, the two Unicode line terminators.
// Built from escapes: a raw U+2028 or U+2029 inside a regex literal is a
// syntax error, and raw control characters would be invisible in review.
const CONTROL_SINGLE_LINE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
// The message field keeps TAB (U+0009), LF (U+000A) and CR (U+000D).
const CONTROL_MESSAGE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]");

const EMAIL_LOCAL_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const EMAIL_LOCAL_MAX_LENGTH = 64;
const PHONE_CHARS = /^[0-9 +\-().\/#*xX]+$/;
const PHONE_DIGIT = /[0-9]/;

// ---------------------------------------------------------------------------
// Construction-time validation
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new TypeError(`createContactHandler: ${message}`);
}

function requireLine(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  if (CONTROL_SINGLE_LINE.test(value)) fail(`${name} must not contain control characters`);
  return value;
}

function resolveCaps(overrides: unknown): Readonly<ContactCaps> {
  if (overrides === undefined) return CONTACT_DEFAULT_CAPS;
  if (typeof overrides !== "object" || overrides === null) fail("caps must be an object");
  const caps: { -readonly [K in keyof ContactCaps]: ContactCaps[K] } = { ...CONTACT_DEFAULT_CAPS };
  for (const key of CAP_KEYS) {
    if (!Object.hasOwn(overrides, key)) continue;
    const value: unknown = (overrides as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      fail(`caps.${key} must be a positive safe integer`);
    }
    caps[key] = value;
  }
  return Object.freeze(caps);
}

function resolveTopics(value: unknown, topicCap: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) fail("topics must be a non-empty array");
  const topics: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const topic: unknown = value[index];
    if (typeof topic !== "string" || topic.trim().length === 0) fail("each topic must be a non-blank string");
    if (CONTROL_SINGLE_LINE.test(topic)) fail("a topic must not contain control characters");
    if (topic.length > topicCap) fail("a topic is longer than the topic cap");
    if (topics.includes(topic)) fail("topics must be unique");
    topics.push(topic);
  }
  return topics;
}

function resolveRecipients(value: unknown): readonly [string, ...string[]] {
  if (!Array.isArray(value) || value.length === 0) fail("to must be a non-empty array");
  const recipients: string[] = [];
  for (let index = 0; index < value.length; index += 1) recipients.push(requireLine("each recipient", value[index]));
  return recipients as unknown as readonly [string, ...string[]];
}

function resolveHoneypot(value: unknown): string {
  if (value === undefined) return DEFAULT_HONEYPOT;
  if (typeof value !== "string" || !HONEYPOT_NAME.test(value)) {
    fail("honeypotField must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/");
  }
  const declared: readonly string[] = ["topic", "name", "email", "phone", "message"];
  if (declared.includes(value)) fail("honeypotField must not be a declared field name");
  return value;
}

function requireDelivery(value: unknown, target: ContactTarget): ContactDelivery {
  if (typeof value !== "object" || value === null) fail("delivery must be an object");
  // Presence anywhere on the prototype chain, whatever the value: the safe
  // direction for a forged or inherited brand is refusal.
  if (target === "production" && STUB_CONTACT_DELIVERY in value) {
    fail("a stub delivery is refused when target is production");
  }
  const candidate = value as { channel?: unknown; deliver?: unknown };
  if (candidate.channel !== "email") fail('delivery.channel must be "email"');
  if (typeof candidate.deliver !== "function") fail("delivery.deliver must be a function");
  return value as ContactDelivery;
}

function requireLimiter(value: unknown): ContactRateLimiter {
  if (typeof value !== "object" || value === null || typeof (value as { check?: unknown }).check !== "function") {
    fail("limiter.check must be a function");
  }
  return value as ContactRateLimiter;
}

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

type FieldOutcome = { readonly issue: ContactFieldIssue["code"] | undefined; readonly value: string | undefined };

/** Reads only own properties; a value that is not a plain record reads as empty. */
function readOwn(record: object | undefined, key: string): unknown {
  if (record === undefined || !Object.hasOwn(record, key)) return undefined;
  return (record as Record<string, unknown>)[key];
}

function isEmailShape(email: string): boolean {
  const at = email.indexOf("@");
  if (at === -1 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || local.length > EMAIL_LOCAL_MAX_LENGTH) return false;
  // Splitting on "." and testing each atom rejects leading, trailing and
  // doubled dots without a single backtracking pattern over the whole part.
  if (!local.split(".").every((atom) => EMAIL_LOCAL_ATOM.test(atom))) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => EMAIL_LABEL.test(label));
}

function isPhoneShape(phone: string): boolean {
  return PHONE_CHARS.test(phone) && PHONE_DIGIT.test(phone);
}

/**
 * One field's checks, in the documented order, stopping at the first failure:
 * not-a-string, too-long, control-character, required, shape. Length is checked
 * before any scan so later checks cost at most the cap.
 */
function checkField(
  field: ContactFieldName,
  raw: unknown,
  cap: number,
  topics: readonly string[],
): FieldOutcome & { readonly length: number } {
  if (raw === undefined) {
    return { issue: field === "phone" ? undefined : "required", value: undefined, length: 0 };
  }
  if (typeof raw !== "string") return { issue: "not-a-string", value: undefined, length: 0 };
  const length = raw.length;
  if (length > cap) return { issue: "too-long", value: undefined, length };
  const control = field === "message" ? CONTROL_MESSAGE : CONTROL_SINGLE_LINE;
  if (control.test(raw)) return { issue: "control-character", value: undefined, length };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { issue: field === "phone" ? undefined : "required", value: undefined, length };

  switch (field) {
    case "topic":
      // Exact match against the raw value: no trim, no case folding.
      return topics.includes(raw)
        ? { issue: undefined, value: raw, length }
        : { issue: "unknown-topic", value: undefined, length };
    case "email":
      return isEmailShape(trimmed)
        ? { issue: undefined, value: trimmed, length }
        : { issue: "malformed", value: undefined, length };
    case "phone":
      return isPhoneShape(trimmed)
        ? { issue: undefined, value: trimmed, length }
        : { issue: "malformed", value: undefined, length };
    case "message":
      return { issue: undefined, value: trimmed.replace(/\r\n?/g, "\n"), length };
    default:
      return { issue: undefined, value: trimmed, length };
  }
}

const FIELD_ORDER: readonly ContactFieldName[] = ["topic", "name", "email", "phone", "message"];

function validateSubmission(
  record: object | undefined,
  caps: Readonly<ContactCaps>,
  topics: readonly string[],
): { readonly issues: ContactFieldIssue[]; readonly submission: ValidatedContactSubmission | undefined } {
  const issues: ContactFieldIssue[] = [];
  const values: Partial<Record<ContactFieldName, string>> = {};
  let total = 0;
  for (const field of FIELD_ORDER) {
    const outcome = checkField(field, readOwn(record, field), caps[field], topics);
    total += outcome.length;
    if (outcome.issue !== undefined) {
      issues.push({ field, code: outcome.issue } as ContactFieldIssue);
    } else if (outcome.value !== undefined) {
      values[field] = outcome.value;
    }
  }
  if (total > caps.total) issues.push({ field: "submission", code: "too-long" });
  if (issues.length > 0) return { issues, submission: undefined };
  return {
    issues,
    submission: {
      topic: values.topic,
      name: values.name,
      email: values.email,
      phone: values.phone,
      message: values.message,
    } as ValidatedContactSubmission,
  };
}

function buildText(submission: ValidatedContactSubmission): string {
  const lines = [`Topic: ${submission.topic}`, `Name: ${submission.name}`, `Email: ${submission.email}`];
  if (submission.phone !== undefined) lines.push(`Phone: ${submission.phone}`);
  lines.push("", submission.message);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/**
 * Builds a contact handler. Validates the whole configuration and throws
 * synchronously on any violation, so a handler that exists is correctly
 * configured. The config is read once: later mutation of the object or its
 * arrays does not change the handler.
 */
export function createContactHandler(config: ContactHandlerConfig): ContactHandler {
  if (typeof config !== "object" || config === null) fail("config must be an object");

  const target: unknown = config.target;
  if (typeof target !== "string" || !TARGETS.includes(target)) {
    fail("target must be production, preview, development or test");
  }
  const delivery = requireDelivery(config.delivery, target as ContactTarget);
  const limiter = requireLimiter(config.limiter);
  const caps = resolveCaps(config.caps);
  const topics = resolveTopics(config.topics, caps.topic);
  const from = requireLine("from", config.from);
  const to = resolveRecipients(config.to);
  const subject = requireLine("subject", config.subject);
  if (subject.trim().length === 0) fail("subject must not be blank");
  const honeypotField = resolveHoneypot(config.honeypotField);

  const createMessageId: unknown = config.createMessageId;
  if (createMessageId !== undefined && typeof createMessageId !== "function") {
    fail("createMessageId must be a function");
  }
  const messageId = (createMessageId as (() => string) | undefined) ?? (() => crypto.randomUUID());

  const observer: unknown = config.onUnavailable;
  if (observer !== undefined && typeof observer !== "function") fail("onUnavailable must be a function");
  const onUnavailable = observer as ((reason: ContactUnavailableReason) => void) | undefined;

  /** The one undifferentiated client answer; the cause goes to the observer as a code. */
  function unavailable(reason: ContactUnavailableReason): ContactResult {
    try {
      const returned: unknown = onUnavailable?.(reason);
      // An observer that returns a rejecting promise must not become an unhandled rejection.
      if (typeof (returned as { then?: unknown } | undefined)?.then === "function") {
        void Promise.resolve(returned).catch(() => undefined);
      }
    } catch {
      // The observer's own failure never changes the result.
    }
    return { status: "unavailable" };
  }

  async function run(submission: unknown, options: unknown): Promise<ContactResult> {
    // 1. Client key. Refused before anything else runs.
    const clientKey: unknown =
      typeof options === "object" && options !== null ? (options as { clientKey?: unknown }).clientKey : undefined;
    if (
      typeof clientKey !== "string" ||
      clientKey.length > CONTACT_CLIENT_KEY_MAX_LENGTH ||
      clientKey.trim().length === 0
    ) {
      return unavailable("client-key");
    }

    // Anything that is not a non-null, non-array object reads as an empty record.
    const record =
      typeof submission === "object" && submission !== null && !Array.isArray(submission) ? submission : undefined;

    // 2. Honeypot: filled is anything but undefined, null or "".
    const trap = readOwn(record, honeypotField);
    if (trap !== undefined && trap !== null && trap !== "") return { status: "accepted" };

    // 3. Validation, before the limiter so a typo does not burn an allowance.
    const validated = validateSubmission(record, caps, topics);
    if (validated.submission === undefined) {
      return { status: "invalid", fields: validated.issues as unknown as [ContactFieldIssue, ...ContactFieldIssue[]] };
    }

    // 4. Limiter: only exactly true proceeds.
    let answer: unknown;
    try {
      answer = await limiter.check(clientKey);
    } catch {
      return unavailable("limiter-failed");
    }
    if (answer === false) return { status: "rate-limited" };
    if (answer !== true) return unavailable("limiter-non-boolean");

    // 5. Build and deliver, once, with no retry.
    let id: unknown;
    try {
      id = messageId();
    } catch {
      return unavailable("message-id-failed");
    }
    if (typeof id !== "string" || id.length === 0) return unavailable("message-id-failed");

    const message: ContactOutboundMessage = {
      id,
      event: "publisher.contact.submitted",
      category: "contact",
      channel: "email",
      from,
      to: [...to],
      replyTo: [validated.submission.email],
      subject,
      text: buildText(validated.submission),
    };
    try {
      await delivery.deliver(message);
    } catch {
      return unavailable("delivery-failed");
    }
    return { status: "accepted" };
  }

  return {
    async handle(submission, options) {
      try {
        return await run(submission, options);
      } catch {
        // Nothing may escape handle(); an unexpected failure is unavailable too.
        return unavailable("internal-error");
      }
    },
  };
}
