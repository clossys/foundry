import type { CapabilityArtifactRef, CapabilityCatalogue, CapabilityEvidence, CapabilityInput, DeclaredCapability, RoleCapability } from "./capability-catalogue.js";

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
      /**
       * Role-level needs loops inside this kit, each with the repeated role
       * at both ends. Composition only reaches `composed` with one when no
       * capability cycle is behind it (issue #1382), so every entry is a
       * legitimate loop, such as the Customer/Publisher keep loop.
       * `sequence` cannot put every role in a loop before the others, so
       * within a loop it is the walk order.
       */
      roleCycles: readonly (readonly string[])[];
      /**
       * A needs cycle only visible through a role with no capability map:
       * it cannot be told apart from a deadlock, so it is named here --
       * never failed, never silently passed. Null when there is none.
       */
      unjudgedCycle: readonly string[] | null;
    }
  | { state: "indeterminate"; reason: string };

export interface ComposeKitInput {
  selectedRoles: readonly string[];
  catalogue: CapabilityCatalogue;
  /** Reserved for future stage/intent-aware composition (issue #1173's engagement context); unused today. */
  context?: unknown;
}

export interface NeedsCycleJudgement {
  /** A cycle among capability nodes (`<role>#<capability id>`): a deadlock. */
  capabilityCycle: readonly string[] | null;
  /** When there is no deadlock: a cycle that exists only through a bare role (a role with no capability map). */
  unjudgedCycle: readonly string[] | null;
}

/** Three-color DFS over an adjacency map. Returns the first cycle found, repeated node at both ends, or null. */
function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const color = new Map<string, number>();
  const stack: string[] = [];
  function visit(node: string): string[] | null {
    color.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) return stack.slice(stack.indexOf(next)).concat(next);
      if (state === 0 && edges.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  }
  for (const node of [...edges.keys()].sort()) {
    if ((color.get(node) ?? 0) === 0) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Issue #1382's needs-cycle decision in this repository's package-framework
 * contract, applied to the roles of one kit: cycles are judged per
 * capability, not per role.
 *
 * Nodes are `<role>#<capability id>` for every capability a role declares,
 * and the bare `<role>` for a role with no capability map. Edges are each
 * capability's own `inputs`, and a bare role's `needs`. A role with
 * capabilities is judged by their `inputs`; one of its `needs` that no
 * capability's `inputs` covers (same producer and artifact, or resolving to
 * the same node) becomes an edge from EVERY one of its capabilities. An
 * input or need resolves to the producer capability whose `id` is the
 * artifact, else to the capability whose `outputs` holds the producer's
 * declared `feeds` path for it, else (for a producer with no capability
 * map) to the bare producer. Anything else, including a producer outside
 * `roleNames`, adds no edge.
 */
export function judgeNeedsCycles({ roleNames, catalogue }: { roleNames: readonly string[]; catalogue: CapabilityCatalogue }): NeedsCycleJudgement {
  const byRole = new Map<string, RoleCapability>(catalogue.roles.map((role) => [role.role, role]));
  const roleByScopeName = new Map<string, string>(catalogue.roles.map((role) => [role.scopeName, role.role]));
  const roleOfScopedName = (scopeName: string): string | null => roleByScopeName.get(scopeName) ?? null;
  const inScope = new Set(roleNames.filter((role) => byRole.has(role)));
  const capabilitiesOf = (role: string): readonly DeclaredCapability[] => byRole.get(role)?.capabilities ?? [];
  const resolve = (producer: string | null | undefined, artifact: string): string | null => {
    if (!producer || !inScope.has(producer)) return null;
    const capabilities = capabilitiesOf(producer);
    if (capabilities.length === 0) return producer;
    const byId = capabilities.find((capability) => capability.id === artifact);
    if (byId) return `${producer}#${byId.id}`;
    const feed = (byRole.get(producer)?.feeds ?? []).find((item) => typeof item.path === "string" && item.path !== "" && item.artifact === artifact);
    const byOutput = feed?.path === undefined ? undefined : capabilities.find((capability) => capability.outputs.includes(feed.path as string));
    return byOutput ? `${producer}#${byOutput.id}` : null;
  };
  const resolveInput = (input: CapabilityInput): string | null => resolve(roleOfScopedName(input.producerRole), input.artifact);
  const resolveNeed = (need: CapabilityArtifactRef): string | null => resolve(need.role, need.artifact);
  const isNode = (node: string | null): node is string => node !== null;
  const edges = new Map<string, string[]>();
  for (const role of [...inScope].sort()) {
    const needs = byRole.get(role)?.needs ?? [];
    const capabilities = capabilitiesOf(role);
    if (capabilities.length === 0) {
      edges.set(role, needs.map(resolveNeed).filter(isNode));
      continue;
    }
    const covered = (need: CapabilityArtifactRef): boolean =>
      capabilities.some((capability) =>
        capability.inputs.some(
          (input) =>
            (roleOfScopedName(input.producerRole) === need.role && input.artifact === need.artifact)
            || (resolveInput(input) !== null && resolveInput(input) === resolveNeed(need)),
        ),
      );
    const uncoveredTargets = needs.filter((need) => !covered(need)).map(resolveNeed).filter(isNode);
    for (const capability of capabilities) {
      edges.set(`${role}#${capability.id}`, [...capability.inputs.map(resolveInput).filter(isNode), ...uncoveredTargets]);
    }
  }
  const capabilityOnly = new Map(
    [...edges].filter(([node]) => node.includes("#")).map(([node, next]) => [node, next.filter((target) => target.includes("#"))] as const),
  );
  const capabilityCycle = findCycle(capabilityOnly);
  return { capabilityCycle, unjudgedCycle: capabilityCycle ? null : findCycle(edges) };
}

