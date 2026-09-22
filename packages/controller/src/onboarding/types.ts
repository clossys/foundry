/**
 * First-day onboarding: vocabulary only.
 *
 * Every type here describes ORCHESTRATION — which roles a deterministic rule
 * opened, what each role's own assessment surface was, and what that surface
 * returned. Nothing here describes the CONTENT of an assessment. That is
 * deliberate and load-bearing: a role's assessment is typed `unknown` in this
 * module, so the orchestration has no type-level vocabulary with which to
 * author one. It can carry a role's answer; it cannot write one.
 */

/** Consumer-declared subjects that open the direction role. */
export const DIRECTION_SUBJECTS = Object.freeze(["business-model", "value-formula", "northstars", "causal-metric-tree"] as const);
/** Consumer-declared subjects that open the operating-system mapping role. */
export const ARCHITECTURE_SUBJECTS = Object.freeze(["ontology", "repository-topology"] as const);

export type DirectionSubject = (typeof DIRECTION_SUBJECTS)[number];
export type ArchitectureSubject = (typeof ARCHITECTURE_SUBJECTS)[number];

/**
 * The deterministic selection rules. Each is a predicate over declared
 * consumer facts, never a judgement: an engagement that declares the same
 * facts always opens the same roles, whoever runs it.
 */
export const SELECTION_RULES = Object.freeze([
  "engagement-baseline",
  "unresolved-direction",
  "unmapped-operating-system",
  "independent-outcome",
  "consumer-requested",
] as const);
export type SelectionRule = (typeof SELECTION_RULES)[number];

/** The single exclusion reason. There is exactly one, because exclusion is the absence of a rule, not an opinion. */
export const NO_RULE_OPENED = "no-selection-rule-opened-this-role";

export type RoleSelectionOutcome = "selected" | "excluded";
export interface RoleSelection {
  readonly role: string;
  readonly outcome: RoleSelectionOutcome;
  readonly rule: SelectionRule | typeof NO_RULE_OPENED;
}

/** The one invocation shape v1 supports: one caller-owned JSON file in, one JSON report out, ternary exit. */
export const ASSESSMENT_INVOCATION_KINDS = Object.freeze(["single-json-input"] as const);
export type AssessmentInvocationKind = (typeof ASSESSMENT_INVOCATION_KINDS)[number];

/** Why a role exposes no usable assessment surface. Each value is a determinate observation, never a silent skip. */
export const ASSESSMENT_SURFACE_ABSENCES = Object.freeze([
  "package-not-installed",
  "manifest-unreadable",
  "no-assessment-declaration",
  "invalid-assessment-declaration",
  "undeclared-assessment-bin",
  "assessment-executable-missing",
] as const);
export type AssessmentSurfaceAbsence = (typeof ASSESSMENT_SURFACE_ABSENCES)[number];

/** Why a discovered surface produced no usable answer. Distinct from absence: the surface existed. */
export const ASSESSMENT_INVOCATION_FAILURES = Object.freeze([
  "assessment-input-missing",
  "assessment-not-executed",
  "assessment-output-unreadable",
  "assessment-exit-inconsistent",
  "assessment-timed-out",
] as const);
export type AssessmentInvocationFailure = (typeof ASSESSMENT_INVOCATION_FAILURES)[number];

/** A role-owned assessment entry point, as the role's own installed manifest declares it. */
export interface AssessmentSurface {
  readonly role: string;
  readonly version: string;
  readonly bin: string;
  readonly invocation: AssessmentInvocationKind;
  readonly executable: string;
}

/** One role's discovery result. Exactly one of `surface` and `absence` is non-null. */
export interface AssessmentSurfaceDiscovery {
  readonly role: string;
  readonly surface: AssessmentSurface | null;
  readonly absence: AssessmentSurfaceAbsence | null;
}

/**
 * The extended `foundry` manifest block (docs/contracts/package-framework.json,
 * issue #1172): `intake`, `outputs`, `status`, and `fit`, discovered from the
 * installed manifest exactly the way `assessment` already is -- never
 * inferred, and an absence is reported rather than guessed.
 */

/** Why a role exposes no usable intake surface. */
export const INTAKE_SURFACE_ABSENCES = Object.freeze([
  "package-not-installed",
  "manifest-unreadable",
  "no-intake-declaration",
  "invalid-intake-declaration",
  "intake-file-missing",
] as const);
export type IntakeSurfaceAbsence = (typeof INTAKE_SURFACE_ABSENCES)[number];

/** A role-owned intake-question-cards file, as the role's own installed manifest declares it. */
export interface IntakeSurface {
  readonly role: string;
  readonly version: string;
  readonly path: string;
  readonly file: string;
}

export interface IntakeSurfaceDiscovery {
  readonly role: string;
  readonly surface: IntakeSurface | null;
  readonly absence: IntakeSurfaceAbsence | null;
}

/** Why a role exposes no usable fit-signal surface. */
export const FIT_SURFACE_ABSENCES = Object.freeze([
  "package-not-installed",
  "manifest-unreadable",
  "no-fit-declaration",
  "invalid-fit-declaration",
  "fit-file-missing",
] as const);
export type FitSurfaceAbsence = (typeof FIT_SURFACE_ABSENCES)[number];

