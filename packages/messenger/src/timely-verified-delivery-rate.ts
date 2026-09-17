/**
 * Computes the Messenger charter metric `timely verified delivery rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkDeliveryClosure` (kebab `timely-verified-delivery-rate` with a
 * setpoint). An empty evaluated set is indeterminate, never a perfect rate
 * of 1. `messenger-check delivery-closure` stays that gate.
 */
const METRIC = "timely verified delivery rate" as const;
const RESERVED_OBSERVERS = new Set(["messenger", "@clossys/messenger"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type TimelyVerifiedDeliveryRateState = "satisfied" | "violated" | "indeterminate";

export interface TimelyVerifiedDeliveryRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface TimelyVerifiedDeliveryRateAssessment {
  readonly metric: "timely verified delivery rate";
  readonly state: TimelyVerifiedDeliveryRateState;
  readonly rate: number | null;
  readonly evaluatedIntents: number;
  readonly timelyIntents: number;
  readonly findings: readonly TimelyVerifiedDeliveryRateFinding[];
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

function finding(rule: string, message: string, path?: string): TimelyVerifiedDeliveryRateFinding {
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
  state: TimelyVerifiedDeliveryRateState,
  evaluatedIntents: number,
  timelyIntents: number,
  rate: number | null,
  findings: readonly TimelyVerifiedDeliveryRateFinding[],
): TimelyVerifiedDeliveryRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedIntents,
    timelyIntents,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `timely verified delivery rate`: authorized delivery intents due
 * and independently observed delivered within their declared window / all
 * authorized delivery intents due.
 */
export function assessTimelyVerifiedDeliveryRate(input: unknown): TimelyVerifiedDeliveryRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: TimelyVerifiedDeliveryRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredIntents = input.declaredIntents;
  if (!Array.isArray(declaredIntents)) {
    findings.push(finding("declared-intents-required", "declaredIntents must be an array of { id } objects naming authorized delivery intents that are due.", "declaredIntents"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredIntents.forEach((item, index) => {
    const path = `declaredIntents[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("intent-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-intent-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-intents-empty", "No due authorized delivery intents are available for the timely-verified-delivery metric; the rate is indeterminate, never 1.", "declaredIntents"));
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
        findings.push(finding("self-observation", "Messenger cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.intentId) && !declaredSet.has(item.intentId)) {
        findings.push(finding("unknown-intent", `Observation intentId "${item.intentId}" is not a declared due intent.`, `${path}.intentId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.deliveredWithinWindow !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.intentId) || !declaredSet.has(item.intentId)) return;
      const bucket = counting.get(item.intentId) ?? [];
      bucket.push(item.deliveredWithinWindow);
      counting.set(item.intentId, bucket);
    });
  }

  let evaluatedIntents = 0;
  let timelyIntents = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("intent-unevaluated", `Declared due intent "${id}" has no counting independent observation.`, `declaredIntents.${id}`));
      continue;
    }
    evaluatedIntents += 1;
    const allTimely = observed.every((entry) => entry === true);
    if (allTimely) timelyIntents += 1;
    else {
      findings.push(finding("intent-not-timely", `Declared due intent "${id}" was independently observed not delivered within its declared window.`, `declaredIntents.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      if (observed.some((entry) => entry !== first)) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedIntents === 0 ? null : timelyIntents / evaluatedIntents;
  if (evaluatedIntents === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedIntents === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: TimelyVerifiedDeliveryRateState =
    coverageComplete && timelyIntents === evaluatedIntents && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedIntents, timelyIntents, rate, findings);
}
