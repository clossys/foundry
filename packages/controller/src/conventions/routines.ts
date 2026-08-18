import type { Finding, RoutineDeclaration, RoutineRegistry } from "./types.js";

/**
 * Routine declarations: a trigger is a pointer to a procedure, never a copy.
 * See `conventions/documents/routine-declaration.md`.
 *
 * Everything here is deterministic and reads only what the caller passes in. A
 * check that probed a scheduler's store would make its verdict depend on which
 * machine ran it, so live reconciliation is deliberately not in this package --
 * see `reconciliationFindingKinds` for the four answers only a machine can give.
 */

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An absolute path inside a routine body, written without this file holding one. */
const ABSOLUTE_PATH_IN_BODY = /(?<![\w.\-*/~>}])\/[A-Za-z0-9._][A-Za-z0-9._-]*/;

const REQUIRED_FIELDS = ["id", "skill", "cadence", "scope", "mode", "purpose"] as const;

/**
 * Validate one declaration's internal consistency against a plane's registry.
 */
export function validateRoutineDeclaration(
  declaration: RoutineDeclaration,
  registry: RoutineRegistry,
): Finding[] {
  const findings: Finding[] = [];
  const record = declaration as unknown as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const value = record[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (field === "scope" && Array.isArray(value) && value.length === 0);
    if (missing) {
      findings.push({
        rule: "routine/missing-field",
        severity: "high",
        message: `Routine "${declaration?.id ?? "(no id)"}" is missing required field "${field}".`,
      });
    }
  }
  if (findings.length > 0) return findings;

  if (!IDENTIFIER.test(declaration.id)) {
    findings.push({
      rule: "routine/malformed-id",
      severity: "high",
      message: `Routine id "${declaration.id}" must be lowercase kebab case.`,
    });
  }

  if (!registry.cadences.includes(declaration.cadence)) {
    findings.push({
      rule: "routine/unknown-cadence",
      severity: "high",
      message: `Cadence "${declaration.cadence}" is not in this plane's declared list: ${registry.cadences.join(", ")}`,
    });
  }

  if (!registry.modes.includes(declaration.mode)) {
    findings.push({
      rule: "routine/unknown-mode",
      severity: "high",
      message: `Mode "${declaration.mode}" is not in this plane's declared list: ${registry.modes.join(", ")}`,
    });
  }

  // An unqualified target resolves through the plane root's closed list. A
  // repository-qualified target is resolved by validateRoutineCoverage using
  // composite identity; this validator still closes the repository boundary.
  if (declaration.skillRepository === undefined && !registry.skills.includes(declaration.skill)) {
    findings.push({
      rule: "routine/unresolvable-skill",
      severity: "high",
      message: `Routine "${declaration.id}" targets "${declaration.skill}", which does not resolve inside this plane's own skills root.`,
    });
  } else if (declaration.skillRepository !== undefined &&
      !registry.repositories.includes(declaration.skillRepository)) {
    findings.push({
      rule: "routine/skill-repository-outside-plane",
      severity: "high",
      message: `Routine "${declaration.id}" qualifies its skill with repository "${declaration.skillRepository}", which this plane does not govern.`,
    });
  }

  // Scope is closed, with no escape hatch and deliberately not even a declared
  // one. A routine reaching across a boundary is standing authority over
  // repositories the plane does not own; documenting the crossing does not make
  // it legitimate, and it outlives whatever relationship justified it.
  for (const identifier of declaration.scope) {
    if (!registry.repositories.includes(identifier)) {
      findings.push({
        rule: "routine/scope-outside-plane",
        severity: "high",
        message: `Routine "${declaration.id}" scopes "${identifier}", which this plane does not govern. Where work is needed across a boundary, the plane owning those repositories declares its own routine.`,
      });
    }
  }

  if (ABSOLUTE_PATH_IN_BODY.test(declaration.purpose)) {
    findings.push({
      rule: "routine/absolute-path",
      severity: "high",
      message: `Routine "${declaration.id}" writes an absolute path into its declaration. Scope is resolved from the registry at run time; a frozen path survives no migration.`,
    });
  }

  return findings;
}

/** Composite identity for a procedure deliberately kept off a schedule. */
export interface RoutineExclusion {
  readonly skill: string;
  /** Owning repository for a repository-scoped skill. Omit for the plane root. */
  readonly skillRepository?: string;
  readonly reason: string;
}

