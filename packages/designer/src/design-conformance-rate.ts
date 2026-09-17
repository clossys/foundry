/**
 * Computes the Designer charter metric `design conformance rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `designer-token-check`, `designer-brand-check`, `designer-contrast-check`,
 * or `designer-environment-check`. An empty evaluated set is indeterminate,
 * never a perfect rate of 1. Those bins remain the gates they are.
 */
const METRIC = "design conformance rate" as const;
const RESERVED_OBSERVERS = new Set(["designer", "@clossys/designer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type DesignConformanceRateState = "satisfied" | "violated" | "indeterminate";

export interface DesignConformanceRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface DesignConformanceRateAssessment {
  readonly metric: "design conformance rate";
  readonly state: DesignConformanceRateState;
  readonly rate: number | null;
  readonly evaluatedSurfaces: number;
  readonly conformingSurfaces: number;
  readonly findings: readonly DesignConformanceRateFinding[];
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

function finding(rule: string, message: string, path?: string): DesignConformanceRateFinding {
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
  state: DesignConformanceRateState,
  evaluatedSurfaces: number,
  conformingSurfaces: number,
  rate: number | null,
  findings: readonly DesignConformanceRateFinding[],
): DesignConformanceRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedSurfaces,
    conformingSurfaces,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly tokenConforming: boolean;
  readonly brandConforming: boolean;
  readonly structureConforming: boolean;
  readonly accessibilityConforming: boolean;
}

function isConforming(entry: CountingObservation): boolean {
  return entry.tokenConforming && entry.brandConforming && entry.structureConforming && entry.accessibilityConforming;
}

/**
 * Computes `design conformance rate`: evaluated interface surfaces
 * satisfying declared token, brand, structure, and accessibility
 * constraints / all interface surfaces evaluated.
 */
export function assessDesignConformanceRate(input: unknown): DesignConformanceRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: DesignConformanceRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredSurfaces = input.declaredSurfaces;
  if (!Array.isArray(declaredSurfaces)) {
    findings.push(finding("declared-surfaces-required", "declaredSurfaces must be an array of { id } objects.", "declaredSurfaces"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredSurfaces.forEach((item, index) => {
    const path = `declaredSurfaces[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("surface-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-surface-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-surfaces-empty", "No declared interface surfaces are available for the design-conformance metric; the rate is indeterminate, never 1.", "declaredSurfaces"));
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
        findings.push(finding("self-observation", "Designer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.surfaceId) && !declaredSet.has(item.surfaceId)) {
        findings.push(finding("unknown-surface", `Observation surfaceId "${item.surfaceId}" is not a declared surface.`, `${path}.surfaceId`));
        return;
      }
      if (item.independent !== true) return;
      if (
        typeof item.tokenConforming !== "boolean" ||
        typeof item.brandConforming !== "boolean" ||
        typeof item.structureConforming !== "boolean" ||
        typeof item.accessibilityConforming !== "boolean"
      ) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.surfaceId) || !declaredSet.has(item.surfaceId)) return;
      const bucket = counting.get(item.surfaceId) ?? [];
      bucket.push({
        tokenConforming: item.tokenConforming,
        brandConforming: item.brandConforming,
        structureConforming: item.structureConforming,
        accessibilityConforming: item.accessibilityConforming,
      });
      counting.set(item.surfaceId, bucket);
    });
  }

  let evaluatedSurfaces = 0;
  let conformingSurfaces = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("surface-unevaluated", `Declared surface "${id}" has no counting independent observation.`, `declaredSurfaces.${id}`));
      continue;
    }
    evaluatedSurfaces += 1;
    const allConforming = observed.every((entry) => isConforming(entry));
    if (allConforming) conformingSurfaces += 1;
    else {
      findings.push(finding("surface-not-conforming", `Declared surface "${id}" was independently observed not satisfying declared token, brand, structure, and accessibility constraints.`, `declaredSurfaces.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.tokenConforming !== first.tokenConforming ||
        entry.brandConforming !== first.brandConforming ||
        entry.structureConforming !== first.structureConforming ||
        entry.accessibilityConforming !== first.accessibilityConforming
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedSurfaces === 0 ? null : conformingSurfaces / evaluatedSurfaces;
  if (evaluatedSurfaces === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedSurfaces === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: DesignConformanceRateState =
    coverageComplete && conformingSurfaces === evaluatedSurfaces && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedSurfaces, conformingSurfaces, rate, findings);
}
