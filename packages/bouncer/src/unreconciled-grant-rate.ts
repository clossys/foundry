/**
 * Computes the Bouncer charter metric `unreconciled grant rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not contact a provider, and
 * does not relabel `checkAuthorityReconciliation` (unreconciled grant surface
 * is a count that is 0 on an empty set). An empty evaluated set is
 * indeterminate, never a perfect rate of 0. Unverifiable observations are
 * unevaluated, never folded into this rate. Grant expiry is not this metric.
 */
const METRIC = "unreconciled grant rate" as const;
const RESERVED_OBSERVERS = new Set(["bouncer", "@clossys/bouncer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type UnreconciledGrantRateState = "satisfied" | "violated" | "indeterminate";

export interface UnreconciledGrantRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface UnreconciledGrantRateAssessment {
  readonly metric: "unreconciled grant rate";
  readonly state: UnreconciledGrantRateState;
  readonly rate: number | null;
  readonly evaluatedGrants: number;
  readonly unreconciledGrants: number;
  readonly findings: readonly UnreconciledGrantRateFinding[];
  readonly proposedPositions: readonly unknown[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): value is string {
  return text(value) && !Number.isNaN(Date.parse(value));
}

function finding(rule: string, message: string, path?: string): UnreconciledGrantRateFinding {
  return path === undefined ? { rule, severity: "error", message } : { rule, severity: "error", message, path };
}

function evidenceCounts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => record(item) && text(item.id) && text(item.description));
}

function reservedObserver(value: string): boolean {
  return RESERVED_OBSERVERS.has(value.trim().toLowerCase());
}

function unverifiable(item: UnknownRecord): boolean {
  return item.unverifiable === true || item.reachability === "unreachable";
}

function report(
  state: UnreconciledGrantRateState,
  evaluatedGrants: number,
  unreconciledGrants: number,
  rate: number | null,
  findings: readonly UnreconciledGrantRateFinding[],
): UnreconciledGrantRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedGrants,
    unreconciledGrants,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `unreconciled grant rate`: live grants not independently backed by
 * their current provider of record / all live grants evaluated.
 */
export function assessUnreconciledGrantRate(input: unknown): UnreconciledGrantRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: UnreconciledGrantRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredGrants = input.declaredGrants;
  if (!Array.isArray(declaredGrants)) {
    findings.push(finding("declared-grants-required", "declaredGrants must be an array of { id } objects.", "declaredGrants"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredGrants.forEach((item, index) => {
    const path = `declaredGrants[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("grant-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-grant-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-grants-empty", "No declared grants are available for the unreconciled-grant metric; the rate is indeterminate, never 0.", "declaredGrants"));
  }

  const observations = input.observations;
  if (observations !== undefined && !Array.isArray(observations)) {
    findings.push(finding("observations-shape", "observations must be an array.", "observations"));
  }

  const counting = new Map<string, boolean[]>();
  if (Array.isArray(observations)) {
    observations.forEach((item, index) => {
      const path = `observations[${index}]`;
      if (!record(item)) {
        findings.push(finding("observation-shape", "An observation must be an object.", path));
        return;
      }
      if (text(item.observerRef) && reservedObserver(item.observerRef)) {
        findings.push(finding("self-observation", "Bouncer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.grantId) && !declaredSet.has(item.grantId)) {
        findings.push(finding("unknown-grant", `Observation grantId "${item.grantId}" is not a declared grant.`, `${path}.grantId`));
        return;
      }
      if (item.independent !== true) return;
      if (unverifiable(item)) return;
      if (typeof item.backed !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.grantId) || !declaredSet.has(item.grantId)) return;
      const bucket = counting.get(item.grantId) ?? [];
      bucket.push(item.backed);
      counting.set(item.grantId, bucket);
    });
  }

  let evaluatedGrants = 0;
  let unreconciledGrants = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("grant-unevaluated", `Declared grant "${id}" has no counting independent observation.`, `declaredGrants.${id}`));
      continue;
    }
    evaluatedGrants += 1;
    const allBacked = observed.every((entry) => entry === true);
    if (!allBacked) {
      unreconciledGrants += 1;
      findings.push(finding("grant-unreconciled", `Declared grant "${id}" was independently observed not backed by its current provider of record.`, `declaredGrants.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      if (observed.some((entry) => entry !== first)) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedGrants === 0 ? null : unreconciledGrants / evaluatedGrants;
  if (evaluatedGrants === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedGrants === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: UnreconciledGrantRateState =
    coverageComplete && unreconciledGrants === 0 && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedGrants, unreconciledGrants, rate, findings);
}
