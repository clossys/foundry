/**
 * Internal barrel for the browser consent lifecycle: the record, the pure
 * decision rules and the lifecycle with its port types. It deliberately
 * reaches no adapter; the browser storage adapter lives under `adapters/`
 * and is constructed only by a host's explicit call.
 *
 * Not exported from the package root or any package subpath yet.
 */

export {
  BrowserConsentError,
  decideChoice,
  normalizeRegime,
  parseStoredChoice,
} from "./record.js";
export type {
  BrowserConsentErrorCode,
  ConsentPolicy,
  ConsentRegime,
  ConsentSignals,
  EffectiveChoice,
  StoredChoice,
  StoredInput,
} from "./record.js";
export {
  effectiveChoice,
  isAllowed,
  isLiveChoice,
  shouldApplyEvidence,
  shouldPromptAutomatically,
} from "./decision.js";
export type { SequencedChoice } from "./decision.js";
export { NO_DECISION_SNAPSHOT, createConsentLifecycle } from "./lifecycle.js";
export type {
  ConsentEvidencePort,
  ConsentLifecycle,
  ConsentLifecycleOptions,
  ConsentSnapshot,
  ConsentStoragePort,
  EvidenceResult,
  EvidenceStatus,
  StorageRead,
  StorageWrite,
} from "./lifecycle.js";
