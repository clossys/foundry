/**
 * `@clossys/controller/onboarding` — the one parameterized first-day
 * onboarding workflow.
 *
 * It discovers and invokes ROLE-OWNED assessments. It carries no assessment
 * content of its own, and it is not a substitute for any role: the report it
 * produces is the join — which roles a deterministic rule opened, what each
 * one's own surface returned, what could not be observed, and what the
 * decision owner approved.
 *
 * The active role set comes from the role contract shipped beside this
 * package, never from a list maintained here.
 */
import { readCanonicalRoleLoopContract } from "../positions/canonical.js";
import { discoverRoleAssessmentSurface } from "./discovery.js";
import { DEFAULT_ASSESSMENT_TIMEOUT_MS, nodeAssessmentInvoker, observeRoleAssessment } from "./invoke.js";
import { joinFirstDayOnboarding } from "./join.js";
import { selectRoles, validateOnboardingRequest } from "./selection.js";
import type { AssessmentInvoker } from "./invoke.js";
import type { OnboardingRequest, OnboardingRun, RoleAssessmentObservation } from "./types.js";

export interface FirstDayOnboardingOptions {
  /** A `node_modules`-shaped directory holding the consumer's installed role packages. */
  readonly installRoot: string;
  /** The consumer-owned directory holding one evidence file per role. */
  readonly evidenceDirectory: string;
  /** Defaults to every role in the shipped role contract. */
  readonly activeRoles?: readonly string[];
  readonly invoke?: AssessmentInvoker;
  readonly timeoutMs?: number;
}

/** Every active role named by the role contract this package ships. */
export function activeRolesFromContract(contract: unknown = readCanonicalRoleLoopContract()): readonly string[] {
  if (typeof contract !== "object" || contract === null || Array.isArray(contract)) throw new Error("role contract is unreadable");
  const roles = (contract as Record<string, unknown>).roles;
  if (typeof roles !== "object" || roles === null || Array.isArray(roles)) throw new Error("role contract declares no roles");
  return Object.keys(roles).sort();
}

/**
 * Runs one first-day onboarding: select, discover, invoke, join. Throws only
 * on a request that cannot be read at all — every other outcome, including a
 * role with no assessment surface, is reported rather than raised.
 */
export function runFirstDayOnboarding(request: unknown, options: FirstDayOnboardingOptions): OnboardingRun {
  const findings = validateOnboardingRequest(request);
  if (findings.length > 0) throw new Error(`unreadable onboarding request: ${findings.map((item) => `${item.rule} at ${item.path}`).join("; ")}`);
  const typed = request as OnboardingRequest;
  const activeRoles = options.activeRoles ?? activeRolesFromContract();
  const selection = selectRoles(typed, activeRoles);
  const invoke = options.invoke ?? nodeAssessmentInvoker;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ASSESSMENT_TIMEOUT_MS;
  const observations: RoleAssessmentObservation[] = [];
  for (const item of selection) {
    if (item.outcome !== "selected") continue;
    const discovery = discoverRoleAssessmentSurface(options.installRoot, item.role);
    observations.push(discovery.surface === null
      ? { role: item.role, surface: null, absence: discovery.absence, failure: null, exitCode: null, assessment: undefined }
      : observeRoleAssessment(discovery.surface, options.evidenceDirectory, invoke, timeoutMs));
  }
  return joinFirstDayOnboarding(typed, selection, observations);
}

export { ARCHITECTURE_SUBJECTS, ASSESSMENT_INVOCATION_FAILURES, ASSESSMENT_INVOCATION_KINDS, ASSESSMENT_OUTCOMES, ASSESSMENT_SURFACE_ABSENCES, DIRECTION_SUBJECTS, NO_RULE_OPENED, SELECTION_RULES } from "./types.js";
export type { ArchitectureSubject, AssessmentInvocationFailure, AssessmentInvocationKind, AssessmentOutcome, AssessmentSurface, AssessmentSurfaceAbsence, AssessmentSurfaceDiscovery, DirectionSubject, LedgerProposal, MutationApproval, MutationAuthorization, OnboardingEngagement, OnboardingFinding, OnboardingGap, OnboardingRequest, OnboardingRun, OnboardingState, RoleAssessmentObservation, RoleAssessmentRecord, RoleSelection, RoleSelectionOutcome, SelectionRule } from "./types.js";
export { DIRECTION_ROLE, ENGAGEMENT_BASELINE_ROLE, EXCLUSION_REASON, INDEPENDENT_OUTCOME_ROLE, OPERATING_SYSTEM_ROLE, selectRoles, validateOnboardingRequest } from "./selection.js";
export { ASSESSMENT_DECLARATION_PATH, discoverRoleAssessmentSurface, discoverRoleAssessmentSurfaces } from "./discovery.js";
export { DEFAULT_ASSESSMENT_TIMEOUT_MS, assessmentInputPath, nodeAssessmentInvoker, observeRoleAssessment } from "./invoke.js";
export type { AssessmentInvoker, AssessmentProcessResult } from "./invoke.js";
export { assertPassThroughAssessments, joinFirstDayOnboarding, onboardingExitCode } from "./join.js";
export { PROPOSED_POSITIONS_KEY, assertRoleAuthoredPositions, authorizeMutation, onboardingRunDigest, proposeInstalledPositionLedger } from "./ledger.js";
