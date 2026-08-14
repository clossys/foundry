/**
 * Hand-rolled runtime type guards for the boundary where consent data
 * arrives as untyped JSON — a preference-center API route body, a value
 * read back out of a host's own storage, a webhook payload — before it is
 * safe to treat as a typed `ConsentAction`/`ConsentPolicyVersion`/
 * `GpcSignal`. No schema library; matches every other package in this
 * workspace (see root `AGENTS.md`).
 *
 * These are deliberately NOT wired into `evaluateConsent` or
 * `decideConsentChange` — both of those trust their typed parameters and
 * treat a malformed `ConsentRecord` as a type error the caller cannot
 * construct, not a runtime fallback (see `evaluateConsent`'s own doc
 * comment). Guards here exist for the layer *before* that boundary, the
 * same way `comms`'s `validateCommunicationMessage` validates a message
 * shape before anything downstream trusts it.
 */
import type { ConsentAction, ConsentCategory, ConsentPolicyVersion, GpcSignal } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isParseableTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/** A category is any non-empty string — foundry does not enumerate categories. */
export function isConsentCategory(value: unknown): value is ConsentCategory {
  return isNonEmptyString(value);
}

export function isConsentPolicyVersion(value: unknown): value is ConsentPolicyVersion {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.policyId) && isNonEmptyString(value.version);
}

/** `observedAt` must be a parseable timestamp; `present` must be a real boolean, never a truthy string or number. */
export function isGpcSignal(value: unknown): value is GpcSignal {
  if (!isRecord(value)) return false;
  return typeof value.present === "boolean" && isParseableTimestamp(value.observedAt);
}

const CONSENT_ACTION_KINDS = new Set(["grant", "deny", "withdraw"]);

/** Every `ConsentAction` variant requires `kind`, `category`, and `policyVersion` — including `withdraw`. */
export function isConsentAction(value: unknown): value is ConsentAction {
  if (!isRecord(value)) return false;
  if (typeof value.kind !== "string" || !CONSENT_ACTION_KINDS.has(value.kind)) return false;
  if (!isConsentCategory(value.category)) return false;
  return isConsentPolicyVersion(value.policyVersion);
}
