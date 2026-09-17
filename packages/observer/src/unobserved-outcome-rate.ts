/**
 * Computes the Observer charter metric `unobserved outcome rate` from
 * consumer-supplied independent observations.
 *
 * This module reuses `computeUnobservedSurface` for the three-state sort
 * and does not invent observations. It does not combine this rate with
 * escape rate. An empty evaluated set is indeterminate, never a perfect
 * rate of 0.
 */
import {
  computeUnobservedSurface,
  type DeclaredSubject,
  type SubjectTelemetryRead,
  type TelemetryPresence,
} from "./unobserved-surface.js";

const METRIC = "unobserved outcome rate" as const;
const RESERVED_OBSERVERS = new Set(["observer", "@clossys/observer"]);
const PROPOSED_POSITIONS: readonly unknown[] = [];

export type UnobservedOutcomeRateState = "satisfied" | "violated" | "indeterminate";

export interface UnobservedOutcomeRateFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface UnobservedOutcomeEvidence {
  readonly id: string;
  readonly description: string;
}

export type UnobservedOutcomePresence =
  | { readonly state: "observed"; readonly eventCount?: number; readonly source?: string }
  | { readonly state: "unobserved"; readonly source?: string }
  | { readonly state: "could-not-read"; readonly note: string; readonly source?: string };

export interface UnobservedOutcomeObservation {
  readonly subjectId: string;
  readonly independent: boolean;
  readonly presence: UnobservedOutcomePresence;
  readonly observerRef: string;
  readonly evidence: readonly UnobservedOutcomeEvidence[];
}

export interface UnobservedOutcomeRateInput {
  readonly asOf: string;
  readonly declaredSubjects: readonly DeclaredSubject[];
  readonly observations?: readonly UnobservedOutcomeObservation[];
}

export interface UnobservedOutcomeRateAssessment {
  readonly metric: "unobserved outcome rate";
  readonly state: UnobservedOutcomeRateState;
  readonly rate: number | null;
  readonly evaluatedSubjects: number;
  readonly unobservedSubjects: number;
  readonly findings: readonly UnobservedOutcomeRateFinding[];
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

function finding(rule: string, message: string, path?: string): UnobservedOutcomeRateFinding {
  return path === undefined ? { rule, severity: "error", message } : { rule, severity: "error", message, path };
}

function evidenceCounts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => record(item) && text(item.id) && text(item.description));
}

function reservedObserver(value: string): boolean {
  return RESERVED_OBSERVERS.has(value.trim().toLowerCase());
}

function parsePresence(value: unknown): TelemetryPresence | undefined {
  if (!record(value)) return undefined;
  if (value.state === "observed") {
    return {
      state: "observed",
      eventCount: typeof value.eventCount === "number" ? value.eventCount : 0,
    };
  }
  if (value.state === "unobserved") {
    return { state: "unobserved" };
  }
  if (value.state === "could-not-read") {
    if (!text(value.note)) return undefined;
    return { state: "could-not-read", note: value.note };
  }
  return undefined;
}

function report(
  state: UnobservedOutcomeRateState,
  evaluatedSubjects: number,
  unobservedSubjects: number,
  rate: number | null,
  findings: readonly UnobservedOutcomeRateFinding[],
): UnobservedOutcomeRateAssessment {
  return {
    metric: METRIC,
    state,
    rate,
    evaluatedSubjects,
    unobservedSubjects,
    findings,
    proposedPositions: PROPOSED_POSITIONS,
  };
}

/**
 * Computes `unobserved outcome rate`: declared outcome subjects with no
 * readable independent observation / all declared outcome subjects evaluated.
 */
