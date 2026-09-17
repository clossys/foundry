/**
 * Computes the Controller charter metric `rule conformance rate` from
 * consumer-supplied independent observations.
 *
 * This module does not invent observations, does not call `foundry-check`,
 * and does not judge a proposed change. An empty evaluated set is
 * indeterminate, never a perfect rate of 1.
 */
import type {
  RuleConformanceAssessment,
  RuleConformanceFinding,
  RuleConformanceState,
} from "./types.js";

const METRIC = "rule conformance rate" as const;
const RESERVED_OBSERVERS = new Set(["controller", "@clossys/controller"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

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

function finding(rule: string, message: string, path?: string): RuleConformanceFinding {
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
  state: RuleConformanceState,
  evaluatedRules: number,
  conformingRules: number,
  rate: number | null,
  findings: readonly RuleConformanceFinding[],
): RuleConformanceAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedRules,
    conformingRules,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

interface CountingObservation {
  readonly wellFormed: boolean;
  readonly followed: boolean;
}

/**
 * Computes `rule conformance rate`: declared rules independently observed
 * well-formed and followed / all declared rules evaluated.
 */
export function assessRuleConformanceRate(input: unknown): RuleConformanceAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: RuleConformanceFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredRules = input.declaredRules;
  if (!Array.isArray(declaredRules)) {
    findings.push(finding("declared-rules-required", "declaredRules must be an array of { id } objects.", "declaredRules"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredRules.forEach((item, index) => {
    const path = `declaredRules[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("rule-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-rule-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-rules-empty", "No declared rules are available for the rule-conformance metric; the rate is indeterminate, never 1.", "declaredRules"));
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
        findings.push(finding("self-observation", "Controller cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.ruleId) && !declaredSet.has(item.ruleId)) {
        findings.push(finding("unknown-rule", `Observation ruleId "${item.ruleId}" is not a declared rule.`, `${path}.ruleId`));
        return;
      }
      if (item.independent !== true) return;
      if (typeof item.wellFormed !== "boolean" || typeof item.followed !== "boolean") return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.ruleId) || !declaredSet.has(item.ruleId)) return;
      const bucket = counting.get(item.ruleId) ?? [];
      bucket.push({ wellFormed: item.wellFormed, followed: item.followed });
      counting.set(item.ruleId, bucket);
    });
  }

  let evaluatedRules = 0;
  let conformingRules = 0;
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) {
      findings.push(finding("rule-unevaluated", `Declared rule "${id}" has no counting independent observation.`, `declaredRules.${id}`));
      continue;
    }
    evaluatedRules += 1;
    const allConforming = observed.every((entry) => entry.wellFormed === true && entry.followed === true);
    if (allConforming) conformingRules += 1;
    else {
      findings.push(finding("rule-not-conforming", `Declared rule "${id}" was independently observed not well-formed or not followed.`, `declaredRules.${id}`));
    }
    if (observed.length > 1) {
      const first = observed[0]!;
      const disagree = observed.some((entry) => entry.wellFormed !== first.wellFormed || entry.followed !== first.followed);
      if (disagree) {
        findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      }
    }
  }

  const rate = evaluatedRules === 0 ? null : conformingRules / evaluatedRules;
  if (evaluatedRules === 0) return report("indeterminate", 0, 0, null, findings);
  const coverageComplete = evaluatedRules === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: RuleConformanceState =
    coverageComplete && conformingRules === evaluatedRules && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedRules, conformingRules, rate, findings);
}
