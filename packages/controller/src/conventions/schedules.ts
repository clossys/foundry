import type { Finding, ScheduleDeclaration, ScheduleRegistry } from "./types.js";

/**
 * Schedule declarations: a pointer to deployed code driven by a stranger's
 * clock. See `conventions/documents/schedule-declaration.md`.
 *
 * The sibling of `routines.ts`, deliberately not merged with it. Everything
 * here is deterministic and reads only what the caller passes in: whether an
 * artifact is actually deployed, and whether the host holds the cadence
 * declared for it, are facts about someone else's infrastructure. See
 * `scheduleReconciliationFindingKinds` for the answers only a live probe can
 * give.
 */

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An absolute path in a declaration, written without this file holding one. */
const ABSOLUTE_PATH = /(?<![\w.\-*/~>}])(?:\/|~\/|[A-Za-z]:[\\/])[A-Za-z0-9._][A-Za-z0-9._-]*/;

/**
 * One field of a cron expression: a wildcard, a number, or a range, each
 * optionally stepped, and any of those in a comma-separated list.
 */
const CRON_FIELD = /^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?(?:,(?:\*|\d+(?:-\d+)?)(?:\/\d+)?)*$/;

const REQUIRED_FIELDS = [
  "id",
  "cadence",
  "scope",
  "executionHost",
  "artifact",
  "purpose",
] as const;

/** True when `cadence` is a five-field cron expression a host could match. */
export function isCronExpression(cadence: string): boolean {
  const fields = cadence.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => CRON_FIELD.test(field));
}

/**
 * Validate one declaration's internal consistency against a plane's registry.
 */
export function validateScheduleDeclaration(
  declaration: ScheduleDeclaration,
  registry: ScheduleRegistry,
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
        rule: "schedule/missing-field",
        severity: "high",
        message: `Schedule "${declaration?.id ?? "(no id)"}" is missing required field "${field}".`,
      });
    }
  }
  if (findings.length > 0) return findings;

  if (!IDENTIFIER.test(declaration.id)) {
    findings.push({
      rule: "schedule/malformed-id",
      severity: "high",
      message: `Schedule id "${declaration.id}" must be lowercase kebab case.`,
    });
  }

  // A schedule's clock belongs to a stranger, so its cadence must be the
  // expression that stranger reads. A word here would be a cadence only the
  // declaring plane could interpret, describing work it does not run.
  if (!isCronExpression(declaration.cadence)) {
    findings.push({
      rule: "schedule/malformed-cadence",
      severity: "high",
      message: `Schedule "${declaration.id}" declares cadence "${declaration.cadence}", which is not a five-field cron expression. A schedule states the expression its host will match, never a word.`,
    });
  }

  if (!registry.hosts.includes(declaration.executionHost)) {
    findings.push({
      rule: "schedule/unknown-host",
      severity: "high",
      message: `Execution host "${declaration.executionHost}" is not in this plane's declared list: ${registry.hosts.join(", ")}`,
    });
  }

  // Scope is closed for the same reason it is closed in the routine tier, and
  // decides something further here: a schedule acting on several repositories
  // belongs to the plane governing them, not to whichever one hosted it first.
  for (const identifier of declaration.scope) {
    if (!registry.repositories.includes(identifier)) {
      findings.push({
        rule: "schedule/scope-outside-plane",
        severity: "high",
        message: `Schedule "${declaration.id}" scopes "${identifier}", which this plane does not govern. A schedule reaching past its plane is standing authority over work the plane does not own.`,
      });
    }
  }

  if (ABSOLUTE_PATH.test(declaration.artifact)) {
    findings.push({
      rule: "schedule/absolute-artifact",
      severity: "high",
      message: `Schedule "${declaration.id}" locates its artifact at an absolute path. A path frozen at authoring time survives no migration, and a declaration that still reads correctly while pointing at nothing is worse than one that is obviously broken.`,
    });
  }

  if (ABSOLUTE_PATH.test(declaration.purpose)) {
    findings.push({
      rule: "schedule/absolute-path",
      severity: "high",
      message: `Schedule "${declaration.id}" writes an absolute path into its declaration.`,
    });
  }

  // Where the artifact dispatches by matching a fired cadence against its own
  // table, the declaration and the host's trigger list are two copies of one
  // fact. Disagreement raises nothing: the clock fires, no branch matches, and
  // the work silently does not happen.
  if (declaration.hostTriggers !== undefined) {
    if (declaration.hostTriggers.length === 0) {
      findings.push({
        rule: "schedule/empty-host-triggers",
        severity: "high",
        message: `Schedule "${declaration.id}" declares an empty host trigger list. Omit the field entirely when the host holds no trigger table.`,
      });
    } else if (!declaration.hostTriggers.includes(declaration.cadence)) {
      findings.push({
        rule: "schedule/cadence-absent-from-host-triggers",
        severity: "high",
        message: `Schedule "${declaration.id}" declares cadence "${declaration.cadence}", which its host's trigger list does not contain (${declaration.hostTriggers.join(", ")}). This never fires, and never errors.`,
      });
    }
  }

  return findings;
}

