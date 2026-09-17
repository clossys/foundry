/**
 * Computes the Giver charter metric `timely semantic closure rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkHandoffPlacement`, `checkGrounding`, or `checkObligationDischarge`.
 * An empty evaluated set is indeterminate, never a perfect rate of 1.
 */
const METRIC = "timely semantic closure rate" as const;
const RESERVED_OBSERVERS = new Set(["giver", "@clossys/giver"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];
const KINDS = new Set(["due-request", "obligation"]);

export type TimelySemanticClosureRateState = "satisfied" | "violated" | "indeterminate";

export interface TimelySemanticClosureRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface TimelySemanticClosureRateAssessment {
  readonly metric: "timely semantic closure rate";
  readonly state: TimelySemanticClosureRateState;
  readonly rate: number | null;
  readonly evaluatedItems: number;
  readonly closedItems: number;
  readonly findings: readonly TimelySemanticClosureRateFinding[];
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

function finding(rule: string, message: string, path?: string): TimelySemanticClosureRateFinding {
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
  state: TimelySemanticClosureRateState,
  evaluatedItems: number,
  closedItems: number,
  rate: number | null,
  findings: readonly TimelySemanticClosureRateFinding[],
): TimelySemanticClosureRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedItems,
    closedItems,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `timely semantic closure rate`: due requests and obligations with
 * independently verified delivery, refusal, or placed handoff inside the
 * declared window / all due requests and obligations evaluated.
 */
export function assessTimelySemanticClosureRate(input: unknown): TimelySemanticClosureRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: TimelySemanticClosureRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredItems = input.declaredItems;
  if (!Array.isArray(declaredItems)) {
    findings.push(finding("declared-items-required", "declaredItems must be an array of { id, kind } objects.", "declaredItems"));
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
    if (!text(item.kind) || !KINDS.has(item.kind)) {
      findings.push(finding("item-kind-required", 'kind must be "due-request" or "obligation".', `${path}.kind`));
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
    findings.push(finding("declared-items-empty", "No declared due requests or obligations are available for the timely-semantic-closure metric; the rate is indeterminate, never 1.", "declaredItems"));
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
        findings.push(finding("self-observation", "Giver cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.itemId) && !declaredSet.has(item.itemId)) {
        findings.push(finding("unknown-item", `Observation itemId "${item.itemId}" is not a declared item.`, `${path}.itemId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.closedWithinWindow !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.itemId) || !declaredSet.has(item.itemId)) return;
      const bucket = counting.get(item.itemId) ?? [];
      bucket.push(item.closedWithinWindow);
      counting.set(item.itemId, bucket);
    });
  }

  let evaluatedItems = 0;
  let closedItems = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("item-unevaluated", `Declared item "${id}" has no counting independent observation.`, `declaredItems.${id}`));
      continue;
    }
    evaluatedItems += 1;
    const allClosed = observed.every((entry) => entry === true);
    if (allClosed) closedItems += 1;
    else {
      findings.push(finding("item-not-closed", `Declared item "${id}" was independently observed without verified delivery, refusal, or placed handoff inside the declared window.`, `declaredItems.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      if (observed.some((entry) => entry !== first)) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedItems === 0 ? null : closedItems / evaluatedItems;
  if (evaluatedItems === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedItems === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: TimelySemanticClosureRateState =
    coverageComplete && closedItems === evaluatedItems && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedItems, closedItems, rate, findings);
}
