/**
 * Computes the Customer charter metric `customer keep rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkKeepForm` or `customer-check`. Feedback, compare, refer, and churn
 * testimony never enters this rate. An empty evaluated set is
 * indeterminate, never a perfect rate of 1. `customer-check` remains the
 * two-argument CLI.
 */
const METRIC = "customer keep rate" as const;
const RESERVED_OBSERVERS = new Set(["customer", "@clossys/customer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type CustomerKeepRateState = "satisfied" | "violated" | "indeterminate";

export interface CustomerKeepRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface CustomerKeepRateAssessment {
  readonly metric: "customer keep rate";
  readonly state: CustomerKeepRateState;
  readonly rate: number | null;
  readonly evaluatedCandidates: number;
  readonly keptCandidates: number;
  readonly findings: readonly CustomerKeepRateFinding[];
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

function finding(rule: string, message: string, path?: string): CustomerKeepRateFinding {
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
  state: CustomerKeepRateState,
  evaluatedCandidates: number,
  keptCandidates: number,
  rate: number | null,
  findings: readonly CustomerKeepRateFinding[],
): CustomerKeepRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedCandidates,
    keptCandidates,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly kept: boolean;
}

/**
 * Computes `customer keep rate`: independently observed first-person keeps /
 * all candidates independently inhabited before seal or land.
 */
export function assessCustomerKeepRate(input: unknown): CustomerKeepRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: CustomerKeepRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredCandidates = input.declaredCandidates;
  if (!Array.isArray(declaredCandidates)) {
    findings.push(finding("declared-candidates-required", "declaredCandidates must be an array of { id } objects.", "declaredCandidates"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredCandidates.forEach((item, index) => {
    const path = `declaredCandidates[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("candidate-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-candidate-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(
      finding(
        "declared-candidates-empty",
        "No declared candidate is available for the customer-keep metric; the rate is indeterminate, never 1.",
        "declaredCandidates",
      ),
    );
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
        findings.push(
          finding("self-observation", "Customer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`),
        );
        return;
      }
      if (text(item.candidateId) && !declaredSet.has(item.candidateId)) {
        findings.push(finding("unknown-candidate", `Observation candidateId "${item.candidateId}" is not a declared candidate.`, `${path}.candidateId`));
        return;
      }
      if (item.independent !== true) return;
      if (item.inhabited !== true) return;
      if (typeof item.intent === "string" && item.intent !== "keep") return;
      if (typeof item.kept !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.candidateId) || !declaredSet.has(item.candidateId)) return;
      const bucket = counting.get(item.candidateId) ?? [];
      bucket.push({ kept: item.kept });
      counting.set(item.candidateId, bucket);
    });
  }

  let evaluatedCandidates = 0;
  let keptCandidates = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(
        finding("candidate-unevaluated", `Declared candidate "${id}" has no counting independent observation.`, `declaredCandidates.${id}`),
      );
      continue;
    }
    evaluatedCandidates += 1;
    const allKept = observed.every((entry) => entry.kept);
    if (allKept) keptCandidates += 1;
    else {
      findings.push(
        finding("candidate-not-kept", `Declared candidate "${id}" was independently inhabited and not kept.`, `declaredCandidates.${id}`),
      );
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) => entry.kept !== first.kept);
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedCandidates === 0 ? null : keptCandidates / evaluatedCandidates;
  if (evaluatedCandidates === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedCandidates === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: CustomerKeepRateState =
    coverageComplete && keptCandidates === evaluatedCandidates && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedCandidates, keptCandidates, rate, findings);
}
