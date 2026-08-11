import { CommunicationValidationError } from "./errors.js";
import type { CommunicationFinding, CommunicationMessage } from "./types.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function checkAddresses(
  findings: CommunicationFinding[],
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

/** Validate the provider-neutral message contract without doing I/O. */
export function validateCommunicationMessage(message: CommunicationMessage): CommunicationFinding[] {
  const findings: CommunicationFinding[] = [];
  if (!message || typeof message !== "object") {
    return [{ field: "message", message: "must be an object" }];
  }
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

/** Throw a structured error when a message violates the core contract. */
export function assertValidCommunicationMessage(message: CommunicationMessage): void {
  const findings = validateCommunicationMessage(message);
  if (findings.length > 0) throw new CommunicationValidationError(findings);
}
