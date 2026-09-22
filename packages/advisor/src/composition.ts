import type { CapabilityCatalogue, CapabilityEvidence, RoleCapability } from "./capability-catalogue.js";

/**
 * Pure kit composition (issue #1176, owner redirect 2026-09-22). This is
 * the published, shipped implementation of the same algorithm as this
 * repository's own gate's `composeKit`/`validateKitProposal`. The two
 * cannot share one implementation: a published npm tarball can only ship
 * this package's own src/dist, never anything from outside it. Keep both
 * in step; a change to the composition rules here belongs in the gate's
 * copy too, and vice versa.
 *
 * Neither function performs file or network I/O — both take an
 * already-built {@link CapabilityCatalogue} and operate on it in memory.
 */

export interface ComposedRole {
  role: string;
  /** For an explicitly selected role, its own job question. For a role pulled in only to satisfy a need, a mechanical, grounded explanation naming who needed it — never invented prose. */
  why: string;
  goal: { metric: string; direction: string };
  inputsFrom: readonly string[];
  outputsTo: readonly string[];
}

export interface UnsatisfiedNeed {
  role: string;
  artifact: string;
  wantedRole: string | null;
}

export type ComposeKitResult =
  | {
      state: "composed";
      roles: readonly ComposedRole[];
      sequence: readonly string[];
      unsatisfiedNeeds: readonly UnsatisfiedNeed[];
      addedForDependencies: readonly string[];
    }
  | { state: "indeterminate"; reason: string };

export interface ComposeKitInput {
  selectedRoles: readonly string[];
  catalogue: CapabilityCatalogue;
  /** Reserved for future stage/intent-aware composition (issue #1173's engagement context); unused today. */
  context?: unknown;
}

type VisitOutcome = true | { cycle: readonly string[] };

/**
 * Pulls in every role a selected role's `needs` edge names that was not
 * already selected, orders roles so a producer always precedes its
 * consumer, and reports any need that names no resolvable role. An unknown
 * selected role or a needs cycle comes back `indeterminate`, never guessed
 * past.
 */
export function composeKit({ selectedRoles, catalogue }: ComposeKitInput): ComposeKitResult {
  const byRole = new Map<string, RoleCapability>(catalogue.roles.map((role) => [role.role, role]));

  for (const role of selectedRoles) {
    if (!byRole.has(role)) {
      return { state: "indeterminate", reason: `unknown role: ${role}` };
    }
  }

  const included = new Set<string>();
  const order: string[] = [];
  const unsatisfiedNeeds: UnsatisfiedNeed[] = [];
  const addedForDependencies = new Set<string>();

  function visit(role: string, path: Set<string>): VisitOutcome {
    if (included.has(role)) return true;
    if (path.has(role)) return { cycle: [...path, role] };
    path.add(role);
    const capability = byRole.get(role);
    if (!capability) return true;
    for (const need of capability.needs) {
      if (need.role && byRole.has(need.role)) {
        if (!selectedRoles.includes(need.role)) addedForDependencies.add(need.role);
        const outcome = visit(need.role, path);
        if (outcome !== true) return outcome;
      } else {
        unsatisfiedNeeds.push({ role, artifact: need.artifact, wantedRole: need.role ?? null });
      }
    }
    path.delete(role);
    included.add(role);
    order.push(role);
    return true;
  }

  for (const role of selectedRoles) {
    const outcome = visit(role, new Set());
    if (outcome !== true) {
      return { state: "indeterminate", reason: `needs cycle: ${outcome.cycle.join(" -> ")}` };
    }
  }

  const roles: ComposedRole[] = order.map((role) => {
    const capability = byRole.get(role) as RoleCapability;
    const isAddedDependency = addedForDependencies.has(role) && !selectedRoles.includes(role);
    const why = isAddedDependency
      ? `Needed by ${catalogue.roles
          .filter((candidate) => candidate.needs.some((need) => need.role === role))
          .map((candidate) => candidate.role)
          .join(", ")} for its handoff.`
      : capability.jobQuestion;
    return {
      role,
      why,
      goal: { metric: capability.metric.name, direction: capability.metric.direction },
      inputsFrom: capability.needs.filter((need) => need.role).map((need) => need.role as string),
      outputsTo: capability.feeds.filter((need) => need.role).map((need) => need.role as string),
    };
  });

  return {
    state: "composed",
    roles,
    sequence: order,
    unsatisfiedNeeds,
    addedForDependencies: [...addedForDependencies],
  };
}

// ---------------------------------------------------------------------------
// Problem-confirmed composition (issue #1176, owner comment "De-risking
// dynamic composition", 2026-09-22): the client confirms PROBLEM cards,
// never picks packages. composeKitFromProblems maps confirmed problem ids
// to roles deterministically via each role's own `solves[].problem`, then
// reuses composeKit for closure and ordering.
// ---------------------------------------------------------------------------

export const FIRST_ENGAGEMENT_ROLE_CAP = 5;