export function assessUnobservedOutcomeRate(input: unknown): UnobservedOutcomeRateAssessment {
  if (!record(input)) {
    return report("indeterminate", 0, 0, null, [finding("assessment-shape", "Assessment input must be an object.", "$")]);
  }

  const findings: UnobservedOutcomeRateFinding[] = [];
  if (!timestamp(input.asOf)) {
    findings.push(finding("assessment-as-of", "asOf must be an interpretable timestamp.", "asOf"));
  }

  const declaredSubjects = input.declaredSubjects;
  if (!Array.isArray(declaredSubjects)) {
    findings.push(finding("declared-subjects-required", "declaredSubjects must be an array of { id } objects.", "declaredSubjects"));
    return report("indeterminate", 0, 0, null, findings);
  }

  const declaredIds: string[] = [];
  const declaredSet = new Set<string>();
  declaredSubjects.forEach((item, index) => {
    const path = `declaredSubjects[${index}]`;
    if (!record(item) || !text(item.id)) {
      findings.push(finding("subject-id-required", "id must be a non-empty string.", `${path}.id`));
      return;
    }
    if (declaredSet.has(item.id)) {
      findings.push(finding("duplicate-subject-id", `Duplicate id "${item.id}".`, `${path}.id`));
      return;
    }
    declaredSet.add(item.id);
    declaredIds.push(item.id);
  });

  if (declaredIds.length === 0) {
    findings.push(finding("declared-subjects-empty", "No declared subjects are available for the unobserved-outcome metric; the rate is indeterminate, never 0.", "declaredSubjects"));
  }

  const observations = input.observations;
  if (observations !== undefined && !Array.isArray(observations)) {
    findings.push(finding("observations-shape", "observations must be an array.", "observations"));
  }

  const counting = new Map<string, TelemetryPresence[]>();
  if (Array.isArray(observations)) {
    observations.forEach((item, index) => {
      const path = `observations[${index}]`;
      if (!record(item)) {
        findings.push(finding("observation-shape", "An observation must be an object.", path));
        return;
      }
      if (text(item.observerRef) && reservedObserver(item.observerRef)) {
        findings.push(finding("self-observation", "Observer cannot observe itself; reserved observerRef values are not independent.", `${path}.observerRef`));
        return;
      }
      if (text(item.subjectId) && !declaredSet.has(item.subjectId)) {
        findings.push(finding("unknown-subject", `Observation subjectId "${item.subjectId}" is not a declared subject.`, `${path}.subjectId`));
        return;
      }
      if (item.independent !== true) return;
      const presence = parsePresence(item.presence);
      if (presence === undefined) return;
      if (!text(item.observerRef) || !evidenceCounts(item.evidence) || !text(item.subjectId) || !declaredSet.has(item.subjectId)) return;
      const bucket = counting.get(item.subjectId) ?? [];
      bucket.push(presence);
      counting.set(item.subjectId, bucket);
    });
  }

  const declared: DeclaredSubject[] = declaredIds.map((id) => ({ id }));
  const reads: SubjectTelemetryRead[] = [];
  for (const id of declaredIds) {
    const observed = counting.get(id) ?? [];
    if (observed.length === 0) continue;
    const first = observed[0];
    if (first === undefined) continue;
    if (observed.some((entry) => entry.state !== first.state)) {
      findings.push(finding("observation-disagreement", `Counting observations for "${id}" disagree.`, `observations.${id}`));
      reads.push({
        subject: id,
        presence: { state: "could-not-read", note: "counting observations disagree on presence.state" },
      });
      continue;
    }
    reads.push({ subject: id, presence: first });
  }

  const surface = computeUnobservedSurface(declared, reads);
  for (const id of surface.couldNotRead) {
    findings.push(finding("subject-unevaluated", `Declared subject "${id}" has no readable independent observation.`, `declaredSubjects.${id}`));
  }
  for (const id of surface.unobserved) {
    findings.push(finding("subject-unobserved", `Declared subject "${id}" was independently observed to produce no outcome telemetry.`, `declaredSubjects.${id}`));
  }

  const evaluatedSubjects = surface.observed.length + surface.unobserved.length;
  const unobservedSubjects = surface.unobserved.length;
  const rate = evaluatedSubjects === 0 ? null : unobservedSubjects / evaluatedSubjects;
  if (evaluatedSubjects === 0) return report("indeterminate", 0, 0, null, findings);

  const coverageComplete = evaluatedSubjects === declaredIds.length;
  const noErrorFindings = findings.length === 0;
  const state: UnobservedOutcomeRateState =
    coverageComplete && unobservedSubjects === 0 && noErrorFindings ? "satisfied" : "violated";
  return report(state, evaluatedSubjects, unobservedSubjects, rate, findings);
}
