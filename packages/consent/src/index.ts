/**
 * @vespeneventures/consent — a provider-neutral consent record core.
 *
 * Mirrors the ownership split `packages/comms` already establishes: a pure
 * decision core (`evaluateConsent`, `decideConsentChange`) kept completely
 * separate from I/O, plus host-implemented storage and audit ports
 * (`ConsentStoragePort`, `ConsentAuditLedger`). foundry decides the record
 * shape, the tri-state model, and the audit-event vocabulary; the host
 * decides storage, transport, jurisdiction rules, and product copy.
 *
 * Zero runtime dependencies. See this package's README for the full
 * boundary, including what this package explicitly does NOT do — most
 * importantly, it makes no claim of legal compliance.
 */
export type {
  ConsentAction,
  ConsentAuditEvent,
  ConsentAuditEventType,
  ConsentAuditLedger,
  ConsentCategory,
  ConsentEvaluation,
  ConsentEvaluationPolicy,
  ConsentPolicyVersion,
  ConsentRecord,
  ConsentState,
  ConsentStoragePort,
  GpcSignal,
} from "./types.js";

export { evaluateConsent } from "./evaluate.js";
export { decideConsentChange, recordPolicySuperseded, recordReopened } from "./decide.js";
export { isConsentAction, isConsentCategory, isConsentPolicyVersion, isGpcSignal } from "./validate.js";
