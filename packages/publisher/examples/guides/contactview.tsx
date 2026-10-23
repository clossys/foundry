const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});

import { ContactView } from "@clossys/publisher/web";
import type { ContactResult, ContactViewCopy, ContactViewProps } from "@clossys/publisher/web";

const brand: React.ReactNode = "Example Studio"; // the caller's brand mark, for example a Designer `Brandmark`
const resolveCopyId: ContactViewProps["resolveCopyId"] = fixtureResolveCopy; // the approved-copy resolver
const copy: ContactViewCopy = {
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
  heading: { id: "contact.heading" },
  description: { id: "contact.description" },
}; // one approved `CopyRef` per string the view shows
async function send(_values: Record<string, string>): Promise<ContactResult> { return { status: "accepted" }; } // your submit handler: a route or server action that runs `createContactHandler`'s `handle`

export function ContactPage() {
  return (
    <ContactView
      brand={brand}
      headerAction={<a href="/start">Start</a>}
      legal={{ entity: "Example Co", links: [{ label: "Privacy", href: "/privacy" }] }}
      resolveCopyId={resolveCopyId}
      copy={copy}
      topics={[
        { id: "general", label: { id: "contact.topic.general" } },
        { id: "support", label: { id: "contact.topic.support" } },
      ]}
      initialTopic="support"
      onSubmit={send}
    />
  );
}

export default ContactPage;