/** One problem the client has confirmed; exactly one per composition must be `primary`. */
export interface ConfirmedProblem {
  id: string;
  primary?: boolean;
}

export interface ComposedFromProblemsRole extends ComposedRole {
  /** This role's own confirmed-problem matches — the two-way trace back to what the client actually confirmed. */
  confirmedProblemIds: readonly string[];
  /** False when this role was pulled in only to satisfy another role's `needs`, not because it itself solves a confirmed problem. */
  isDirect: boolean;
}

export type ComposeKitFromProblemsResult =
  | {
      state: "composed";
      primaryProblemId: string;
      roles: readonly ComposedFromProblemsRole[];
      sequence: readonly string[];
      unsatisfiedNeeds: readonly UnsatisfiedNeed[];
      addedForDependencies: readonly string[];
      overCapReason?: string;
    }
  | {
      state: "over-cap";
      cap: number;
      roleCount: number;
      reason: string;
      roles: readonly ComposedFromProblemsRole[];
      sequence: readonly string[];
    }
  | { state: "indeterminate"; reason: string };

export interface ComposeKitFromProblemsInput {
  confirmedProblems: readonly ConfirmedProblem[];
  catalogue: CapabilityCatalogue;
  overCapReason?: string;
  cap?: number;
}

/**
 * Deterministically maps confirmed problems to roles: a role is selected
 * when one of its own `solves` entries names a confirmed problem id. The
 * same confirmed problems always produce the same role set and order.
 *
 * Guardrails, enforced before any roles are returned: exactly one
 * confirmed problem must be marked `primary` (one primary problem per
 * kit); a closed, composed role count over {@link FIRST_ENGAGEMENT_ROLE_CAP}
 * requires a caller-supplied `overCapReason`, or comes back `"over-cap"`
 * instead of `"composed"`.
 */
export function composeKitFromProblems({
  confirmedProblems,
  catalogue,
  overCapReason,
  cap = FIRST_ENGAGEMENT_ROLE_CAP,
}: ComposeKitFromProblemsInput): ComposeKitFromProblemsResult {
  const list = (confirmedProblems ?? []).filter((item) => item && typeof item.id === "string" && item.id.trim() !== "");
  if (list.length === 0) {
    return { state: "indeterminate", reason: "confirmedProblems must be a nonempty array of { id, primary? }" };
  }

  const primaryEntries = list.filter((item) => item.primary === true);
  if (primaryEntries.length !== 1) {
    return { state: "indeterminate", reason: `exactly one confirmed problem must be marked primary; found ${primaryEntries.length}` };
  }

  const confirmedIds = new Set(list.map((item) => item.id));
  const roleTrace = new Map<string, string[]>();
  for (const role of catalogue.roles) {
    const matched = role.solves.filter((item) => confirmedIds.has(item.problem)).map((item) => item.problem);
    if (matched.length > 0) roleTrace.set(role.role, matched);
  }

  const directRoles = [...roleTrace.keys()].sort();
  if (directRoles.length === 0) {
    return { state: "indeterminate", reason: "no role's solves entries match any confirmed problem id" };
  }

  const composed = composeKit({ selectedRoles: directRoles, catalogue });
  if (composed.state !== "composed") return composed;

  const withTrace = (roles: readonly ComposedRole[]): ComposedFromProblemsRole[] =>
    roles.map((role) => ({ ...role, confirmedProblemIds: roleTrace.get(role.role) ?? [], isDirect: roleTrace.has(role.role) }));

  const roleCount = composed.roles.length;
  if (roleCount > cap && !overCapReason) {
    return {
      state: "over-cap",
      cap,
      roleCount,
      reason: `composing ${roleCount} roles exceeds the first-engagement cap of ${cap}; provide overCapReason to proceed anyway`,
      roles: withTrace(composed.roles),
      sequence: composed.sequence,
    };
  }

  return {
    state: "composed",
    primaryProblemId: primaryEntries[0]!.id,
    roles: withTrace(composed.roles),
    sequence: composed.sequence,
    unsatisfiedNeeds: composed.unsatisfiedNeeds,
    addedForDependencies: composed.addedForDependencies,
    ...(overCapReason ? { overCapReason } : {}),
  };
}

/** One role claim inside a skill-proposed kit, before it is validated. */
export interface KitProposalRoleClaim {
  role: string;
  /** Which of that role's confirmed-problem matches this claim is about, when the role is a direct solver. */
  problemId?: string;
  /** Free-language explanation shown to the client. */
  why: string;
}

export interface KitProposal {
  problem: string;
  roles: readonly KitProposalRoleClaim[];
  /** Threaded through to composeKitFromProblems when the proposal itself exceeds the first-engagement cap. */
  overCapReason?: string;
}

export interface KitProposalFinding {
  rule: string;
  message: string;
  role?: string;
}

export type ValidateKitProposalResult = {
  state: "valid" | "indeterminate";
  findings: readonly KitProposalFinding[];
  removalCandidates?: readonly string[];
  deterministic?: ComposeKitFromProblemsResult;
};

