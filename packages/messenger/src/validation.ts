import { MessengerValidationError } from "./errors.js";
import type { DeliveryIntent, Message, ValidationFinding } from "./types.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validInstant(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function stringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function checkAddresses(
  findings: ValidationFinding[],
  field: string,
  value: readonly string[] | undefined,
  required: boolean,
): void {
  if (value === undefined) {
    if (required) findings.push({ field, message: "must contain at least one address" });
    return;
  }
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((address) => !nonEmpty(address))) {
    findings.push({ field, message: "must contain only non-empty addresses" });
  }
}

/** Validate a finished provider-neutral message without doing I/O. */
export function validateMessage(message: Message): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!message || typeof message !== "object") return [{ field: "message", message: "must be an object" }];

  for (const field of ["id", "event", "category", "from", "subject", "text"] as const) {
    if (!nonEmpty(message[field])) findings.push({ field, message: "must be a non-empty string" });
  }
  if (message.channel !== "email") findings.push({ field: "channel", message: 'must be "email"' });
  checkAddresses(findings, "to", message.to, true);
  checkAddresses(findings, "cc", message.cc, false);
  checkAddresses(findings, "bcc", message.bcc, false);
  checkAddresses(findings, "replyTo", message.replyTo, false);

  if (message.html !== undefined && typeof message.html !== "string") {
    findings.push({ field: "html", message: "must be a string" });
  }
  if (message.headers !== undefined && !stringRecord(message.headers)) {
    findings.push({ field: "headers", message: "must be a record of string values" });
  }
  if (message.tags !== undefined && !Array.isArray(message.tags)) {
    findings.push({ field: "tags", message: "must be an array" });
  } else {
    for (const [index, tag] of (message.tags ?? []).entries()) {
      if (!tag || typeof tag !== "object") {
        findings.push({ field: `tags[${index}]`, message: "must be an object" });
        continue;
      }
      if (!nonEmpty(tag.name)) findings.push({ field: `tags[${index}].name`, message: "must be non-empty" });
      if (!nonEmpty(tag.value)) findings.push({ field: `tags[${index}].value`, message: "must be non-empty" });
    }
  }
  if (message.attachments !== undefined && !Array.isArray(message.attachments)) {
    findings.push({ field: "attachments", message: "must be an array" });
  } else {
    for (const [index, attachment] of (message.attachments ?? []).entries()) {
      if (!attachment || typeof attachment !== "object") {
        findings.push({ field: `attachments[${index}]`, message: "must be an object" });
        continue;
      }
      if (!nonEmpty(attachment.filename)) {
        findings.push({ field: `attachments[${index}].filename`, message: "must be non-empty" });
      }
      if (
        (typeof attachment.content === "string" && attachment.content.length === 0)
        || (attachment.content instanceof Uint8Array && attachment.content.byteLength === 0)
      ) {
        findings.push({ field: `attachments[${index}].content`, message: "must be non-empty" });
      } else if (typeof attachment.content !== "string" && !(attachment.content instanceof Uint8Array)) {
        findings.push({ field: `attachments[${index}].content`, message: "must be a string or Uint8Array" });
      }
      if (attachment.contentType !== undefined && !nonEmpty(attachment.contentType)) {
        findings.push({ field: `attachments[${index}].contentType`, message: "must be a non-empty string" });
      }
    }
  }
  return findings;
}

export function assertValidMessage(message: Message): void {
  const findings = validateMessage(message);
  if (findings.length > 0) throw new MessengerValidationError("Message", findings);
}

/** Validate the authorization evidence and delivery window around a finished message. */
export function validateDeliveryIntent(intent: DeliveryIntent): ValidationFinding[] {
  if (!intent || typeof intent !== "object") return [{ field: "intent", message: "must be an object" }];
  const findings = validateMessage(intent.message).map((finding) => ({
    field: `message.${finding.field}`,
    message: finding.message,
  }));
  if (!intent.authorization || typeof intent.authorization !== "object") {
    findings.push({ field: "authorization", message: "must be an evidence object" });
  } else {
    if (!nonEmpty(intent.authorization.id)) findings.push({ field: "authorization.id", message: "must be non-empty" });
    if (!nonEmpty(intent.authorization.intentId)) {
      findings.push({ field: "authorization.intentId", message: "must be non-empty" });
    } else if (intent.authorization.intentId !== intent.message.id) {
      findings.push({ field: "authorization.intentId", message: "must equal message.id" });
    }
    if (!nonEmpty(intent.authorization.policy)) {
      findings.push({ field: "authorization.policy", message: "must be non-empty" });
    }
    if (!validInstant(intent.authorization.authorizedAt)) {
      findings.push({ field: "authorization.authorizedAt", message: "must be a valid timestamp" });
    }
  }
  if (!validInstant(intent.windowOpensAt)) {
    findings.push({ field: "windowOpensAt", message: "must be a valid timestamp" });
  }
  if (!validInstant(intent.windowClosesAt)) {
    findings.push({ field: "windowClosesAt", message: "must be a valid timestamp" });
  }
  if (
    validInstant(intent.windowOpensAt)
    && validInstant(intent.windowClosesAt)
    && Date.parse(intent.windowClosesAt) < Date.parse(intent.windowOpensAt)
  ) {
    findings.push({ field: "windowClosesAt", message: "must not precede windowOpensAt" });
  }
  return findings;
}

export function assertValidDeliveryIntent(intent: DeliveryIntent): void {
  const findings = validateDeliveryIntent(intent);
  if (findings.length > 0) throw new MessengerValidationError("Delivery intent", findings);
}
