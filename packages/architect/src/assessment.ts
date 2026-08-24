import { validateOperatingTopology } from "./topology.js";
import { OPERATING_RESPONSIBILITIES } from "./types.js";
import type {
  ArchitectureAssessmentOptions,
  ArchitectureChangeObservation,
  ArchitectureExceptionAssessment,
  ArchitectureFinding,
  AssessedArchitectureChange,
  AssessedBoundaryCrossing,
  OperatingInterfaceDefinition,
  OperatingTopologyDefinition,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(rule: string, message: string, path: string): ArchitectureFinding {
  return { rule, severity: "error", message, path };
}

/** Validates observations as evidence without using them to certify themselves. */
export function validateArchitectureChangeObservations(value: unknown): ArchitectureFinding[] {
  if (!Array.isArray(value)) return [finding("observations-shape", "Architecture observations must be an array.", "$")];
  const findings: ArchitectureFinding[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `[${index}]`;
    if (!isRecord(candidate)) { findings.push(finding("observation-shape", "An observation must be an object.", path)); continue; }
    if (typeof candidate.id !== "string" || candidate.id.length === 0) findings.push(finding("observation-id", "id must be a non-empty string.", `${path}.id`));
    else if (ids.has(candidate.id)) findings.push(finding("duplicate-observation-id", `Duplicate observation id "${candidate.id}".`, `${path}.id`));
    else ids.add(candidate.id);
    if (typeof candidate.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate.observedAt)) findings.push(finding("observed-at", "observedAt must be an RFC 3339 timestamp with an offset.", `${path}.observedAt`));
    if (typeof candidate.material !== "boolean") findings.push(finding("material-shape", "material must be a boolean.", `${path}.material`));
    if (!Array.isArray(candidate.crossings)) { findings.push(finding("crossings-shape", "crossings must be an array.", `${path}.crossings`)); continue; }
    for (const [crossingIndex, crossing] of candidate.crossings.entries()) {
      const crossingPath = `${path}.crossings[${crossingIndex}]`;
      if (!isRecord(crossing)) { findings.push(finding("crossing-shape", "A boundary crossing must be an object.", crossingPath)); continue; }
      for (const endpoint of ["from", "to"] as const) if (typeof crossing[endpoint] !== "string" || crossing[endpoint].length === 0) findings.push(finding("crossing-endpoint", `${endpoint} must be a non-empty system id.`, `${crossingPath}.${endpoint}`));
      if (typeof crossing.responsibility !== "string" || !(OPERATING_RESPONSIBILITIES as readonly string[]).includes(crossing.responsibility)) findings.push(finding("crossing-responsibility", "responsibility must be a supported value.", `${crossingPath}.responsibility`));
      if (crossing.from !== undefined && crossing.from === crossing.to) findings.push(finding("crossing-boundary", "A boundary crossing must name two different systems.", crossingPath));
      if (crossing.interface !== undefined && (typeof crossing.interface !== "string" || crossing.interface.length === 0)) findings.push(finding("crossing-interface", "interface must be a non-empty string when provided.", `${crossingPath}.interface`));
    }
  }
  return findings;
}

function isDeclared(crossing: { from: string; to: string; responsibility: string; interface?: string }, interfaces: readonly OperatingInterfaceDefinition[]): boolean {
  return interfaces.some((entry) => entry.from === crossing.from && entry.to === crossing.to && (entry.responsibilities as readonly string[]).includes(crossing.responsibility) && (crossing.interface === undefined || entry.id === crossing.interface));
}

function indeterminate(maximumExceptionRate: number, observedChanges: number, findings: ArchitectureFinding[]): ArchitectureExceptionAssessment {
  return { state: "indeterminate", exceptionRate: null, maximumExceptionRate, observedChanges, observedMaterialChanges: 0, materialChangesWithExceptions: 0, changes: [], findings };
}

/**
 * Measures the package's primary metric from independent observations.
 * No material observations is explicitly indeterminate, never a zero rate.
 */
export function assessArchitectureExceptions(
  topology: unknown,
  observations: unknown,
  options: ArchitectureAssessmentOptions,
): ArchitectureExceptionAssessment {
  const topologyFindings = validateOperatingTopology(topology);
  const observationFindings = validateArchitectureChangeObservations(observations);
  const optionFindings: ArchitectureFinding[] = [];
  if (!Number.isFinite(options.maximumExceptionRate) || options.maximumExceptionRate < 0 || options.maximumExceptionRate > 1) optionFindings.push(finding("maximum-exception-rate", "maximumExceptionRate must be a finite number in [0, 1].", "options.maximumExceptionRate"));
  const observedChanges = Array.isArray(observations) ? observations.length : 0;
  const findings = [...topologyFindings, ...observationFindings, ...optionFindings];
  if (findings.some((entry) => entry.severity === "error")) return indeterminate(options.maximumExceptionRate, observedChanges, findings);

  const definition = topology as OperatingTopologyDefinition;
  const evidence = observations as readonly ArchitectureChangeObservation[];
  const interfaces = definition.interfaces ?? [];
  const changes: AssessedArchitectureChange[] = evidence.map((observation) => {
    const crossings: AssessedBoundaryCrossing[] = observation.crossings.map((crossing) => ({ ...crossing, declared: isDeclared(crossing, interfaces) }));
    return { id: observation.id, observedAt: observation.observedAt, material: observation.material, crossings, hasException: observation.material && crossings.some((crossing) => !crossing.declared) };
  });
  const material = changes.filter((change) => change.material);
  if (material.length === 0) {
    return { state: "indeterminate", exceptionRate: null, maximumExceptionRate: options.maximumExceptionRate, observedChanges: changes.length, observedMaterialChanges: 0, materialChangesWithExceptions: 0, changes, findings: [{ rule: "material-evidence-required", severity: "warning", message: "No observed material changes are available; architecture exception rate is unobserved." }] };
  }
  const exceptions = material.filter((change) => change.hasException).length;
  const exceptionRate = exceptions / material.length;
  return {
    state: exceptionRate <= options.maximumExceptionRate ? "satisfied" : "violated",
    exceptionRate,
    maximumExceptionRate: options.maximumExceptionRate,
    observedChanges: changes.length,
    observedMaterialChanges: material.length,
    materialChangesWithExceptions: exceptions,
    changes,
    findings: [],
  };
}
