/**
 * Computes the Builder charter metric `desired-state realization rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not treat an offline
 * declaration check as live proof, and does not grant mutation authority.
 * An empty evaluated set is indeterminate, never a perfect rate of 1.
 */
const METRIC = "desired-state realization rate" as const;
const RESERVED_OBSERVERS = new Set(["builder", "@clossys/builder"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type DesiredStateRealizationState = "satisfied" | "violated" | "indeterminate";

export interface DesiredStateRealizationFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface DesiredStateRealizationAssessment {
  readonly metric: "desired-state realization rate";
  readonly state: DesiredStateRealizationState;
  readonly rate: number | null;
  readonly evaluatedSubjects: number;
  readonly realizedSubjects: number;
  readonly findings: readonly DesiredStateRealizationFinding[];
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

function finding(rule: string, message: string, path?: string): DesiredStateRealizationFinding {
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
  state: DesiredStateRealizationState,
  evaluatedSubjects: number,
  realizedSubjects: number,
  rate: number | null,
  findings: readonly DesiredStateRealizationFinding[],
): DesiredStateRealizationAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedSubjects,
    realizedSubjects,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly verified: boolean;
}

/**
 * Computes `desired-state realization rate`: declared live-state subjects
 * independently verified at their desired state / all declared live-state
 * subjects evaluated.
 */
export function assessDesiredStateRealizationRate(input: unknown): DesiredStateRealizationAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: DesiredStateRealizationFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredSubjects = input.declaredSubjects;
  if (!Array.isArray(declaredSubjects)) {
    findings.push(finding("declared-subjects-required", "declaredSubjects must be an array of { id } objects.", "declaredSubjects"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredSubjects.forEach((item, index) => {
    const path = `declaredSubjects[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("subject-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-subject-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-subjects-empty", "No declared subjects are available for the desired-state realization metric; the rate is indeterminate, never 1.", "declaredSubjects"));
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
        findings.push(finding("self-observation", "Builder cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.subjectId) && !declaredSet.has(item.subjectId)) {
        findings.push(finding("unknown-subject", `Observation subjectId "${item.subjectId}" is not a declared subject.`, `${path}.subjectId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.verified !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.subjectId) || !declaredSet.has(item.subjectId)) return;
      const bucket = counting.get(item.subjectId) ?? [];
      bucket.push({ verified: item.verified });
      counting.set(item.subjectId, bucket);
    });
  }

  let evaluatedSubjects = 0;
  let realizedSubjects = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("subject-unevaluated", `Declared subject "${id}" has no counting independent observation.`, `declaredSubjects.${id}`));
      continue;
    }
    evaluatedSubjects += 1;
    const allRealized = observed.every((entry) => entry.verified === true);
    if (allRealized) realizedSubjects += 1;
    else {
      findings.push(finding("subject-not-realized", `Declared subject "${id}" was independently observed not at its desired state.`, `declaredSubjects.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) => entry.verified !== first.verified);
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedSubjects === 0 ? null : realizedSubjects / evaluatedSubjects;
  if (evaluatedSubjects === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedSubjects === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: DesiredStateRealizationState =
    coverageComplete && realizedSubjects === evaluatedSubjects && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedSubjects, realizedSubjects, rate, findings);
}
