/** A provider-neutral tag used to correlate a finished message with outcome evidence. */
export interface MessageTag {
  name: string;
  value: string;
}

/** Attachment content stays provider-neutral until an adapter maps it. */
export interface EmailAttachment {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
}

/** A finished email. Rendering, localization, and recipient selection happen upstream. */
export interface EmailMessage {
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
  tags?: readonly MessageTag[];
  attachments?: readonly EmailAttachment[];
  recipientId?: string;
  context?: Readonly<Record<string, unknown>>;
}

export type Message = EmailMessage;
export type MessageChannel = Message["channel"];

/** Durable evidence that an upstream authority approved this exact delivery intent. */
export interface AuthorizationEvidence {
  id: string;
  /** The exact stable message/intent id this evidence authorizes. */
  intentId: string;
  policy: string;
  authorizedAt: string;
}

/** A finished, authorized message and its declared delivery window. */
export interface DeliveryIntent {
  message: Message;
  authorization: AuthorizationEvidence;
  windowOpensAt: string;
  windowClosesAt: string;
}

export interface ProviderAcceptance {
  provider: string;
  messageId: string;
}

export interface MessageAdapter<MessageType extends Message = Message> {
  readonly channel: MessageType["channel"];
  deliver(message: MessageType): Promise<ProviderAcceptance>;
}

export type AuthorizationDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; reason: string };

/** Required current-policy judgment. Carried evidence is never a default allow. */
export type AuthorizationPolicy = (
  intent: DeliveryIntent,
) => AuthorizationDecision | Promise<AuthorizationDecision>;

export interface DeliveryFailure {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
}

interface DispatchBase {
  intentId: string;
  event: string;
  category: string;
  channel: MessageChannel;
}

/** Provider acceptance is transport evidence, not verified recipient delivery. */
export type DispatchResult =
  | (DispatchBase & { state: "accepted"; acceptance: ProviderAcceptance })
  | (DispatchBase & { state: "failed"; failure: DeliveryFailure })
  | (DispatchBase & { state: "skipped"; reason: string })
  | (DispatchBase & { state: "duplicate"; reason: "duplicate" });

export interface DispatchClaim {
  outcome: "claimed";
  leaseId: string;
}

export interface DuplicateClaim {
  outcome: "duplicate";
}

/** Hosts must atomically claim intent ids and durably complete every claimed result. */
export interface DispatchLedger {
  claim(intent: DeliveryIntent): Promise<DispatchClaim | DuplicateClaim>;
  complete(claim: DispatchClaim, result: DispatchResult): Promise<void>;
}

export interface MessengerConfig {
  adapters: Partial<Record<MessageChannel, MessageAdapter>>;
  policy: AuthorizationPolicy;
  ledger: DispatchLedger;
  onResult?: (result: DispatchResult) => void | Promise<void>;
}

export interface Messenger {
  dispatch(intent: DeliveryIntent): Promise<DispatchResult>;
}

export type DeliveryEventType =
  | "accepted"
  | "scheduled"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed"
  | "suppressed"
  | "opened"
  | "clicked";

/** Provider webhook data normalized without retaining recipient addresses. */
export interface DeliveryEvent {
  provider: string;
  eventId: string;
  providerMessageId: string;
  type: DeliveryEventType;
  providerType: string;
  occurredAt: string;
  tags: Readonly<Record<string, string>>;
}

/** The host atomically deduplicates, appends, and updates outcome state. */
export interface DeliveryEventLedger {
  apply(event: DeliveryEvent): Promise<"applied" | "duplicate">;
}

export interface ValidationFinding {
  field: string;
  message: string;
}

export interface DeliveryObservation {
  eventId: string;
  /** Host-declared independent outcome source, such as a signed provider webhook. */
  evidenceSource: string;
  outcome: "delivered" | "failed";
  observedAt: string;
  deliveredAt?: string;
}

export interface DeliveryClosureRecord {
  intentId: string;
  /** Full evidence proving that this exact intent was authorized. */
  authorization: AuthorizationEvidence;
  windowOpensAt: string;
  windowClosesAt: string;
  observation?: DeliveryObservation;
}

export interface DeliveryClosureInput {
  evaluatedAt: string;
  setpoint: number;
  records: readonly DeliveryClosureRecord[];
}

export interface DeliveryClosureResult {
  state: "satisfied" | "violated" | "indeterminate";
  metric: "timely-verified-delivery-rate";
  numerator: number;
  denominator: number;
  value: number | null;
  setpoint: number;
  missingIntentIds: readonly string[];
  lateIntentIds: readonly string[];
  failedIntentIds: readonly string[];
  detail: string;
}