/** Work deliberately kept off a clock, with a reason. */
export interface ScheduleExclusion {
  readonly id: string;
  readonly reason: string;
}

export interface ScheduleSetOptions {
  /**
   * Work deliberately kept off a clock. An absent exclusion is
   * indistinguishable from an oversight, and an oversight is what a later
   * reader helpfully corrects.
   */
  readonly exclusions?: readonly ScheduleExclusion[];
}

/**
 * Validate a whole set, adding the rules a single declaration cannot express.
 */
export function validateScheduleSet(
  declarations: readonly ScheduleDeclaration[],
  registry: ScheduleRegistry,
  options: ScheduleSetOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const declaration of declarations) {
    if (declaration?.id) {
      if (seen.has(declaration.id)) {
        findings.push({
          rule: "schedule/duplicate-id",
          severity: "high",
          message: `Schedule id "${declaration.id}" is declared more than once. Identifiers must be unique within a plane.`,
        });
      }
      seen.add(declaration.id);
    }
    findings.push(...validateScheduleDeclaration(declaration, registry));
  }

  // The set-level half of trigger correspondence, and the one a single
  // declaration cannot see. Several schedules commonly share one artifact, each
  // claiming a different cadence from that artifact's trigger table. A trigger
  // no schedule claims is a clock firing into a table with no matching branch:
  // the host reports a successful invocation, and nothing happens.
  const byArtifact = new Map<string, ScheduleDeclaration[]>();
  for (const declaration of declarations) {
    if (!declaration?.artifact || declaration.hostTriggers === undefined) continue;
    const key = `${declaration.executionHost} ${declaration.artifact}`;
    byArtifact.set(key, [...(byArtifact.get(key) ?? []), declaration]);
  }

  for (const group of byArtifact.values()) {
    const [first] = group;
    if (!first) continue;
    const claimed = new Set(group.map((declaration) => declaration.cadence));
    // Every member of a group describes the same artifact, so they must agree
    // on what that artifact's host holds. Disagreement is itself the finding.
    const triggerSets = new Set(
      group.map((declaration) => [...(declaration.hostTriggers ?? [])].sort().join(" ")),
    );
    if (triggerSets.size > 1) {
      findings.push({
        rule: "schedule/inconsistent-host-triggers",
        severity: "high",
        message: `Schedules ${group.map((d) => `"${d.id}"`).join(", ")} share artifact "${first.artifact}" but declare different host trigger lists. They describe one trigger table and must agree on it.`,
      });
      continue;
    }
    for (const trigger of first.hostTriggers ?? []) {
      if (!claimed.has(trigger)) {
        findings.push({
          rule: "schedule/unclaimed-host-trigger",
          severity: "high",
          message: `Artifact "${first.artifact}" declares host trigger "${trigger}", which no schedule claims. That clock fires into nothing, and the host still reports it as a successful invocation.`,
        });
      }
    }
  }

  for (const exclusion of options.exclusions ?? []) {
    const raw = exclusion as unknown as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      findings.push({
        rule: "schedule/malformed-exclusion",
        severity: "high",
        message: "An excluded schedule records no identifier.",
      });
    }
    if (typeof raw.reason !== "string" || raw.reason.trim() === "") {
      findings.push({
        rule: "schedule/exclusion-without-reason",
        severity: "medium",
        message: `Excluded schedule "${String(raw.id ?? "(no id)")}" records no reason. An unexplained exclusion reads as an oversight.`,
      });
    }
  }

  return findings;
}

/**
 * The findings only a live probe can produce. Exported as data rather than
 * implemented here for the same reason the routine tier does it: this package
 * cannot read anyone's infrastructure.
 *
 * The last kind is this tier's dangerous one, and it is wider than its routine
 * counterpart. Deployment is usually a manual step that merging does not
 * perform, so an artifact can be merged, reviewed and correct while the host
 * keeps running an older copy — producing no error, no alert, and no diff.
 *
 * This is the schedule tier's own wording of the four drift findings
 * `LIVE_STATE_SURFACE_FINDING_KINDS` (`./live-state.ts`) names once, generalized
 * across this package's tiers — see `conventions/documents/
 * live-state-reconciliation.md`. No behavioural change follows from that: this
 * vocabulary, and `validateScheduleDeclaration`'s checks, stay exactly as they
 * are. What changes is that this list is now documented as a specialization of
 * the shared shape rather than a coincidentally similar one, and a
 * reconciliation surface built against a host that cannot currently be read
 * has a fifth state to report — `declared-but-not-verifiable`, with a named
 * blocker — that this tier-specific list deliberately does not carry itself.
 */
export const scheduleReconciliationFindingKinds: readonly string[] = Object.freeze([
  "declared-but-not-deployed",
  "deployed-but-not-declared",
  "deployed-cadence-differs-from-declared",
  "deployed-artifact-predates-its-declaration",
]);
