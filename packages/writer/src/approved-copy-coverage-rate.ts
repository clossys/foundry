/**
 * Computes the Writer charter metric `approved copy coverage rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkCopyRecord` or `checkCopyTraceability`. An empty evaluated set is
 * indeterminate, never a perfect rate of 1. `writer-check` remains the
 * multi-mode CLI.
 */
const METRIC = "approved copy coverage rate" as const;
const RESERVED_OBSERVERS = new Set(["writer", "@clossys/writer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type ApprovedCopyCoverageRateState = "satisfied" | "violated" | "indeterminate";

export interface ApprovedCopyCoverageRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface ApprovedCopyCoverageRateAssessment {
  readonly metric: "approved copy coverage rate";
  readonly state: ApprovedCopyCoverageRateState;
  readonly rate: number | null;
  readonly evaluatedCopy: number;
  readonly approvedCoveredCopy: number;
  readonly findings: readonly ApprovedCopyCoverageRateFinding[];
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

function finding(rule: string, message: string, path?: string): ApprovedCopyCoverageRateFinding {
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
  state: ApprovedCopyCoverageRateState,
  evaluatedCopy: number,
  approvedCoveredCopy: number,
  rate: number | null,
  findings: readonly ApprovedCopyCoverageRateFinding[],
): ApprovedCopyCoverageRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedCopy,
    approvedCoveredCopy,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly approved: boolean;
  readonly traceable: boolean;
  readonly resolvedFromRegistry: boolean;
}

function isCovered(entry: CountingObservation): boolean {
  return entry.approved && entry.traceable && entry.resolvedFromRegistry;
}

/**
 * Computes `approved copy coverage rate`: shipped audience-facing copy
 * resolved from approved traceable registry entries / all shipped
 * audience-facing copy evaluated.
 */
export function assessApprovedCopyCoverageRate(input: unknown): ApprovedCopyCoverageRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: ApprovedCopyCoverageRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredCopy = input.declaredCopy;
  if (!Array.isArray(declaredCopy)) {
    findings.push(finding("declared-copy-required", "declaredCopy must be an array of { id } objects.", "declaredCopy"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredCopy.forEach((item, index) => {
    const path = `declaredCopy[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("copy-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-copy-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-copy-empty", "No declared copy is available for the approved-copy-coverage metric; the rate is indeterminate, never 1.", "declaredCopy"));
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
        findings.push(finding("self-observation", "Writer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.copyId) && !declaredSet.has(item.copyId)) {
        findings.push(finding("unknown-copy", `Observation copyId "${item.copyId}" is not declared copy.`, `${path}.copyId`));
        return;
      }
      if (item.independent !== true) return;
      if (
        typeof item.approved !== "boolean" ||
        typeof item.traceable !== "boolean" ||
        typeof item.resolvedFromRegistry !== "boolean"
      ) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.copyId) || !declaredSet.has(item.copyId)) return;
      const bucket = counting.get(item.copyId) ?? [];
      bucket.push({
        approved: item.approved,
        traceable: item.traceable,
        resolvedFromRegistry: item.resolvedFromRegistry,
      });
      counting.set(item.copyId, bucket);
    });
  }

  let evaluatedCopy = 0;
  let approvedCoveredCopy = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("copy-unevaluated", `Declared copy "${id}" has no counting independent observation.`, `declaredCopy.${id}`));
      continue;
    }
    evaluatedCopy += 1;
    const allCovered = observed.every((entry) => isCovered(entry));
    if (allCovered) approvedCoveredCopy += 1;
    else {
      findings.push(finding("copy-not-covered", `Declared copy "${id}" was independently observed not resolved from an approved traceable registry entry.`, `declaredCopy.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.approved !== first.approved ||
        entry.traceable !== first.traceable ||
        entry.resolvedFromRegistry !== first.resolvedFromRegistry
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedCopy === 0 ? null : approvedCoveredCopy / evaluatedCopy;
  if (evaluatedCopy === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedCopy === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: ApprovedCopyCoverageRateState =
    coverageComplete && approvedCoveredCopy === evaluatedCopy && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedCopy, approvedCoveredCopy, rate, findings);
}
