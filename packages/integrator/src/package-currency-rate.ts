/**
 * Computes the Integrator charter metric `package currency rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not maintain a registry of
 * consumers, and does not relabel `computeCurrencyMetric` (empty share 0 is
 * not this rate). An empty evaluated set is indeterminate, never a perfect
 * rate of 1. `integrator-supersession-check` is report-only and is not this
 * assessment.
 */
const METRIC = "package currency rate" as const;
const RESERVED_OBSERVERS = new Set(["integrator", "@clossys/integrator"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type PackageCurrencyRateState = "satisfied" | "violated" | "indeterminate";

export interface PackageCurrencyRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface PackageCurrencyRateAssessment {
  readonly metric: "package currency rate";
  readonly state: PackageCurrencyRateState;
  readonly rate: number | null;
  readonly evaluatedPackages: number;
  readonly currentPackages: number;
  readonly findings: readonly PackageCurrencyRateFinding[];
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

function finding(rule: string, message: string, path?: string): PackageCurrencyRateFinding {
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
  state: PackageCurrencyRateState,
  evaluatedPackages: number,
  currentPackages: number,
  rate: number | null,
  findings: readonly PackageCurrencyRateFinding[],
): PackageCurrencyRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedPackages,
    currentPackages,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `package currency rate`: entitled packages independently observed
 * installed at the current published version / all entitled packages
 * evaluated.
 */
export function assessPackageCurrencyRate(input: unknown): PackageCurrencyRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: PackageCurrencyRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredPackages = input.declaredPackages;
  if (!Array.isArray(declaredPackages)) {
    findings.push(finding("declared-packages-required", "declaredPackages must be an array of { id } objects.", "declaredPackages"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredPackages.forEach((item, index) => {
    const path = `declaredPackages[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("package-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-package-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-packages-empty", "No declared packages are available for the package-currency metric; the rate is indeterminate, never 1.", "declaredPackages"));
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
        findings.push(finding("self-observation", "Integrator cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.packageId) && !declaredSet.has(item.packageId)) {
        findings.push(finding("unknown-package", `Observation packageId "${item.packageId}" is not a declared package.`, `${path}.packageId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.current !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.packageId) || !declaredSet.has(item.packageId)) return;
      const bucket = counting.get(item.packageId) ?? [];
      bucket.push(item.current);
      counting.set(item.packageId, bucket);
    });
  }

  let evaluatedPackages = 0;
  let currentPackages = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("package-unevaluated", `Declared package "${id}" has no counting independent observation.`, `declaredPackages.${id}`));
      continue;
    }
    evaluatedPackages += 1;
    const allCurrent = observed.every((entry) => entry === true);
    if (allCurrent) currentPackages += 1;
    else {
      findings.push(finding("package-not-current", `Declared package "${id}" was independently observed not at the current published version.`, `declaredPackages.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      if (observed.some((entry) => entry !== first)) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedPackages === 0 ? null : currentPackages / evaluatedPackages;
  if (evaluatedPackages === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedPackages === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: PackageCurrencyRateState =
    coverageComplete && currentPackages === evaluatedPackages && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedPackages, currentPackages, rate, findings);
}
