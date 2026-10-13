/** Compile-time contact contracts; included in the package's typecheck. */
import { ContactForm } from "./ContactForm.js";
import type { ContactFormCopy, ContactFormProps, ContactFormValues } from "./ContactForm.js";

declare const props: ContactFormProps;
declare const values: ContactFormValues;
declare const custom: ContactFormValues<"url">;

export const defaultForm = <ContactForm {...props} />;
export const defaultHoneypot: string = values.website;
export const customHoneypot: string = custom.url;
// @ts-expect-error a submission has only the declared fields and its honeypot
export const extraValue = values.unlisted;
// @ts-expect-error a custom honeypot replaces the default key
export const wrongHoneypot = custom.website;
// @ts-expect-error the result union is closed
export const unknownResult = <ContactForm {...props} onSubmit={async () => ({ status: "unknown" })} />;
// @ts-expect-error preview states are closed
export const unknownPreview = <ContactForm {...props} devPreview="unknown" />;
// @ts-expect-error the form owns no frame or arbitrary HTML props
export const frameRole = <ContactForm {...props} role="main" />;
// @ts-expect-error callers cannot override the native submission method
export const methodOverride = <ContactForm {...props} method="get" />;
// @ts-expect-error callers cannot set a native submission destination
export const actionOverride = <ContactForm {...props} action="/other" />;
declare const customBase: Omit<ContactFormProps<"url">, "honeypotField">;
// @ts-expect-error a caller must name a custom honeypot
export const missingCustomHoneypot: ContactFormProps<"url"> = customBase;
// @ts-expect-error approved form copy requires every declared key
export const missingCopy: ContactFormCopy = { submit: { id: "submit" } };
declare const withoutTopicLabel: Omit<ContactFormCopy, "topicLabel">;
// @ts-expect-error every copy key is required
export const missingTopicLabel: ContactFormCopy = withoutTopicLabel;

export const customForm = <ContactForm {...props} honeypotField="url" onSubmit={async (submission) => {
  const url: string = submission.url;
  void url;
  // @ts-expect-error the literal honeypot key closes the submission shape
  void submission.website;
  return { status: "accepted" };
}} />;