export interface RoutineSetOptions {
  /**
   * Procedures deliberately kept off a schedule, with a reason each. An absent
   * exclusion is indistinguishable from an oversight, and an oversight is what
   * a later reader helpfully corrects.
   */
  readonly exclusions?: readonly RoutineExclusion[];
}

/**
 * Validate a whole set, adding the rules a single declaration cannot express.
 */
export function validateRoutineSet(
  declarations: readonly RoutineDeclaration[],
  registry: RoutineRegistry,
  options: RoutineSetOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const declaration of declarations) {
    if (declaration?.id) {
      if (seen.has(declaration.id)) {
        findings.push({
          rule: "routine/duplicate-id",
          severity: "high",
          message: `Routine id "${declaration.id}" is declared more than once. Identifiers must be unique within a plane.`,
        });
      }
      seen.add(declaration.id);
    }
    findings.push(...validateRoutineDeclaration(declaration, registry));
  }

  for (const exclusion of options.exclusions ?? []) {
    const raw = exclusion as unknown as Record<string, unknown>;
    const repository = raw.skillRepository;
    if (repository !== undefined &&
        (typeof repository !== "string" || repository.trim() === "")) {
      findings.push({
        rule: "routine/malformed-exclusion-skill-repository",
        severity: "high",
        message: `Excluded procedure "${String(raw.skill ?? "(no skill)")}" has a malformed skillRepository qualifier.`,
      });
    } else if (typeof repository === "string" &&
        !registry.repositories.includes(repository)) {
      findings.push({
        rule: "routine/exclusion-skill-repository-outside-plane",
        severity: "high",
        message: `Excluded procedure "${String(raw.skill ?? "(no skill)")}" is qualified by repository "${repository}", which this plane does not govern.`,
      });
    }
    if (typeof raw.reason !== "string" || raw.reason.trim() === "") {
      findings.push({
        rule: "routine/exclusion-without-reason",
        severity: "medium",
        message: `Excluded procedure "${String(raw.skill ?? "(no skill)")}" records no reason. An unexplained exclusion reads as an oversight.`,
      });
    }
  }

  return findings;
}

/**
 * A skill invoked by a clock must say in its description that it is not
 * conversationally triggered. Skills compete for invocation, and a crowded list
 * does not fail politely by leaving one skill unreliable -- it degrades every
 * skill sharing that list.
 */
export function validateScheduledSkillDescription(
  skill: string,
  description: string,
): Finding[] {
  const declaresNonConversational =
    /\bnot\b[^.]*\b(conversational|conversationally|chat)\b/i.test(description) ||
    /\bdo not (invoke|trigger|use)\b[^.]*\b(conversation|chat|request)/i.test(description) ||
    /\bscheduled(?:-| )only\b/i.test(description);

  if (declaresNonConversational) return [];
  return [
    {
      rule: "routine/skill-not-marked-scheduled",
      severity: "medium",
      message: `Skill "${skill}" is invoked by a routine but its description does not state that it is not conversationally triggered. It should never win a selection it was not scheduled for.`,
    },
  ];
}

/**
 * The four findings only live reconciliation can produce. Exported as data
 * rather than implemented here on purpose: a plane whose scheduler it owns must
 * reconcile against it, and this package cannot read anyone's machine.
 *
 * The last kind is the dangerous one. Adopting this grammar does not rewrite
 * what a scheduler already holds, so an identifier retained across the change
 * still carries whatever body was installed under it -- typically the inlined
 * procedure this grammar exists to eliminate. A declaration that reads
 * correctly, over a body that would actually run. Nothing in a checkout can see
 * it.
 *
 * This is the routine tier's own wording of the four drift findings
 * `LIVE_STATE_SURFACE_FINDING_KINDS` (`./live-state.ts`) names once, generalized
 * across this package's tiers -- see `conventions/documents/
 * live-state-reconciliation.md`. No behavioural change follows from that: this
 * vocabulary, and `validateRoutineDeclaration`'s checks, stay exactly as they
 * are. What changes is that this list is now documented as a specialization of
 * the shared shape rather than a coincidentally similar one, and a
 * reconciliation surface built against a scheduler that cannot currently be
 * read has a fifth state to report -- `declared-but-not-verifiable`, with a
 * named blocker -- that this tier-specific list deliberately does not carry
 * itself.
 */
export const reconciliationFindingKinds: readonly string[] = Object.freeze([
  "declared-but-not-registered",
  "registered-but-not-declared",
  "registered-in-unrequested-state",
  "registered-body-is-not-a-plain-skill-invocation",
]);
