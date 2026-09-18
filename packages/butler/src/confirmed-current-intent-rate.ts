/**
 * Computes the Butler charter metric `confirmed current intent rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations and does not relabel
 * `checkConfirmationCompleteness` or `checkCurrency`. An empty evaluated
 * set is indeterminate, never a perfect rate of 1. Withdrawal-parity is
 * not this rate.
 */
const METRIC = "confirmed current intent rate" as const;
const RESERVED_OBSERVERS = new Set(["butler", "@clossys/butler"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];
const KINDS = new Set(["acted-request", "standing-instruction-use"]);

export type ConfirmedCurrentIntentRateState = "satisfied" | "violated" | "indeterminate";

export interface ConfirmedCurrentIntentRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface ConfirmedCurrentIntentRateAssessment {
  readonly metric: "confirmed current intent rate";
  readonly state: ConfirmedCurrentIntentRateState;
  readonly rate: number | null;
  readonly evaluatedIntents: number;
  readonly confirmedCurrentIntents: number;
  readonly findings: readonly ConfirmedCurrentIntentRateFinding[];
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

function finding(rule: string, message: string, path?: string): ConfirmedCurrentIntentRateFinding {
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
  state: ConfirmedCurrentIntentRateState,
  evaluatedIntents: number,
  confirmedCurrentIntents: number,
  rate: number | null,
  findings: readonly ConfirmedCurrentIntentRateFinding[],
): ConfirmedCurrentIntentRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedIntents,
    confirmedCurrentIntents,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly confirmed: boolean;
  readonly current: boolean;
}

function isConfirmedCurrent(entry: CountingObservation): boolean {
  return entry.confirmed && entry.current;
}

/**
 * Computes `confirmed current intent rate`: evaluated acted requests and
 * standing-instruction uses backed by current subject confirmation / all
 * acted requests and standing-instruction uses evaluated.
 */
export function assessConfirmedCurrentIntentRate(input: unknown): ConfirmedCurrentIntentRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: ConfirmedCurrentIntentRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredIntents = input.declaredIntents;
  if (!Array.isArray(declaredIntents)) {
    findings.push(finding("declared-intents-required", "declaredIntents must be an array of { id, kind } objects.", "declaredIntents"));
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
    if (!text(item.kind) || !KINDS.has(item.kind)) {
      findings.push(finding("intent-kind-required", 'kind must be "acted-request" or "standing-instruction-use".', `${path}.kind`));
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
    findings.push(finding("declared-intents-empty", "No declared intents are available for the confirmed-current-intent metric; the rate is indeterminate, never 1.", "declaredIntents"));
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
        findings.push(finding("self-observation", "Butler cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.intentId) && !declaredSet.has(item.intentId)) {
        findings.push(finding("unknown-intent", `Observation intentId "${item.intentId}" is not a declared intent.`, `${path}.intentId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.confirmed !== "boolean" || typeof item.current !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.intentId) || !declaredSet.has(item.intentId)) return;
      const bucket = counting.get(item.intentId) ?? [];
      bucket.push({ confirmed: item.confirmed, current: item.current });
      counting.set(item.intentId, bucket);
    });
  }

  let evaluatedIntents = 0;
  let confirmedCurrentIntents = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("intent-unevaluated", `Declared intent "${id}" has no counting independent observation.`, `declaredIntents.${id}`));
      continue;
    }
    evaluatedIntents += 1;
    const allConfirmedCurrent = observed.every((entry) => isConfirmedCurrent(entry));
    if (allConfirmedCurrent) confirmedCurrentIntents += 1;
    else {
      findings.push(finding("intent-not-confirmed-current", `Declared intent "${id}" was independently observed without current subject confirmation.`, `declaredIntents.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      if (observed.some((entry) => entry.confirmed !== first.confirmed || entry.current !== first.current)) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedIntents === 0 ? null : confirmedCurrentIntents / evaluatedIntents;
  if (evaluatedIntents === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedIntents === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: ConfirmedCurrentIntentRateState =
    coverageComplete && confirmedCurrentIntents === evaluatedIntents && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedIntents, confirmedCurrentIntents, rate, findings);
}