/**
 * Pulls in every role a selected role's `needs` edge names that was not
 * already selected, orders roles so a producer precedes its consumer, and
 * reports any need that names no resolvable role. An unknown selected role
 * comes back `indeterminate`, never guessed past.
 *
 * Needs cycles follow issue #1382's decision ({@link judgeNeedsCycles}): a
 * cycle among the kit's capabilities is a deadlock and comes back
 * `indeterminate`; a role-level loop with no capability cycle behind it is
 * legitimate and listed in `roleCycles`; a cycle only visible through a
 * role with no capability map composes and is named in `unjudgedCycle`.
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
  const roleCycles: string[][] = [];

  function visit(role: string, path: string[]): void {
    if (included.has(role)) return;
    const onPath = path.indexOf(role);
    if (onPath !== -1) {
      roleCycles.push([...path.slice(onPath), role]);
      return;
    }
    const capability = byRole.get(role);
    if (!capability) return;
    path.push(role);
    for (const need of capability.needs) {
      if (need.role && byRole.has(need.role)) {
        if (!selectedRoles.includes(need.role)) addedForDependencies.add(need.role);
        visit(need.role, path);
      } else {
        unsatisfiedNeeds.push({ role, artifact: need.artifact, wantedRole: need.role ?? need.producerRole ?? null });
      }
    }
    path.pop();
    included.add(role);
    order.push(role);
  }

  for (const role of selectedRoles) visit(role, []);

  const { capabilityCycle, unjudgedCycle } = judgeNeedsCycles({ roleNames: order, catalogue });
  if (capabilityCycle) {
    return { state: "indeterminate", reason: `needs cycle between capabilities, so none of them can ever run first (issue #1382): ${capabilityCycle.join(" -> ")}` };
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
    roleCycles,
    unjudgedCycle,
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
      roleCycles: readonly (readonly string[])[];
      unjudgedCycle: readonly string[] | null;
      overCapReason?: string;
    }
  | {
      state: "over-cap";
      cap: number;
      roleCount: number;
      reason: string;
      roles: readonly ComposedFromProblemsRole[];
      sequence: readonly string[];
      roleCycles: readonly (readonly string[])[];
      unjudgedCycle: readonly string[] | null;
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
      roleCycles: composed.roleCycles,
      unjudgedCycle: composed.unjudgedCycle,
    };
  }

  return {
    state: "composed",
    primaryProblemId: primaryEntries[0]!.id,
    roles: withTrace(composed.roles),
    sequence: composed.sequence,
    unsatisfiedNeeds: composed.unsatisfiedNeeds,
    addedForDependencies: composed.addedForDependencies,
    roleCycles: composed.roleCycles,
    unjudgedCycle: composed.unjudgedCycle,
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
 * least qualified" cannot be enforced as a hard rule yet, because most
 * roles still carry only the `designed` fallback `solves` entry. This mirrors the equivalent
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
