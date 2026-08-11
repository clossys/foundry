import { describe, expect, it } from "vitest";
import type { EmailMessage } from "./types.js";
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
});
