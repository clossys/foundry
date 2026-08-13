import { describe, expect, it } from "vitest";
import type { CommunicationChannel, EmailMessage } from "./types.js";
import { validateCommunicationMessage } from "./validation.js";

const valid: EmailMessage = {
  id: "digest/2026-08-10",
  event: "digest.ready",
  category: "product",
  channel: "email",
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "Digest",
  text: "The digest is ready.",
};

describe("validateCommunicationMessage", () => {
  it("accepts a finished email", () => {
    expect(validateCommunicationMessage(valid)).toEqual([]);
  });

  it("reports empty routing, tags and attachments", () => {
    const findings = validateCommunicationMessage({
      ...valid,
      to: [""],
      tags: [{ name: "", value: "" }],
      attachments: [{ filename: "", content: new Uint8Array() }],
    });
    expect(findings.map((finding) => finding.field)).toEqual([
      "to",
      "tags[0].name",
      "tags[0].value",
      "attachments[0].filename",
      "attachments[0].content",
    ]);
  });

  it("returns findings instead of leaking type errors for malformed JavaScript input", () => {
    const findings = validateCommunicationMessage({
      ...valid,
      html: 42,
      headers: { "X-Count": 1 },
      tags: [null],
      attachments: [{ filename: "data.bin", content: null, contentType: "" }],
    } as unknown as EmailMessage);

    expect(findings).toEqual([
      { field: "html", message: "must be a string" },
      { field: "headers", message: "must be a record of string values" },
      { field: "tags[0]", message: "must be an object" },
      { field: "attachments[0].content", message: "must be a string or Uint8Array" },
      { field: "attachments[0].contentType", message: "must be a non-empty string" },
    ]);
  });

  it("reports a non-object message as a validation finding", () => {
    expect(validateCommunicationMessage(null as unknown as EmailMessage)).toEqual([
      { field: "message", message: "must be an object" },
    ]);
  });

  /**
   * `CommunicationChannel` reserves `"sms"` and `"whatsapp"` as names this
   * package's contract owns, but no message shape ships for them yet. A
   * reserved-but-unimplemented channel must not become a way to smuggle an
   * unvalidated message past this function — it must still be rejected, the
   * same as any other invalid channel value.
   */
  it("rejects a message on a reserved-but-unshipped channel instead of dispatching it silently", () => {
    const findings = validateCommunicationMessage({
      ...valid,
      channel: "sms" as CommunicationChannel,
    } as unknown as EmailMessage);
    expect(findings).toEqual([{ field: "channel", message: 'must be "email"' }]);
  });

  it("rejects an unknown, unreserved channel the same way", () => {
    const findings = validateCommunicationMessage({
      ...valid,
      channel: "carrier-pigeon",
    } as unknown as EmailMessage);
    expect(findings).toEqual([{ field: "channel", message: 'must be "email"' }]);
  });
});

/**
 * Type-level check that `CommunicationChannel` still names the reserved
 * channels even though `CommunicationMessage` only ships an email shape.
 * This never runs — a compile failure here (not a thrown error) is the
 * signal that the vocabulary regressed back to being derived from
 * `CommunicationMessage["channel"]`.
 */
function assertChannelVocabularyReserved(channel: CommunicationChannel): "email" | "sms" | "whatsapp" {
  switch (channel) {
    case "email":
      return "email";
    case "sms":
      return "sms";
    case "whatsapp":
      return "whatsapp";
  }
}
void assertChannelVocabularyReserved;
