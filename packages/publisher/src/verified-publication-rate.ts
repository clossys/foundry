/**
 * Computes the Publisher charter metric `verified publication rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not write a ledger, and
 * does not relabel `publisher-media-check` or `publisher-record-check`. An
 * empty evaluated set is indeterminate, never a perfect rate of 1. The
 * record half still records and does not judge.
 */
const METRIC = "verified publication rate" as const;
const RESERVED_OBSERVERS = new Set(["publisher", "@clossys/publisher"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type VerifiedPublicationRateState = "satisfied" | "violated" | "indeterminate";

export interface VerifiedPublicationRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface VerifiedPublicationRateAssessment {
  readonly metric: "verified publication rate";
  readonly state: VerifiedPublicationRateState;
  readonly rate: number | null;
  readonly evaluatedIntents: number;
  readonly verifiedIntents: number;
  readonly findings: readonly VerifiedPublicationRateFinding[];
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

function finding(rule: string, message: string, path?: string): VerifiedPublicationRateFinding {
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
  state: VerifiedPublicationRateState,
  evaluatedIntents: number,
  verifiedIntents: number,
  rate: number | null,
  findings: readonly VerifiedPublicationRateFinding[],
): VerifiedPublicationRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedIntents,
    verifiedIntents,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly audienceReleased: boolean;
  readonly matchingImmutableRecord: boolean;
}

function isVerified(entry: CountingObservation): boolean {
  return entry.audienceReleased && entry.matchingImmutableRecord;
}

/**
 * Computes `verified publication rate`: due publication intents with
 * independently observed audience release and matching immutable
 * publication record / all due publication intents evaluated.
 */
export function assessVerifiedPublicationRate(input: unknown): VerifiedPublicationRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: VerifiedPublicationRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredIntents = input.declaredIntents;
  if (!Array.isArray(declaredIntents)) {
    findings.push(finding("declared-intents-required", "declaredIntents must be an array of { id } objects.", "declaredIntents"));
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
    findings.push(finding("declared-intents-empty", "No declared due publication intents are available for the verified-publication metric; the rate is indeterminate, never 1.", "declaredIntents"));
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
        findings.push(finding("self-observation", "Publisher cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.intentId) && !declaredSet.has(item.intentId)) {
        findings.push(finding("unknown-intent", `Observation intentId "${item.intentId}" is not a declared intent.`, `${path}.intentId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.audienceReleased !== "boolean" || typeof item.matchingImmutableRecord !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.intentId) || !declaredSet.has(item.intentId)) return;
      const bucket = counting.get(item.intentId) ?? [];
      bucket.push({
        audienceReleased: item.audienceReleased,
        matchingImmutableRecord: item.matchingImmutableRecord,
      });
      counting.set(item.intentId, bucket);
    });
  }

  let evaluatedIntents = 0;
  let verifiedIntents = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("intent-unevaluated", `Declared intent "${id}" has no counting independent observation.`, `declaredIntents.${id}`));
      continue;
    }
    evaluatedIntents += 1;
    const allVerified = observed.every((entry) => isVerified(entry));
    if (allVerified) verifiedIntents += 1;
    else {
      findings.push(finding("intent-not-verified", `Declared intent "${id}" was independently observed without both an audience release and a matching immutable publication record.`, `declaredIntents.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.audienceReleased !== first.audienceReleased ||
        entry.matchingImmutableRecord !== first.matchingImmutableRecord
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedIntents === 0 ? null : verifiedIntents / evaluatedIntents;
  if (evaluatedIntents === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedIntents === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: VerifiedPublicationRateState =
    coverageComplete && verifiedIntents === evaluatedIntents && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedIntents, verifiedIntents, rate, findings);
}