/** A role-owned fit-signal-declarations file, as the role's own installed manifest declares it. */
export interface FitSurface {
  readonly role: string;
  readonly version: string;
  readonly path: string;
  readonly file: string;
}

export interface FitSurfaceDiscovery {
  readonly role: string;
  readonly surface: FitSurface | null;
  readonly absence: FitSurfaceAbsence | null;
}

/** Why a role exposes no usable status surface. Same vocabulary shape as assessment's. */
export const STATUS_SURFACE_ABSENCES = Object.freeze([
  "package-not-installed",
  "manifest-unreadable",
  "no-status-declaration",
  "invalid-status-declaration",
  "undeclared-status-bin",
  "status-executable-missing",
] as const);
export type StatusSurfaceAbsence = (typeof STATUS_SURFACE_ABSENCES)[number];

/** A role-owned read-only status probe, as the role's own installed manifest declares it. */
export interface StatusSurface {
  readonly role: string;
  readonly version: string;
  readonly bin: string;
  readonly invocation: AssessmentInvocationKind;
  readonly executable: string;
}

export interface StatusSurfaceDiscovery {
  readonly role: string;
  readonly surface: StatusSurface | null;
  readonly absence: StatusSurfaceAbsence | null;
}

/** Why a role has no usable outputs declaration. */
export const OUTPUTS_DECLARATION_ABSENCES = Object.freeze([
  "package-not-installed",
  "manifest-unreadable",
  "no-outputs-declaration",
  "invalid-outputs-declaration",
  "output-path-outside-role-folder",
] as const);
export type OutputsDeclarationAbsence = (typeof OUTPUTS_DECLARATION_ABSENCES)[number];

/** The paths a role declares it owns, all under its own `clossys/<role>/` folder (issue #1171). */
export interface OutputsDeclaration {
  readonly role: string;
  readonly version: string;
  readonly paths: readonly string[];
}

export interface OutputsDeclarationDiscovery {
  readonly role: string;
  readonly declaration: OutputsDeclaration | null;
  readonly absence: OutputsDeclarationAbsence | null;
}

/**
 * One observation of a role's own assessment. `assessment` is whatever the
 * role returned, carried by reference and never rewritten.
 */
export interface RoleAssessmentObservation {
  readonly role: string;
  readonly surface: AssessmentSurface | null;
  readonly absence: AssessmentSurfaceAbsence | null;
  readonly failure: AssessmentInvocationFailure | null;
  readonly exitCode: number | null;
  readonly assessment: unknown;
}

export const ASSESSMENT_OUTCOMES = Object.freeze([
  "assessment-returned",
  "assessment-violated",
  "assessment-indeterminate",
  "no-assessment-surface",
  "assessment-not-returned",
] as const);
export type AssessmentOutcome = (typeof ASSESSMENT_OUTCOMES)[number];

export interface RoleAssessmentRecord {
  readonly role: string;
  readonly outcome: AssessmentOutcome;
  readonly surface: AssessmentSurface | null;
  readonly absence: AssessmentSurfaceAbsence | null;
  readonly failure: AssessmentInvocationFailure | null;
  readonly exitCode: number | null;
  /** Exactly the value the role returned, by reference. `undefined` when the role returned nothing. */
  readonly assessment: unknown;
}

/** A selected role that produced no assessment. Always present in the report; never elided. */
export interface OnboardingGap {
  readonly role: string;
  readonly reason: AssessmentSurfaceAbsence | AssessmentInvocationFailure;
}

export interface OnboardingFinding {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

export type OnboardingState = "satisfied" | "violated" | "indeterminate";

export interface OnboardingEngagement {
  readonly id: string;
  readonly decisionOwner: string;
}

export interface OnboardingRequest {
  readonly schemaVersion: 1;
  readonly engagement: OnboardingEngagement;
  readonly unresolved: readonly DirectionSubject[];
  readonly unmapped: readonly ArchitectureSubject[];
  readonly candidateRoles: readonly string[];
}

/**
 * The orchestration's own output: the JOIN. Which roles a rule opened, what
 * each role's surface was, what it returned, and what could not be observed.
 * It carries no baseline, no target, no gap analysis and no recommendation of
 * its own — those belong to the roles and appear only inside `assessment`.
 */
export interface OnboardingRun {
  readonly schemaVersion: 1;
  readonly state: OnboardingState;
  readonly engagement: OnboardingEngagement;
  readonly selection: readonly RoleSelection[];
  readonly assessments: readonly RoleAssessmentRecord[];
  readonly gaps: readonly OnboardingGap[];
  readonly findings: readonly OnboardingFinding[];
}

export interface MutationApproval {
  readonly decisionOwner: string;
  readonly approvedRunDigest: string;
  readonly approvedAt: string;
}

export interface LedgerProposal {
  readonly ledger: unknown | null;
  readonly findings: readonly OnboardingFinding[];
}

export interface MutationAuthorization {
  readonly authorized: boolean;
  readonly findings: readonly OnboardingFinding[];
}
