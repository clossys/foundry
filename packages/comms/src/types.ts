/** A provider-neutral tag used to correlate sends with later delivery events. */
export interface CommunicationTag {
  name: string;
  value: string;
}

/** Attachment content stays provider-neutral until an adapter maps it. */
export interface EmailAttachment {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
}

/**
 * A finished email, ready for transport. Rendering, localization and product
 * recipient lookup happen before this boundary.
 */
export interface EmailMessage {
  /** Stable logical id. Adapters may also use it as a provider idempotency key. */
  id: string;
  /** Product event name used for policy and reporting. */
  event: string;
  /** Preference and reporting category. */
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
  tags?: readonly CommunicationTag[];
  attachments?: readonly EmailAttachment[];
  /** Host-owned identity reference; avoid raw personal data when an id will do. */
  recipientId?: string;
  /** Host-only observability context. Adapters must not send it implicitly. */
  context?: Readonly<Record<string, unknown>>;
}

/** The finished message shapes this package can dispatch today. */
export type CommunicationMessage = EmailMessage;

/**
 * Every channel this package's contract reserves. Only `email` ships a
 * message shape today; the rest are declared so that adding one later is
 * additive for consumers rather than a silent loss of exhaustiveness.
 *
 * This is declared independently of `CommunicationMessage` on purpose. It
 * used to be derived as `CommunicationMessage["channel"]`, which made it
 * exactly `"email"` — an exhaustive `switch (channel)` over that type
 * compiled today and would silently stop being exhaustive the moment a
 * second channel shipped, with no compiler error to catch it. Declaring the
 * full vocabulary up front makes that a compile error instead, at the cost
 * of `CommunicationChannel` naming channels no `CommunicationMessage` shape
 * exists for yet. `validateCommunicationMessage` still rejects any message
 * whose channel is not `"email"` at runtime — a reserved name is not a
 * shipped one, and reserving it must not open a way to smuggle an
 * unvalidated message past validation.
 */
export type CommunicationChannel = "email" | "sms" | "whatsapp";

/** Evidence that a provider accepted responsibility for a message. */
export interface ProviderAcceptance {
  provider: string;
  messageId: string;
}

/** A provider implementation for one finished communication shape. */
export interface CommunicationAdapter<Message extends CommunicationMessage = CommunicationMessage> {
  readonly channel: Message["channel"];
  deliver(message: Message): Promise<ProviderAcceptance>;
}

export type CommunicationPolicyDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; reason: string };

/** Host-owned consent, preference and sender-identity policy. */
export type CommunicationPolicy = (
  message: CommunicationMessage,
) => CommunicationPolicyDecision | Promise<CommunicationPolicyDecision>;

export type CommunicationDispatchState = "accepted" | "skipped" | "failed" | "duplicate";

export interface CommunicationFailure {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
}

interface CommunicationDispatchBase {
  messageId: string;
  event: string;
  category: string;
  channel: CommunicationChannel;
}

/**
 * Terminal result of one dispatch attempt. Accepted is not inbox delivery.
 *
 * `dispatch()` never rejects on a transport failure — a genuine send failure
 * still resolves this promise, as `state: "failed"` with a populated
 * `failure`. A resolved promise is not success. Callers must branch on
 * `state` before reading `acceptance` or treating the message as sent.
 */
export type CommunicationDispatchResult =
  | (CommunicationDispatchBase & { state: "accepted"; acceptance: ProviderAcceptance })
  | (CommunicationDispatchBase & { state: "failed"; failure: CommunicationFailure })
  | (CommunicationDispatchBase & { state: "skipped"; reason: string })
  | (CommunicationDispatchBase & { state: "duplicate"; reason: "duplicate" });

/** Opaque ownership token for one in-flight dispatch attempt. */
export interface CommunicationDispatchClaim {
  outcome: "claimed";
  leaseId: string;
}

export interface CommunicationDuplicateClaim {
  outcome: "duplicate";
}

/**
 * Durable hosts atomically claim ids before transport and record the result.
 * The implementation decides when a previously failed claim may be retried.
 */
export interface CommunicationDispatchLedger {
  claim(message: CommunicationMessage): Promise<CommunicationDispatchClaim | CommunicationDuplicateClaim>;
  complete(claim: CommunicationDispatchClaim, result: CommunicationDispatchResult): Promise<void>;
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
  /** Unique within the provider; durable keys use provider + eventId. */
  eventId: string;
  providerMessageId: string;
  type: DeliveryEventType;
  providerType: string;
  occurredAt: string;
  tags: Readonly<Record<string, string>>;
}

/** Minimal signal for a provider-received message; content retrieval is host-owned. */
export interface InboundCommunicationEvent {
  provider: string;
  eventId: string;
  providerMessageId: string;
  channel: CommunicationChannel;
  occurredAt: string;
}

/**
 * The host must atomically deduplicate, append and update current state in one
 * operation because provider webhooks are at-least-once and may be reordered.
 */
export interface DeliveryEventLedger {
  apply(event: DeliveryEvent): Promise<"applied" | "duplicate">;
}

export interface CommunicationFinding {
  field: string;
  message: string;
}

export interface CommunicationDispatcherConfig {
  adapters: Partial<Record<CommunicationChannel, CommunicationAdapter>>;
  policy?: CommunicationPolicy;
  ledger?: CommunicationDispatchLedger;
  /** Best-effort observability only; failures are ignored. */
  onResult?: (result: CommunicationDispatchResult) => void | Promise<void>;
}

export interface CommunicationDispatcher {
  /**
   * Runs policy, claim, transport and durable completion for one message.
   *
   * This promise never rejects because of a transport/adapter failure; a
   * failed send resolves with `{ state: "failed", failure }`, not a thrown
   * error. `await dispatch(message)` resolving is not evidence of success —
   * always inspect `result.state` before reading `result.acceptance` or
   * treating the message as sent. (It still throws synchronously for an
   * invalid `message`, and rejects if `ledger.complete` itself throws.)
   */
  dispatch(message: CommunicationMessage): Promise<CommunicationDispatchResult>;
}
