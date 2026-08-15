/** The only composition input shape supported by this package version. */
export const COMPOSITION_SCHEMA_VERSION = 1 as const;

/** Closed neutral plane vocabulary. Scope identity and authority remain caller-owned. */
export type CompositionPlane = "producer" | "workspace" | "repository" | "machine";

/** One exact resolution domain. Plane order never implies precedence. */
export interface CompositionScope {
  readonly plane: CompositionPlane;
  readonly id: string;
}

/** Durable caller-supplied attribution retained in every result. */
export interface CompositionProvenance {
  readonly source: string;
  readonly reference: string;
}

export interface CompositionPresenceConstraint {
  readonly kind: "present";
}

export interface CompositionOneOfConstraint {
  readonly kind: "one-of";
  readonly values: readonly string[];
}

/** Closed constraint vocabulary. Values are opaque and never interpreted. */
export type CompositionConstraint = CompositionPresenceConstraint | CompositionOneOfConstraint;

interface CompositionDeclarationBase {
  readonly id: string;
  readonly capability: string;
  readonly scope: CompositionScope;
  readonly provenance: CompositionProvenance;
}

/** A non-weakenable caller-supplied need. */
export interface CompositionRequirementDeclaration extends CompositionDeclarationBase {
  readonly kind: "requirement";
  readonly constraint: CompositionConstraint;
}

/** An authoritative constraint within the declaration's exact scope. */
export interface CompositionPolicyDeclaration extends CompositionDeclarationBase {
  readonly kind: "policy";
  readonly constraint: CompositionConstraint;
}

/** A non-binding value preference. */
export interface CompositionPreferenceDeclaration extends CompositionDeclarationBase {
  readonly kind: "preference";
  readonly value: string;
}

export type CompositionDeclaration =
  | CompositionRequirementDeclaration
  | CompositionPolicyDeclaration
  | CompositionPreferenceDeclaration;

interface CompositionCapabilitySupplyBase {
  readonly id: string;
  readonly capability: string;
  readonly scope: CompositionScope;
  readonly provenance: CompositionProvenance;
}

/** Explicit caller-normalized capability evidence. */
export type CompositionCapabilitySupply = CompositionCapabilitySupplyBase & (
  | { readonly state: "available"; readonly values: readonly string[] }
  | { readonly state: "unavailable" | "unknown"; readonly values?: never }
);

/** An explicit operator selection. The evaluator never invents one. */
export interface CompositionOperatorDecision {
  readonly id: string;
  readonly capability: string;
  readonly scope: CompositionScope;
  readonly selectedValue: string;
  readonly exceptionIds: readonly string[];
  readonly provenance: CompositionProvenance;
}

/**
 * A narrow, auditable allowance for named hard declarations. It has no effect
 * unless an operator decision references it and selects one of its values.
 */
export interface CompositionException {
  readonly id: string;
  readonly scope: CompositionScope;
  readonly targetDeclarationIds: readonly string[];
  readonly allowedValues: readonly string[];
  readonly reason: string;
  readonly reviewBy?: string;
  readonly expiresAt?: string;
  readonly provenance: CompositionProvenance;
}

/** Complete caller-owned input to the pure evaluator. */
export interface CompositionEvaluationInput {
  readonly schemaVersion: typeof COMPOSITION_SCHEMA_VERSION;
  readonly evaluatedAt: string;
  readonly declarations: readonly CompositionDeclaration[];
  readonly supplies: readonly CompositionCapabilitySupply[];
  readonly decisions: readonly CompositionOperatorDecision[];
  readonly exceptions: readonly CompositionException[];
}

export type CompositionContributorRole =
  | "requirement"
  | "policy"
  | "preference"
  | "supply"
  | "decision"
  | "exception";

/** Normalized attribution for every input that contributed to one resolution. */
export interface CompositionProvenanceEntry extends CompositionProvenance {
  readonly role: CompositionContributorRole;
  readonly id: string;
}

/** How one hard declaration relates to the selected value. */
export interface CompositionConstraintResult {
  readonly declarationId: string;
  readonly kind: "requirement" | "policy";
  readonly status: "satisfied" | "violated" | "excepted" | "unresolved";
  readonly exceptionIds: readonly string[];
  readonly provenance: CompositionProvenance;
}

/** The four valid resolution outcomes for one exact capability and scope. */
export type CompositionResolutionStatus = "effective" | "exception-mediated" | "conflicting" | "unknown";

/** One deterministic resolution with all contributing attribution. */
export interface CompositionResolution {
  readonly capability: string;
  readonly scope: CompositionScope;
  readonly status: CompositionResolutionStatus;
  readonly selectedValue?: string;
  readonly compatibleValues: readonly string[];
  readonly constraints: readonly CompositionConstraintResult[];
  readonly provenance: readonly CompositionProvenanceEntry[];
}

export type CompositionEvaluationStatus = CompositionResolutionStatus | "invalid";

export type CompositionFindingRule =
  | "input-shape"
  | "unknown-field"
  | "schema-version"
  | "evaluated-at"
  | "collection-shape"
  | "entry-shape"
  | "identifier"
  | "duplicate-identifier"
  | "capability"
  | "scope-shape"
  | "scope-plane"
  | "scope-id"
  | "provenance-shape"
  | "provenance-source"
  | "provenance-reference"
  | "declaration-kind"
  | "constraint-shape"
  | "constraint-kind"
  | "constraint-value"
  | "duplicate-constraint-value"
  | "preference-value"
  | "supply-state"
  | "supply-value"
  | "duplicate-supply-value"
  | "decision-value"
  | "duplicate-decision"
  | "exception-reference"
  | "duplicate-exception-reference"
  | "exception-target"
  | "duplicate-exception-target"
  | "exception-value"
  | "duplicate-exception-value"
  | "exception-reason"
  | "exception-review-by"
  | "exception-expires-at"
  | "orphan-supply"
  | "orphan-decision"
  | "exception-scope"
  | "exception-target-kind"
  | "composition-conflict"
  | "composition-unknown";

export interface CompositionFinding {
  readonly rule: CompositionFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

/** Complete fail-closed report. */
export interface CompositionEvaluation {
  readonly ok: boolean;
  readonly status: CompositionEvaluationStatus;
  readonly resolutions: readonly CompositionResolution[];
  readonly findings: readonly CompositionFinding[];
}
