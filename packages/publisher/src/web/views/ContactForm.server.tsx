import { RenderError } from "../../internal/errors.js";
import type { ContactFormProps } from "./ContactForm.js";

/** Same client-boundary contract as SignInForm and ActivateForm. */
export function ContactForm(props: ContactFormProps): never;
export function ContactForm<Honeypot extends string>(props: ContactFormProps<Honeypot> & { honeypotField: Honeypot }): never;
export function ContactForm(_props: ContactFormProps | (ContactFormProps<string> & { honeypotField: string })): never {
  throw new RenderError("wrong-channel", "ContactForm is a client component and cannot render under react-server; render it from a client module.");
}
