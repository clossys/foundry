/**
 * sections.newsletter: NewsletterBand's built-in email field and submit action, labelled from content. The submit
 * record carries the same-origin form destination; the band itself owns no network call.
 */
import type { ReactNode } from "react";
import { NewsletterBand } from "../../blocks/NewsletterBand.js";
import { object, readSectionContent, required, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const newsletterInputs: SectionRendererInputs = { slots: ["consent", "email", "submit"], members: [] };

export function renderNewsletterSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.newsletter", newsletterInputs);
  const email = object(content, required(content, "email"), "email");
  const submit = object(content, required(content, "submit"), "submit");
  return (
    <NewsletterBand
      emailLabel={text(content, email.label, "email.label")}
      privacyNote={text(content, required(content, "consent"), "consent")}
      submitLabel={text(content, submit.label, "submit.label")}
      pendingLabel={text(content, submit.pendingLabel, "submit.pendingLabel")}
      sentMessage={text(content, submit.sentMessage, "submit.sentMessage")}
      failedMessage={text(content, submit.failedMessage, "submit.failedMessage")}
      action={text(content, submit.action, "submit.action")}
    />
  );
}
