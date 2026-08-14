/**
 * Consumer-defined; foundry does not enumerate categories. A category is
 * whatever a product's own policy defines ("analytics", "marketing",
 * "essential", ...) — this package only needs it to be a stable string used
 * to key one subject's consent records.
 */
export type ConsentCategory = string;

/** Identifies which version of a policy document a record answers. */
export interface ConsentPolicyVersion {
  policyId: string;
  version: string;
}

/**
 * Three states, not two. `"absent"` (never asked) is a distinct value from
 * `"denied"` (asked, refused) — collapsing them would make "never asked"
 * indistinguishable from a passing signal, the same
 * absence-of-signal-looks-like-a-passing-signal failure this workspace has
 * already written down for gate exit codes (see this repository's own
 * contribution guide, "Gate CLIs exit `0` clean...").
 * `"granted"` and `"denied"` both carry the policy version they answered and
 * when — a bare boolean cannot carry either, which is exactly what makes a
 * stored consent an unauditable guess instead of a record.
 */
export type ConsentState =
  | { kind: "absent" }
  | { kind: "denied"; policyVersion: ConsentPolicyVersion; decidedAt: string }
  | { kind: "granted"; policyVersion: ConsentPolicyVersion; decidedAt: string };

/**
 * A Global Privacy Control signal is REPRESENTED, never interpreted.
 * Whether a GPC signal legally constitutes a request is a jurisdiction
 * question this package does not answer — see the README's "Non-goals".
 * There is deliberately no function anywhere in this package that maps a
 * `GpcSignal` to a `ConsentState`, a grant, or a denial.
 */
export interface GpcSignal {
  present: boolean;
  observedAt: string;
}

export interface ConsentRecord {
  /** Host-owned identity reference — an opaque id, never raw personal data. */
  subjectId: string;
  category: ConsentCategory;
  state: ConsentState;
  gpcSignal?: GpcSignal;
}

/**
 * Host-implemented storage port. foundry does not choose cookies vs.
 * localStorage vs. a server-side session vs. a database row — that choice,
 * and its durability/consistency guarantees, belongs entirely to the host.
 * This package ships no concrete implementation of this interface.
 */
export interface ConsentStoragePort {
  read(subjectId: string, category: ConsentCategory): Promise<ConsentRecord | undefined>;
  write(record: ConsentRecord): Promise<void>;
  readAll(subjectId: string): Promise<readonly ConsentRecord[]>;
}

/**
 * The result of comparing a stored record against the policy version
 * currently in force. `"stale"` means a stored answer no longer speaks for
 * the current policy and the subject should be asked again;
 * `previousPolicyVersion` is the version the stale answer actually
 * answered, not the current one — see `evaluateConsent`'s own doc comment
 * for why `"granted"`/`"denied"` also report the version they actually
 * answered rather than always echoing back the caller's `currentPolicyVersion`.
 */
export type ConsentEvaluation =
  | { status: "absent" }
  | { status: "stale"; previousPolicyVersion: ConsentPolicyVersion }
  | { status: "granted"; policyVersion: ConsentPolicyVersion }
  | { status: "denied"; policyVersion: ConsentPolicyVersion };

/**
 * Governs whether a policy-version bump also invalidates a stored `denied`
 * record. This is issue #178's open question, and it is deliberately left
 * as a caller-supplied value with **no default** in either direction — see
 * `evaluateConsent`'s doc comment and this package's README
 * ("The denial-invalidation question") for the full reasoning. A `granted`
 * record always goes stale on a version bump regardless of this flag;
 * only the `denied` case is jurisdiction-dependent.
 */
export interface ConsentEvaluationPolicy {
  invalidateDenialOnPolicyBump: boolean;
}

/**
 * The three things a subject can do to their own consent. Every variant
 * carries the `policyVersion` in force at the moment of the action —
 * including `withdraw`. This is a deliberate divergence from issue #178's
 * illustrative `{ kind: "withdraw"; category }` (no version): see the
 * README's "Divergences from the issue's illustrative API" for why an
 * audit event with no policy version to cite would either have to guess
 * one from `current` (silently wrong when `current` is `absent`) or leave
 * the field empty (an unaudicable audit event) — requiring it here keeps
 * `decideConsentChange` pure and total without either compromise.
 */
export type ConsentAction =
  | { kind: "grant"; category: ConsentCategory; policyVersion: ConsentPolicyVersion }
  | { kind: "deny"; category: ConsentCategory; policyVersion: ConsentPolicyVersion }
  | { kind: "withdraw"; category: ConsentCategory; policyVersion: ConsentPolicyVersion };

/**
 * `"reopened"` records that a subject reopened their preference center —
 * an audit-worthy event on its own, independent of whether they changed
 * anything. `"policy-superseded"` records that a stored answer was found
 * stale by `evaluateConsent`, i.e. that a policy bump invalidated it.
 * Neither is emitted by `decideConsentChange` (which only ever emits
 * `"granted"` / `"denied"` / `"withdrawn"`) — see `recordReopened` and
 * `recordPolicySuperseded`.
 */
export type ConsentAuditEventType = "granted" | "denied" | "withdrawn" | "reopened" | "policy-superseded";

/**
 * An audit trail entry. Deliberately carries no raw personal-data field —
 * no email, no name, no IP address — only `subjectId`, the same opaque-id
 * pattern `packages/comms`'s `recipientId` already establishes. `category`
 * is a consumer-defined label (e.g. `"marketing"`), never itself personal
 * data. `src/audit-shape.check.ts` is a compile-time contract test that
 * fails the build if a personal-data-shaped key is ever added to this type.
 *
 * `previousPolicyVersion` is present only on a `"policy-superseded"` event
 * (see `recordPolicySuperseded`) — every other event type's `policyVersion`
 * fully describes which policy version the event pertains to on its own.
 */
export interface ConsentAuditEvent {
  subjectId: string;
  category: ConsentCategory;
  type: ConsentAuditEventType;
  policyVersion: ConsentPolicyVersion;
  occurredAt: string;
  gpcSignal?: GpcSignal;
  previousPolicyVersion?: ConsentPolicyVersion;
}

/**
 * Host-implemented audit ledger. Mirrors `DeliveryEventLedger` in
 * `packages/comms`: foundry decides what an audit event contains, the host
 * decides where it is durably recorded.
 */
export interface ConsentAuditLedger {
  record(event: ConsentAuditEvent): Promise<void>;
}
