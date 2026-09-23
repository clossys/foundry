import type { CapabilityCatalogue, CapabilityEvidence } from "./capability-catalogue.js";
import { composeKit, composeKitFromProblems, type ComposedFromProblemsRole, type ConfirmedProblem } from "./composition.js";
import type { KitPreset } from "./kit-presets.js";
import { CLIENT_PROBLEMS } from "./client-problems.js";
import { proposalReadyForClient, type ManagedEngagementInput, type OperatorReview } from "./managed-engagement.js";

/**
 * Recommend kits, not packages (issue #1177, follow-on from #1176):
 * verdicts attach to the composed kit (or matching preset) Advisor
 * proposes, never to a fixed catalogue. Each role's "why" cites the
 * declared `solves` entry that justified it, alongside its goal and
 * handoffs, in the same shape #1176's `EngagementBrief` uses.
 *
 * A preset's own `problem` field is prose (a pitch, e.g. "We can't
 * explain what we are, and our site doesn't sell."), not a
 * `CLIENT_PROBLEMS` id — there is no id-to-preset mapping to match
 * against. Instead, a preset "matches" when its own role set, closed the
 * same way any selection is (`composeKit`), is exactly the role set the
 * confirmed problems deterministically compose to. That is a structural
 * check on the one thing both sides actually share: the resulting team.
 */

/** One `solves` entry a role cited to justify its place in this kit — the declared claim, not an invented one. */
export interface KitVerdictCitation {
  problem: string;
  statement: string;
  metric: string;
  proofCase: string;
  evidence: CapabilityEvidence;
}

export interface KitVerdictRole {
  role: string;
  why: string;
  /** Every one of this role's own `solves` entries that matches a client-confirmed problem. May be empty for a role pulled in only by a `needs` edge. */
  citations: readonly KitVerdictCitation[];
  goal: { metric: string; direction: string };
  inputsFrom: readonly string[];
  outputsTo: readonly string[];
  /** This role's deliverable in this kit, from the catalogue's own `boundary.owns` — never invented copy. */
  deliverable: string | null;
}

export type KitVerdictState = "recommended" | "over-cap" | "indeterminate";

export interface KitVerdict {
  state: KitVerdictState;
  problem: string;
  primaryProblemId: string | null;
  source: "composed" | "preset";
  presetId?: string;
  roles: readonly KitVerdictRole[];
  sequence: readonly string[];
  deliverables: readonly string[];
  reason?: string;
  /**
   * Whether this verdict is ready to show the client: always true in
   * self-serve mode; in managed mode, only once the engaged operator has
   * recorded an `approved` review (issue #1044's operator-review hook,
   * owner comment on #1220). This package does not gate presentation on
   * its own — the caller reads this field and decides.
   */
  readyForClient: boolean;
}

const PROBLEM_STATEMENTS = new Map(CLIENT_PROBLEMS.map((item) => [item.id, item.statement]));

function citationsFor(role: string, catalogue: CapabilityCatalogue, confirmedProblemIds: ReadonlySet<string>): readonly KitVerdictCitation[] {
  const capability = catalogue.roles.find((candidate) => candidate.role === role);
  if (!capability) return [];
  return capability.solves
    .filter((entry) => confirmedProblemIds.has(entry.problem))
    .map((entry) => ({
      problem: entry.problem,
      statement: PROBLEM_STATEMENTS.get(entry.problem) ?? entry.problem,
      metric: entry.metric,
      proofCase: entry.proofCase,
      evidence: entry.evidence,
    }));
}

function deliverableFor(role: string, catalogue: CapabilityCatalogue): string | null {
  const capability = catalogue.roles.find((candidate) => candidate.role === role);
  return capability?.boundary.owns ?? null;
}

function toVerdictRoles(roles: readonly ComposedFromProblemsRole[], catalogue: CapabilityCatalogue): readonly KitVerdictRole[] {
  const confirmedProblemIds = new Set(roles.flatMap((role) => role.confirmedProblemIds));
  return roles.map((role) => ({
    role: role.role,
    why: role.why,
    citations: citationsFor(role.role, catalogue, confirmedProblemIds),
    goal: role.goal,
    inputsFrom: role.inputsFrom,
    outputsTo: role.outputsTo,
    deliverable: deliverableFor(role.role, catalogue),
  }));
}

function deliverablesOf(roles: readonly KitVerdictRole[]): readonly string[] {
  return roles.map((role) => role.deliverable).filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** Same role set, regardless of order. */
function sameRoleSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((role) => bSet.has(role));
}

/**
 * A preset "matches" a composition when its own closure (via
 * `composeKit`) has exactly the composition's role set. This does NOT
 * gate on `presetEvidenceFindings` — that check is advisory-only by
 * design (composition.ts's own doc comment): most roles still carry
 * only the `designed` fallback `solves` entry, so gating attribution on
 * it would make preset attribution vacuous today. The skill discloses evidence level to the client separately.
 */
function matchingPresetId(composedRoles: readonly string[], presets: readonly KitPreset[], catalogue: CapabilityCatalogue): string | undefined {
  for (const preset of presets) {
    const presetComposed = composeKit({ selectedRoles: preset.roles, catalogue });
    if (presetComposed.state !== "composed") continue;
    if (sameRoleSet(presetComposed.sequence, composedRoles)) return preset.id;
  }
  return undefined;
}

export interface RecommendKitInput {
  confirmedProblems: readonly ConfirmedProblem[];
  catalogue: CapabilityCatalogue;
  problem: string;
  presets?: readonly KitPreset[];
  overCapReason?: string;
  engagement?: ManagedEngagementInput;
  operatorReview?: OperatorReview;
}

/**
 * Composes a kit from the confirmed problems (#1176's
 * `composeKitFromProblems`, the deterministic source of truth), then
 * checks whether a curated preset's own closure exactly matches the
 * resulting role set — if so, the verdict is attributed to that preset
 * (`source: "preset"`) for a friendlier name, while still using the
 * composition's own citation trace. Presets remain fallbacks and
 * starting points only, never a required grouping — see kit-presets.ts's
 * own doc comment.
 */
export function recommendKit({ confirmedProblems, catalogue, problem, presets = [], overCapReason, engagement = {}, operatorReview }: RecommendKitInput): KitVerdict {
  const readyForClient = proposalReadyForClient(engagement, operatorReview);
  const composed = composeKitFromProblems({ confirmedProblems, catalogue, overCapReason });

  if (composed.state === "indeterminate") {
    return {
      state: "indeterminate",
      problem,
      primaryProblemId: null,
      source: "composed",
      roles: [],
      sequence: [],
      deliverables: [],
      reason: composed.reason,
      readyForClient: false,
    };
  }

  const roles = toVerdictRoles(composed.roles, catalogue);

  if (composed.state === "over-cap") {
    return {
      state: "over-cap",
      problem,
      primaryProblemId: null,
      source: "composed",
      roles,
      sequence: composed.sequence,
      deliverables: deliverablesOf(roles),
      reason: composed.reason,
      readyForClient: false,
    };
  }

  const presetId = matchingPresetId(composed.sequence, presets, catalogue);

  return {
    state: "recommended",
    problem,
    primaryProblemId: composed.primaryProblemId,
    source: presetId ? "preset" : "composed",
    ...(presetId ? { presetId } : {}),
    roles,
    sequence: composed.sequence,
    deliverables: deliverablesOf(roles),
    readyForClient,
  };
}
