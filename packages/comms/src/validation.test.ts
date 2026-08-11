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
});
