/**
 * Deterministic role selection.
 *
 * Selection is a predicate over facts the consumer DECLARED, never a reading
 * of the consumer's situation. That distinction is why this module can exist
 * without becoming a substitute for the roles it opens: deciding *whether* a
 * direction question is unresolved is expertise; reading a declared
 * `unresolved: ["business-model"]` is arithmetic.
 */
import { ARCHITECTURE_SUBJECTS, DIRECTION_SUBJECTS, NO_RULE_OPENED, SELECTION_RULES } from "./types.js";
import type { OnboardingFinding, OnboardingRequest, RoleSelection, SelectionRule } from "./types.js";

/** The roles the operating model binds to a fixed rule rather than to a consumer request. */
export const ENGAGEMENT_BASELINE_ROLE = "@clossys/advisor";
export const DIRECTION_ROLE = "@clossys/strategist";
export const OPERATING_SYSTEM_ROLE = "@clossys/architect";
export const INDEPENDENT_OUTCOME_ROLE = "@clossys/observer";

const roleName = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const SEP = String.fromCharCode(0);
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function uniqueMembers(value: unknown, vocabulary: readonly string[]): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && (vocabulary as readonly string[]).includes(item)) && new Set(value).size === value.length;
}

/** Rejects a malformed request outright. A request that cannot be read selects nothing. */
export function validateOnboardingRequest(value: unknown): readonly OnboardingFinding[] {
  const findings: OnboardingFinding[] = [];
  const fail = (rule: string, path: string, message: string): void => { findings.push({ rule, path, message }); };
  if (!record(value)) return [{ rule: "unreadable-onboarding-request", path: "request", message: "must be an object" }];
  const expected = ["schemaVersion", "engagement", "unresolved", "unmapped", "candidateRoles"];
  if (Object.keys(value).sort().join(SEP) !== [...expected].sort().join(SEP)) fail("unreadable-onboarding-request", "request", `must contain exactly: ${expected.join(", ")}`);
  if (value.schemaVersion !== 1) fail("unreadable-onboarding-request", "request.schemaVersion", "must be 1");
  const engagement = value.engagement;
  if (!record(engagement) || Object.keys(engagement).sort().join(SEP) !== ["decisionOwner", "id"].join(SEP) || !text(engagement.id) || !text(engagement.decisionOwner)) {
    fail("invalid-engagement", "request.engagement", "needs exactly a nonempty id and decisionOwner");
  }
  if (!uniqueMembers(value.unresolved, DIRECTION_SUBJECTS)) fail("invalid-unresolved-subjects", "request.unresolved", `must be unique members of: ${DIRECTION_SUBJECTS.join(", ")}`);
  if (!uniqueMembers(value.unmapped, ARCHITECTURE_SUBJECTS)) fail("invalid-unmapped-subjects", "request.unmapped", `must be unique members of: ${ARCHITECTURE_SUBJECTS.join(", ")}`);
  const candidates = value.candidateRoles;
  if (!Array.isArray(candidates) || !candidates.every((item) => text(item) && roleName.test(item)) || new Set(candidates as string[]).size !== candidates.length) {
    fail("invalid-candidate-roles", "request.candidateRoles", "must be unique scoped role package names");
  }
  return findings;
}

function ruleFor(role: string, request: OnboardingRequest): SelectionRule | null {
  if (role === ENGAGEMENT_BASELINE_ROLE) return "engagement-baseline";
  if (role === DIRECTION_ROLE && request.unresolved.length > 0) return "unresolved-direction";
  if (role === OPERATING_SYSTEM_ROLE && request.unmapped.length > 0) return "unmapped-operating-system";
  if (role === INDEPENDENT_OUTCOME_ROLE) return "independent-outcome";
  if (request.candidateRoles.includes(role)) return "consumer-requested";
  return null;
}

/**
 * Opens a role when — and only when — one of {@link SELECTION_RULES} fires.
 * The result is sorted by role name, so two runs over the same declared facts
 * produce byte-identical output.
 */
export function selectRoles(request: OnboardingRequest, activeRoles: readonly string[]): readonly RoleSelection[] {
  return [...activeRoles].sort().map((role) => {
    const rule = ruleFor(role, request);
    return rule === null ? { role, outcome: "excluded" as const, rule: NO_RULE_OPENED } : { role, outcome: "selected" as const, rule };
  });
}

/** The exclusion reason a ledger disposition carries. Derived from the rule set; it states no view of the role. */
export const EXCLUSION_REASON = `No selection rule opened this role for this engagement (rules: ${SELECTION_RULES.join(", ")}).`;
