/**
 * Computes the Locksmith charter metric `controlled key rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not read secret values, and
 * does not relabel `summarizeRotationMetric`. An empty evaluated set is
 * indeterminate, never a perfect rate of 1.
 */
const METRIC = "controlled key rate" as const;
const RESERVED_OBSERVERS = new Set(["locksmith", "@clossys/locksmith"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type ControlledKeyRateState = "satisfied" | "violated" | "indeterminate";

export interface ControlledKeyRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface ControlledKeyRateAssessment {
  readonly metric: "controlled key rate";
  readonly state: ControlledKeyRateState;
  readonly rate: number | null;
  readonly evaluatedKeys: number;
  readonly controlledKeys: number;
  readonly findings: readonly ControlledKeyRateFinding[];
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

function finding(rule: string, message: string, path?: string): ControlledKeyRateFinding {
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
  state: ControlledKeyRateState,
  evaluatedKeys: number,
  controlledKeys: number,
  rate: number | null,
  findings: readonly ControlledKeyRateFinding[],
): ControlledKeyRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedKeys,
    controlledKeys,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly owned: boolean;
  readonly current: boolean;
  readonly correctlyDistributed: boolean;
  readonly revocable: boolean;
}

function isControlled(entry: CountingObservation): boolean {
  return entry.owned && entry.current && entry.correctlyDistributed && entry.revocable;
}

/**
 * Computes `controlled key rate`: declared live keys independently observed
 * owned, current, correctly distributed, and revocable / all declared live
 * keys evaluated.
 */
export function assessControlledKeyRate(input: unknown): ControlledKeyRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: ControlledKeyRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredKeys = input.declaredKeys;
  if (!Array.isArray(declaredKeys)) {
    findings.push(finding("declared-keys-required", "declaredKeys must be an array of { id } objects.", "declaredKeys"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredKeys.forEach((item, index) => {
    const path = `declaredKeys[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("key-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-key-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-keys-empty", "No declared keys are available for the controlled-key metric; the rate is indeterminate, never 1.", "declaredKeys"));
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
        findings.push(finding("self-observation", "Locksmith cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.keyId) && !declaredSet.has(item.keyId)) {
        findings.push(finding("unknown-key", `Observation keyId "${item.keyId}" is not a declared key.`, `${path}.keyId`));
        return;
      }
      if (item.independent !== true) return;
      if (
        typeof item.owned !== "boolean" ||
        typeof item.current !== "boolean" ||
        typeof item.correctlyDistributed !== "boolean" ||
        typeof item.revocable !== "boolean"
      ) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.keyId) || !declaredSet.has(item.keyId)) return;
      const bucket = counting.get(item.keyId) ?? [];
      bucket.push({
        owned: item.owned,
        current: item.current,
        correctlyDistributed: item.correctlyDistributed,
        revocable: item.revocable,
      });
      counting.set(item.keyId, bucket);
    });
  }

  let evaluatedKeys = 0;
  let controlledKeys = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("key-unevaluated", `Declared key "${id}" has no counting independent observation.`, `declaredKeys.${id}`));
      continue;
    }
    evaluatedKeys += 1;
    const allControlled = observed.every((entry) => isControlled(entry));
    if (allControlled) controlledKeys += 1;
    else {
      findings.push(finding("key-not-controlled", `Declared key "${id}" was independently observed not owned, current, correctly distributed, and revocable.`, `declaredKeys.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) =>
        entry.owned !== first.owned ||
        entry.current !== first.current ||
        entry.correctlyDistributed !== first.correctlyDistributed ||
        entry.revocable !== first.revocable
      );
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedKeys === 0 ? null : controlledKeys / evaluatedKeys;
  if (evaluatedKeys === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedKeys === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: ControlledKeyRateState =
    coverageComplete && controlledKeys === evaluatedKeys && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedKeys, controlledKeys, rate, findings);
}
