/**
 * Computes the Strategist charter metric `strategy traceability rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkFactsTraceability`. An empty evaluated set is indeterminate, never
 * a perfect rate of 1. `strategist-check` remains the multi-mode CLI.
 */
const METRIC = "strategy traceability rate" as const;
const RESERVED_OBSERVERS = new Set(["strategist", "@clossys/strategist"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type StrategyTraceabilityRateState = "satisfied" | "violated" | "indeterminate";

export interface StrategyTraceabilityRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface StrategyTraceabilityRateAssessment {
  readonly metric: "strategy traceability rate";
  readonly state: StrategyTraceabilityRateState;
  readonly rate: number | null;
  readonly evaluatedClaims: number;
  readonly tracedClaims: number;
  readonly findings: readonly StrategyTraceabilityRateFinding[];
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

function finding(rule: string, message: string, path?: string): StrategyTraceabilityRateFinding {
  return path === undefined ? { rule, severity: "error", message } : { rule, severity: "error", message, path };
}

function evidenceCounts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => record(item) && text(item.id) && text(item.description));
}

function reservedObserver(value: string): boolean {
  return RESERVED_OBSERVERS.has(value.trim().toLowerCase());
}

function report(
  state: StrategyTraceabilityRateState,
  evaluatedClaims: number,
  tracedClaims: number,
  rate: number | null,
  findings: readonly StrategyTraceabilityRateFinding[],
): StrategyTraceabilityRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedClaims,
    tracedClaims,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly currentEvidence: boolean;
  readonly derived: boolean;
  readonly approved: boolean;
}

function isTraced(entry: CountingObservation): boolean {
  return entry.currentEvidence && entry.derived && entry.approved;
}

/**
 * Computes `strategy traceability rate`: material strategy and brand claims
 * with current evidence, derivation, and approval / all material strategy
 * and brand claims evaluated.
 */
export function assessStrategyTraceabilityRate(input: unknown): StrategyTraceabilityRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: StrategyTraceabilityRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredClaims = input.declaredClaims;
  if (!Array.isArray(declaredClaims)) {
    findings.push(finding("declared-claims-required", "declaredClaims must be an array of { id } objects.", "declaredClaims"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredClaims.forEach((item, index) => {
    const path = `declaredClaims[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("claim-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-claim-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-claims-empty", "No declared claims are available for the strategy-traceability metric; the rate is indeterminate, never 1.", "declaredClaims"));
  }

  const observations = input.observations;
  if (observations !== undefined && !Array.isArray(observations)) {
    findings.push(finding("observations-shape", "observations must be an array.", "observations"));
  }

  const counting = new Map<string, CountingObservation[]>();
  if (Array.isArray(observations)) {
    observations.forEach((item, index) => {
      const path = `observations[${index}]`;
      if (!record(item)) {
        findings.push(finding("observation-shape", "An observation must be an object.", path));
        return;
      }
      if (text(item.observerRef) && reservedObserver(item.observerRef)) {
        findings.push(finding("self-observation", "Strategist cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.claimId) && !declaredSet.has(item.claimId)) {
        findings.push(finding("unknown-claim", `Observation claimId "${item.claimId}" is not a declared claim.`, `${path}.claimId`));
        return;
      }
      if (item.independent !== true) return;
      if (
        typeof item.currentEvidence !== "boolean" ||
        typeof item.derived !== "boolean" ||
        typeof item.approved !== "boolean"
      ) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.claimId) || !declaredSet.has(item.claimId)) return;
      const bucket = counting.get(item.claimId) ?? [];
      bucket.push({
        currentEvidence: item.currentEvidence,
        derived: item.derived,
        approved: item.approved,
      });
      counting.set(item.claimId, bucket);
    });
  }

  let evaluatedClaims = 0;
  let tracedClaims = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("claim-unevaluated", `Declared claim "${id}" has no counting independent observation.`, `declaredClaims.${id}`));
      continue;
    }
    evaluatedClaims += 1;
    const allTraced = observed.every((entry) => isTraced(entry));
    if (allTraced) tracedClaims += 1;
    else {
      findings.push(finding("claim-not-traced", `Declared claim "${id}" was independently observed without current evidence, derivation, and approval.`, `declaredClaims.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.currentEvidence !== first.currentEvidence ||
        entry.derived !== first.derived ||
        entry.approved !== first.approved
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedClaims === 0 ? null : tracedClaims / evaluatedClaims;
  if (evaluatedClaims === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedClaims === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: StrategyTraceabilityRateState =
    coverageComplete && tracedClaims === evaluatedClaims && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedClaims, tracedClaims, rate, findings);
}