/**
 * Checks a skill-proposed kit against the deterministic mapping: every
 * proposed role must appear in what {@link composeKitFromProblems} itself
 * would produce from the same confirmed problems — either as a direct
 * solver of a confirmed problem, or as a role another direct solver's
 * `needs` requires. A proposed role that traces to neither is reported as
 * a removal candidate rather than silently dropped, so the skill (or a
 * human) makes that call. This is the two-way trace: a role links to a
 * confirmed problem AND to its own `solves` entry, or it does not belong.
 */
export function validateKitProposal({
  proposal,
  confirmedProblems,
  catalogue,
}: {
  proposal: KitProposal;
  confirmedProblems: readonly ConfirmedProblem[];
  catalogue: CapabilityCatalogue;
}): ValidateKitProposalResult {
  if (!proposal.problem || proposal.roles.length === 0) {
    return { state: "indeterminate", findings: [{ rule: "invalid-proposal", message: "proposal must have problem and a nonempty roles[]" }] };
  }

  const deterministic = composeKitFromProblems({ confirmedProblems, catalogue, overCapReason: proposal.overCapReason });
  if (deterministic.state === "indeterminate") {
    return { state: "indeterminate", findings: [{ rule: "invalid-confirmed-problems", message: deterministic.reason }] };
  }

  const findings: KitProposalFinding[] = [];
  if (deterministic.state === "over-cap") {
    findings.push({ rule: "over-cap", message: deterministic.reason });
  }

  const justified = new Map(deterministic.roles.map((role) => [role.role, role]));
  const removalCandidates: string[] = [];

  for (const [index, claim] of proposal.roles.entries()) {
    if (!claim.role || !claim.why) {
      findings.push({ rule: "invalid-claim", message: `roles[${index}] must have role and why` });
      continue;
    }
    const grounded = justified.get(claim.role);
    if (!grounded) {
      removalCandidates.push(claim.role);
      findings.push({
        rule: "ungrounded-role",
        message: `${claim.role} links to no confirmed problem and is not needed by any role that does; propose removing it`,
        role: claim.role,
      });
      continue;
    }
    if (grounded.isDirect && claim.problemId && !grounded.confirmedProblemIds.includes(claim.problemId)) {
      findings.push({
        rule: "claim-problem-mismatch",
        message: `${claim.role}'s claimed problem ${JSON.stringify(claim.problemId)} is not one of its confirmed matches: ${grounded.confirmedProblemIds.join(", ")}`,
        role: claim.role,
      });
    }
  }

  return { state: findings.length === 0 ? "valid" : "indeterminate", findings, removalCandidates, deterministic };
}

// ---------------------------------------------------------------------------
// Evidence tiers and the (advisory-only, see doc comment below) preset floor.
// ---------------------------------------------------------------------------

export const EVIDENCE_LEVELS: readonly CapabilityEvidence[] = ["designed", "qualified", "proven"];

export function evidenceAtLeast(evidence: CapabilityEvidence, floor: CapabilityEvidence): boolean {
  const evidenceRank = EVIDENCE_LEVELS.indexOf(evidence);
  const floorRank = EVIDENCE_LEVELS.indexOf(floor);
  if (evidenceRank === -1 || floorRank === -1) return false;
  return evidenceRank >= floorRank;
}

export interface PresetEvidenceFinding {
  rule: "preset-role-below-evidence-floor";
  message: string;
  preset: string;
  role: string;
}

/**
 * Advisory only: "presets may only include roles whose claims are at
 * least qualified" cannot be enforced as a hard rule today, because every
 * current `solves` entry is the `designed`-only fallback (issue #1172 has
 * not landed real evidence for any role yet). This mirrors the equivalent
 * function this repository's own gate calls the same way — non-blocking, so it never
 * fails a preset the owner already approved, but visible and testable so
 * it is ready to enforce the moment real evidence exists.
 */
export function presetEvidenceFindings({
  presets,
  catalogue,
  floor = "qualified",
}: {
  presets: readonly { id: string; roles: readonly string[] }[];
  catalogue: CapabilityCatalogue;
  floor?: CapabilityEvidence;
}): PresetEvidenceFinding[] {
  const byRole = new Map<string, RoleCapability>(catalogue.roles.map((role) => [role.role, role]));
  const findings: PresetEvidenceFinding[] = [];
  for (const preset of presets) {
    for (const role of preset.roles) {
      const capability = byRole.get(role);
      if (!capability) continue;
      const bestRank = capability.solves.reduce((acc, item) => Math.max(acc, EVIDENCE_LEVELS.indexOf(item.evidence)), -1);
      const best = bestRank === -1 ? null : EVIDENCE_LEVELS[bestRank]!;
      if (best === null || !evidenceAtLeast(best, floor)) {
        findings.push({
          rule: "preset-role-below-evidence-floor",
          message: `preset ${preset.id} role ${role} has no solves claim at or above "${floor}" evidence (best: ${best ?? "none"})`,
          preset: preset.id,
          role,
        });
      }
    }
  }
  return findings;
}
