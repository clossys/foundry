/** Provider-neutral communication contracts and dispatch orchestration. */
export { CommunicationDeliveryError, CommunicationValidationError } from "./errors.js";
export { createCommunicationDispatcher } from "./dispatcher.js";
export { assertValidCommunicationMessage, validateCommunicationMessage } from "./validation.js";
export type {
  CommunicationAdapter,
  CommunicationChannel,
  CommunicationDispatchLedger,
  CommunicationDispatchClaim,
  CommunicationDispatchResult,
  CommunicationDispatcher,
  CommunicationDispatcherConfig,
  CommunicationDispatchState,
  CommunicationFailure,
  CommunicationFinding,
  CommunicationMessage,
  CommunicationDuplicateClaim,
  CommunicationPolicy,
  CommunicationPolicyDecision,
  CommunicationTag,
  DeliveryEvent,
  DeliveryEventLedger,
  DeliveryEventType,
  EmailAttachment,
  EmailMessage,
  InboundCommunicationEvent,
  ProviderAcceptance,
} from "./types.js";
