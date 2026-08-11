import { CommunicationValidationError } from "./errors.js";
import type { CommunicationFinding, CommunicationMessage } from "./types.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
  for (const field of ["id", "event", "category", "from", "subject", "text"] as const) {
    if (!nonEmpty(message[field])) findings.push({ field, message: "must be a non-empty string" });
  }
  if (message.channel !== "email") findings.push({ field: "channel", message: 'must be "email"' });
  checkAddresses(findings, "to", message.to, true);
  checkAddresses(findings, "cc", message.cc, false);
  checkAddresses(findings, "bcc", message.bcc, false);
  checkAddresses(findings, "replyTo", message.replyTo, false);

  for (const [index, tag] of (message.tags ?? []).entries()) {
    if (!nonEmpty(tag.name)) findings.push({ field: `tags[${index}].name`, message: "must be non-empty" });
    if (!nonEmpty(tag.value)) findings.push({ field: `tags[${index}].value`, message: "must be non-empty" });
  }
  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    if (!nonEmpty(attachment.filename)) {
      findings.push({ field: `attachments[${index}].filename`, message: "must be non-empty" });
    }
    if (typeof attachment.content === "string" && attachment.content.length === 0) {
      findings.push({ field: `attachments[${index}].content`, message: "must be non-empty" });
    }
    if (attachment.content instanceof Uint8Array && attachment.content.byteLength === 0) {
      findings.push({ field: `attachments[${index}].content`, message: "must be non-empty" });
    }
  }
  return findings;
}

/** Throw a structured error when a message violates the core contract. */
export function assertValidCommunicationMessage(message: CommunicationMessage): void {
  const findings = validateCommunicationMessage(message);
  if (findings.length > 0) throw new CommunicationValidationError(findings);
}
