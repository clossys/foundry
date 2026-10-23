"use client";

const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});

import { ContactForm } from "@clossys/publisher/web/client";
import type { ContactFormProps } from "@clossys/publisher/web/client";

const form: ContactFormProps = { resolveCopyId: fixtureResolveCopy, copy: {
  topicLabel: { id: "contact.topicLabel" },
  topicPlaceholder: { id: "contact.topicPlaceholder" },
  nameLabel: { id: "contact.nameLabel" },
  emailLabel: { id: "contact.emailLabel" },
  phoneLabel: { id: "contact.phoneLabel" },
  messageLabel: { id: "contact.messageLabel" },
  submit: { id: "contact.submit" },
  submitting: { id: "contact.submitting" },
  errorSummary: { id: "contact.errorSummary" },
  topicRequired: { id: "contact.topicRequired" },
  nameRequired: { id: "contact.nameRequired" },
  emailRequired: { id: "contact.emailRequired" },
  emailInvalid: { id: "contact.emailInvalid" },
  messageRequired: { id: "contact.messageRequired" },
  sentHeading: { id: "contact.sentHeading" },
  sentBody: { id: "contact.sentBody" },
  failureLabel: { id: "contact.failureLabel" },
  invalid: { id: "contact.invalid" },
  rateLimited: { id: "contact.rateLimited" },
  unavailable: { id: "contact.unavailable" },
}, topics: [{ id: "general", label: { id: "contact.general" } }], onSubmit: async () => ({ status: "accepted" }) }; // the host's resolver, approved refs and submit transport

export function ContactFormIsland() {
  return <ContactForm {...form} />;
}

export default ContactFormIsland;
