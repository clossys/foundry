/**
 * Computes the Keeper charter metric `justified visible holding rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not write holdings, and
 * does not relabel `checkAttribution`, `checkVisibility`, or
 * `checkDisposal`. An empty evaluated set is indeterminate, never a
 * perfect rate of 1. No person-attributable record is read or written.
 */
const METRIC = "justified visible holding rate" as const;
const RESERVED_OBSERVERS = new Set(["keeper", "@clossys/keeper"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type JustifiedVisibleHoldingRateState = "satisfied" | "violated" | "indeterminate";

export interface JustifiedVisibleHoldingRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface JustifiedVisibleHoldingRateAssessment {
  readonly metric: "justified visible holding rate";
  readonly state: JustifiedVisibleHoldingRateState;
  readonly rate: number | null;
  readonly evaluatedItems: number;
  readonly justifiedVisibleItems: number;
  readonly findings: readonly JustifiedVisibleHoldingRateFinding[];
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

function finding(rule: string, message: string, path?: string): JustifiedVisibleHoldingRateFinding {
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
  state: JustifiedVisibleHoldingRateState,
  evaluatedItems: number,
  justifiedVisibleItems: number,
  rate: number | null,
  findings: readonly JustifiedVisibleHoldingRateFinding[],
): JustifiedVisibleHoldingRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedItems,
    justifiedVisibleItems,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly attributed: boolean;
  readonly subjectVisibleCorrectable: boolean;
  readonly currentRetention: boolean;
}

function isJustifiedVisible(entry: CountingObservation): boolean {
  return entry.attributed && entry.subjectVisibleCorrectable && entry.currentRetention;
}

/**
 * Computes `justified visible holding rate`: held items with valid
 * attribution, a subject-visible correctable route, and current retention
 * basis / all held items evaluated.
 */
export function assessJustifiedVisibleHoldingRate(input: unknown): JustifiedVisibleHoldingRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: JustifiedVisibleHoldingRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredItems = input.declaredItems;
  if (!Array.isArray(declaredItems)) {
    findings.push(finding("declared-items-required", "declaredItems must be an array of { id } objects.", "declaredItems"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredItems.forEach((item, index) => {
    const path = `declaredItems[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("item-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-item-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-items-empty", "No declared held items are available for the justified-visible-holding metric; the rate is indeterminate, never 1.", "declaredItems"));
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
        findings.push(finding("self-observation", "Keeper cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.itemId) && !declaredSet.has(item.itemId)) {
        findings.push(finding("unknown-item", `Observation itemId "${item.itemId}" is not a declared item.`, `${path}.itemId`));
        return;
      }
      if (item.independent !== true) return;
      if (
        typeof item.attributed !== "boolean" ||
        typeof item.subjectVisibleCorrectable !== "boolean" ||
        typeof item.currentRetention !== "boolean"
      ) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.itemId) || !declaredSet.has(item.itemId)) return;
      const bucket = counting.get(item.itemId) ?? [];
      bucket.push({
        attributed: item.attributed,
        subjectVisibleCorrectable: item.subjectVisibleCorrectable,
        currentRetention: item.currentRetention,
      });
      counting.set(item.itemId, bucket);
    });
  }

  let evaluatedItems = 0;
  let justifiedVisibleItems = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("item-unevaluated", `Declared item "${id}" has no counting independent observation.`, `declaredItems.${id}`));
      continue;
    }
    evaluatedItems += 1;
    const allJustified = observed.every((entry) => isJustifiedVisible(entry));
    if (allJustified) justifiedVisibleItems += 1;
    else {
      findings.push(finding("item-not-justified-visible", `Declared item "${id}" was independently observed without valid attribution, a subject-visible correctable route, and current retention basis.`, `declaredItems.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.attributed !== first.attributed ||
        entry.subjectVisibleCorrectable !== first.subjectVisibleCorrectable ||
        entry.currentRetention !== first.currentRetention
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedItems === 0 ? null : justifiedVisibleItems / evaluatedItems;
  if (evaluatedItems === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedItems === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: JustifiedVisibleHoldingRateState =
    coverageComplete && justifiedVisibleItems === evaluatedItems && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedItems, justifiedVisibleItems, rate, findings);
}
