/**
 * Computes the Influencer charter metric `qualified response yield per
 * thousand` from consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkResponseYield` or its kebab metric
 * `qualified-response-yield-per-thousand`. An empty eligible-exposure set
 * is indeterminate, never a perfect yield. `influencer-check` remains the
 * two-argument CLI.
 */
const METRIC = "qualified response yield per thousand" as const;
const RESERVED_OBSERVERS = new Set(["influencer", "@clossys/influencer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type QualifiedResponseYieldState = "satisfied" | "violated" | "indeterminate";

export interface QualifiedResponseYieldFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface QualifiedResponseYieldAssessment {
  readonly metric: "qualified response yield per thousand";
  readonly state: QualifiedResponseYieldState;
  readonly rate: number | null;
  readonly eligibleExposures: number;
  readonly qualifiedResponses: number;
  readonly setpointPerThousand: number | null;
  readonly findings: readonly QualifiedResponseYieldFinding[];
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

function finding(rule: string, message: string, path?: string): QualifiedResponseYieldFinding {
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
  state: QualifiedResponseYieldState,
  eligibleExposures: number,
  qualifiedResponses: number,
  rate: number | null,
  setpointPerThousand: number | null,
  findings: readonly QualifiedResponseYieldFinding[],
): QualifiedResponseYieldAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    eligibleExposures,
    qualifiedResponses,
    setpointPerThousand,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `qualified response yield per thousand`: 1000 * independently
 * observed qualified audience responses / independently observed eligible
 * exposures.
 */
export function assessQualifiedResponseYieldPerThousand(input: unknown): QualifiedResponseYieldAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: QualifiedResponseYieldFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const setpoint = input.setpointPerThousand;
  const setpointPerThousand =
    typeof setpoint === "number" && Number.isFinite(setpoint) && setpoint > 0 ? setpoint : null;
  if (setpointPerThousand === null) {
    findings.push(finding("setpoint-required", "setpointPerThousand must be a positive finite number.", "setpointPerThousand"));
  }

  const declaredExposures = input.declaredExposures;
  if (!Array.isArray(declaredExposures)) {
    findings.push(finding("declared-exposures-required", "declaredExposures must be an array of { id } objects.", "declaredExposures"));
    return report("indeterminate", 0, 0, null, setpointPerThousand, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredExposures.forEach((item, index) => {
    const path = `declaredExposures[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("exposure-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-exposure-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-exposures-empty", "No independently observed eligible exposures are available for the qualified-response-yield metric; the yield is indeterminate, never a perfect yield.", "declaredExposures"));
  }

  const observations = input.observations;
  if (observations !== undefined && !Array.isArray(observations)) {
    findings.push(finding("observations-shape", "observations must be an array.", "observations"));
  }

  const exposureCounting = new Map<string, boolean[]>();
  const responseIds = new Set<string>();
  let qualifiedResponses = 0;

  if (Array.isArray(observations)) {
    observations.forEach((item, index) => {
      const path = `observations[${index}]`;
      if (!record(item)) {
        findings.push(finding("observation-shape", "An observation must be an object.", path));
        return;
      }
      if (text(item.observerRef) && reservedObserver(item.observerRef)) {
        findings.push(finding("self-observation", "Influencer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (item.independent !== true) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence)) return;

      if (item.kind === "exposure") {
        if (text(item.exposureId) && !declaredSet.has(item.exposureId)) {
          findings.push(finding("unknown-exposure", `Observation exposureId "${item.exposureId}" is not a declared exposure.`, `${path}.exposureId`));
          return;
        }
        if (typeof item.eligible !== "boolean" || !text(item.exposureId) || !declaredSet.has(item.exposureId)) return;
        const bucket = exposureCounting.get(item.exposureId) ?? [];
        bucket.push(item.eligible);
        exposureCounting.set(item.exposureId, bucket);
        return;
      }

      if (item.kind === "response") {
        if (typeof item.qualified !== "boolean" || !text(item.responseId)) return;
        if (responseIds.has(item.responseId)) {
          findings.push(finding("duplicate-response-id", `Duplicate responseId "${item.responseId}".`, `${path}.responseId`));
          return;
        }
        responseIds.add(item.responseId);
        if (item.qualified) qualifiedResponses += 1;
      }
    });
  }

  let evaluatedExposures = 0;
  let eligibleExposures = 0;
  for (const id of declaredIds) {
    const observed = exposureCounting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("exposure-unevaluated", `Declared exposure "${id}" has no counting independent observation.`, `declaredExposures.${id}`));
      continue;
    }
    evaluatedExposures += 1;
    const allEligible = observed.every((entry) => entry);
    if (allEligible) eligibleExposures += 1;
    if (observed.length > 1 && observed.some((entry) => entry !== observed[0])) {
      findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
    }
  }

  if (eligibleExposures === 0) {
    findings.push(finding("eligible-exposures-empty", "No independently observed eligible exposures are available for the qualified-response-yield metric; the yield is indeterminate, never a perfect yield.", "declaredExposures"));
    return report("indeterminate", 0, qualifiedResponses, null, setpointPerThousand, findings);
  }

  const rate = (1_000 * qualifiedResponses) / eligibleExposures;
  const coverageComplete = evaluatedExposures === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const meetsSetpoint = setpointPerThousand !== null && rate >= setpointPerThousand;
  const state: QualifiedResponseYieldState =
    coverageComplete && meetsSetpoint && noErrorFindings ? "satisfied" : "violated";
  return report(state, eligibleExposures, qualifiedResponses, rate, setpointPerThousand, findings);
}
