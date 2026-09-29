/**
 * Compile-time-only assertions about the contact handler's public types.
 * Named `.check.ts` rather than `.test.ts` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error` inside
 * one asserts nothing. Nothing imports this file at runtime.
 *
 * Publisher imports no Messenger code. The interfaces below are structural
 * copies of the two Messenger shapes the contact delivery port is designed to
 * be compatible with; if Messenger's real shapes drift, update the copies here
 * deliberately.
 */
import type { ContactDelivery, ContactHandlerConfig, ContactOutboundMessage, ContactResult } from "./types.js";

// --- Local structural copies of the Messenger email shapes -------------------

interface LocalMessageTag {
  name: string;
  value: string;
}

interface LocalEmailAttachment {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
}

interface LocalEmailMessage {
  id: string;
  event: string;
  category: string;
  channel: "email";
  from: string;
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  replyTo?: readonly string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Readonly<Record<string, string>>;
  tags?: readonly LocalMessageTag[];
  attachments?: readonly LocalEmailAttachment[];
  recipientId?: string;
  context?: Readonly<Record<string, unknown>>;
}

interface LocalProviderAcceptance {
  provider: string;
  messageId: string;
}

interface LocalMessageAdapter<MessageType extends LocalEmailMessage = LocalEmailMessage> {
  readonly channel: MessageType["channel"];
  deliver(message: MessageType): Promise<LocalProviderAcceptance>;
}

// --- Positive assertions ------------------------------------------------------

// A Messenger-shaped email adapter is assignable to the contact delivery port
// without a wrapper.
declare const messengerAdapter: LocalMessageAdapter<LocalEmailMessage>;
export const adapterIsADelivery: ContactDelivery = messengerAdapter;

// ...and can be placed straight into a handler config.
export const adapterFitsConfig: Pick<ContactHandlerConfig, "delivery"> = { delivery: messengerAdapter };

// The one message the handler builds is a valid Messenger email message.
declare const outbound: ContactOutboundMessage;
export const outboundIsAnEmailMessage: LocalEmailMessage = outbound;

// --- Negative assertions ------------------------------------------------------

// A delivery whose `deliver` demands an `html` body the handler never supplies
// must be refused at compile time, not accepted through method bivariance.
declare const htmlRequiringDelivery: {
  readonly channel: "email";
  readonly deliver: (message: ContactOutboundMessage & { readonly html: string }) => Promise<unknown>;
};
// @ts-expect-error a delivery that requires html cannot accept what the handler builds
export const htmlRequired: ContactDelivery = htmlRequiringDelivery;

// A delivery for another channel is not a contact delivery.
declare const smsDelivery: {
  readonly channel: "sms";
  readonly deliver: (message: ContactOutboundMessage) => Promise<unknown>;
};
// @ts-expect-error only the email channel is supported
export const wrongChannel: ContactDelivery = smsDelivery;

// An `invalid` result must carry at least one issue.
// @ts-expect-error `fields` may not be empty
export const emptyIssues: ContactResult = { status: "invalid", fields: [] };

// A field issue may only carry a code that field can produce.
// @ts-expect-error `phone` is never "required"
export const impossibleCode: ContactResult = { status: "invalid", fields: [{ field: "phone", code: "required" }] };

// The outbound message cannot carry html, extra headers, extra recipients or attachments.
// @ts-expect-error html is refused by the outbound message type
export const withHtml: ContactOutboundMessage = { ...outbound, html: "<b>x</b>" };
// @ts-expect-error bcc is refused by the outbound message type
export const withBcc: ContactOutboundMessage = { ...outbound, bcc: ["x@example.com"] };
