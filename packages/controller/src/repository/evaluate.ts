import { PREVIOUS_REPOSITORY_PROFILE_VERSION } from "./types.js";
import type {
  RepositoryProfileFindingRule,
  RepositoryRequirement,
  RepositoryRequirementDeclaration,
  RepositoryRequirementEvaluation,
  RepositoryRequirementFinding,
  RepositoryRequirementFindingRule,
  RepositoryRequirementObservation,
  RepositoryRequirementScope,
  RepositoryRequirementStatus,
  RepositoryRequirementsEvaluation,
  RepositoryRequirementsEvaluationInput,
} from "./types.js";
import { classifyRequirementId } from "./id-grammar.js";
import { validateRepositoryProfile } from "./validate.js";

type UnknownRecord = Record<string, unknown>;

const EVALUATION_KEYS = new Set(["declarations", "observations"]);
const DECLARATION_KEYS = new Set(["source", "requirements"]);
const OBSERVATION_KEYS = new Set(["id", "scope", "source", "state", "value"]);
const REQUIREMENT_SCOPES = new Set<RepositoryRequirementScope>(["repository", "workspace", "machine"]);
const OBSERVATION_STATES = new Set(["observed", "absent", "unknown"]);
const MAX_ARRAY_ENTRIES = 10_000;
const MAX_SOURCE_LENGTH = 512;
const MAX_VALUE_LENGTH = 256;
const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set<PropertyKey>([
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "hasOwnProperty",
  "__lookupGetter__",
  "__lookupSetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "__proto__",
  "toLocaleString",
]);

function hasStandardObjectPrototype(prototype: object): boolean {
  const actualKeys = Reflect.ownKeys(prototype);
  if (actualKeys.some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) return false;

  return actualKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor || descriptor.enumerable !== false) return false;
    if (key === "__proto__") return !("value" in descriptor) && typeof descriptor.get === "function" && typeof descriptor.set === "function";
    return "value" in descriptor && typeof descriptor.value === "function";
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  if (Object.getPrototypeOf(prototype) !== null || !hasStandardObjectPrototype(prototype)) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor !== undefined && "value" in descriptor;
  });
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isArrayIndexName(name: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(name) && Number(name) < 0xffffffff;
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number" || lengthDescriptor.value > MAX_ARRAY_ENTRIES) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return false;
  const indexKeys = keys.filter((key): key is string => typeof key === "string" && isArrayIndexName(key));
  if (indexKeys.length !== lengthDescriptor.value) return false;
  return indexKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function arrayEntry(value: unknown[], index: number): unknown {
  return ownData(value, String(index));
}

function finding(
  rule: RepositoryRequirementFindingRule | RepositoryProfileFindingRule,
  path: string,
  message: string,
): RepositoryRequirementFinding {
  return { rule, severity: "error", path, message };
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function unknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  rule: Extract<RepositoryRequirementFindingRule, `${string}unknown-field`>,
  path: string,
  findings: RepositoryRequirementFinding[],
): void {
  for (const key of Object.getOwnPropertyNames(value).sort()) {
    if (!allowed.has(key)) findings.push(finding(rule, `${path}.${key}`, "Unknown field."));
  }
}

function validateDeclarations(value: unknown, findings: RepositoryRequirementFinding[]): void {
  if (!isDenseDataArray(value) || value.length === 0) {
    findings.push(finding("declarations-shape", "declarations", `declarations must be a non-empty plain array of at most ${MAX_ARRAY_ENTRIES} entries.`));
    return;
  }

  const sources = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const path = `declarations[${index}]`;
    const declaration = arrayEntry(value, index);
    if (!isRecord(declaration)) {
      findings.push(finding("declaration-shape", path, "A declaration must be an object."));
      continue;
    }
    unknownFields(declaration, DECLARATION_KEYS, "declaration-unknown-field", path, findings);
    const source = ownData(declaration, "source");
    if (!isSafeString(source, MAX_SOURCE_LENGTH)) {
      findings.push(finding("declaration-source", `${path}.source`, `source must be a trimmed, non-empty opaque string of at most ${MAX_SOURCE_LENGTH} characters without control characters.`));
    } else if (sources.has(source)) {
      findings.push(finding("duplicate-declaration-source", `${path}.source`, "Declaration sources must be unique."));
    } else {
      sources.add(source);
    }

    const requirementFindings = validateRepositoryProfile({
      schemaVersion: PREVIOUS_REPOSITORY_PROFILE_VERSION,
      defaultBranch: "main",
      commands: [],
      protectedPaths: [],
      requirements: ownData(declaration, "requirements"),
    }).filter((entry) => entry.path.startsWith("requirements"));
    for (const requirementFinding of requirementFindings) {
      findings.push({
        ...requirementFinding,
        path: `${path}.${requirementFinding.path}`,
      });
    }
  }
}

function observationIdentity(scope: RepositoryRequirementScope, id: string, source?: string): string {
  return scope === "repository" ? `${scope}\u0000${source ?? ""}\u0000${id}` : `${scope}\u0000${id}`;
}

function validateObservations(value: unknown, findings: RepositoryRequirementFinding[]): void {
  if (!isDenseDataArray(value)) {
    findings.push(finding("observations-shape", "observations", `observations must be a plain array of at most ${MAX_ARRAY_ENTRIES} entries.`));
    return;
  }

  const identities = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const path = `observations[${index}]`;
    const observation = arrayEntry(value, index);
    if (!isRecord(observation)) {
      findings.push(finding("observation-shape", path, "An observation must be an object."));
      continue;
    }
    unknownFields(observation, OBSERVATION_KEYS, "observation-unknown-field", path, findings);
    const id = ownData(observation, "id");
    const scope = ownData(observation, "scope");
    const source = ownData(observation, "source");
    const state = ownData(observation, "state");
    const valueField = ownData(observation, "value");

    const idFinding = classifyRequirementId(id);
    const validId = typeof id === "string" && idFinding === undefined;
    const validScope = typeof scope === "string" && REQUIREMENT_SCOPES.has(scope as RepositoryRequirementScope);
    const validSource = isSafeString(source, MAX_SOURCE_LENGTH);
    if (idFinding) findings.push(finding("observation-id", `${path}.id`, idFinding.message));
    if (!validScope) findings.push(finding("observation-scope", `${path}.scope`, "scope must be repository, workspace, or machine."));
    if (scope === "repository" && !validSource) {
      findings.push(finding("observation-source", `${path}.source`, "A repository-scoped observation must name its declaration source."));
    } else if (validScope && scope !== "repository" && Object.prototype.hasOwnProperty.call(observation, "source")) {
      findings.push(finding("observation-source", `${path}.source`, "Only repository-scoped observations may name a source."));
    }
    if (typeof state !== "string" || !OBSERVATION_STATES.has(state)) {
      findings.push(finding("observation-state", `${path}.state`, "state must be observed, absent, or unknown."));
    }
    if (state === "observed") {
      if (!isSafeString(valueField, MAX_VALUE_LENGTH)) findings.push(finding("observation-value", `${path}.value`, `An observed value must be a trimmed, non-empty string of at most ${MAX_VALUE_LENGTH} characters without control characters.`));
    } else if (Object.prototype.hasOwnProperty.call(observation, "value")) {
      findings.push(finding("observation-value", `${path}.value`, "Only an observed state may carry a value."));
    }

    if (validId && validScope && (scope !== "repository" || validSource)) {
      const identity = observationIdentity(scope as RepositoryRequirementScope, id, typeof source === "string" ? source : undefined);
      if (identities.has(identity)) findings.push(finding("duplicate-observation", path, "Each resolved requirement may have at most one observation."));
      else identities.add(identity);
    }
  }
}

/** Strictly validates declarations and caller-normalized observations without I/O. */
export function validateRepositoryRequirementsEvaluationInput(value: unknown): RepositoryRequirementFinding[] {
  try {
    if (!isRecord(value)) return [finding("evaluation-shape", "$", "A requirements evaluation input must be an object.")];
    const findings: RepositoryRequirementFinding[] = [];
    unknownFields(value, EVALUATION_KEYS, "evaluation-unknown-field", "$", findings);
    validateDeclarations(ownData(value, "declarations"), findings);
    validateObservations(ownData(value, "observations"), findings);
    return findings;
  } catch {
    return [finding("evaluation-shape", "$", "A requirements evaluation input must be safely readable.")];
  }
}

interface RequirementGroup {
  id: string;
  scope: RepositoryRequirementScope;
  source?: string;
  declaredBy: string[];
  requirements: RepositoryRequirement[];
}

function groupRequirements(declarations: readonly RepositoryRequirementDeclaration[]): RequirementGroup[] {
  const groups = new Map<string, RequirementGroup>();
  for (const declaration of declarations) {
    for (const requirement of declaration.requirements) {
      const source = requirement.scope === "repository" ? declaration.source : undefined;
      const key = observationIdentity(requirement.scope, requirement.id, source);
      const group = groups.get(key);
      if (group) {
        group.declaredBy.push(declaration.source);
        group.requirements.push(requirement);
      } else {
        groups.set(key, {
          id: requirement.id,
          scope: requirement.scope,
          ...(source === undefined ? {} : { source }),
          declaredBy: [declaration.source],
          requirements: [requirement],
        });
      }
    }
  }
  return [...groups.values()];
}

function compatibleValues(requirements: readonly RepositoryRequirement[]): string[] | undefined {
  let compatible: string[] | undefined;
  for (const requirement of requirements) {
    if (requirement.constraint.kind === "present") continue;
    compatible = compatible === undefined
      ? [...requirement.constraint.values]
      : compatible.filter((value) => requirement.constraint.kind === "one-of" && requirement.constraint.values.includes(value));
  }
  return compatible;
}

function evaluateGroup(
  group: RequirementGroup,
  observations: ReadonlyMap<string, RepositoryRequirementObservation>,
): RepositoryRequirementEvaluation {
  const acceptedValues = compatibleValues(group.requirements);
  let status: RepositoryRequirementStatus;
  if (acceptedValues !== undefined && acceptedValues.length === 0) {
    status = "conflicting";
  } else {
    const observation = observations.get(observationIdentity(group.scope, group.id, group.source));
    if (!observation || observation.state === "unknown") status = "unknown";
    else if (observation.state === "absent") status = "unsatisfied";
    else status = acceptedValues === undefined || acceptedValues.includes(observation.value as string) ? "satisfied" : "unsatisfied";
  }
  return {
    id: group.id,
    scope: group.scope,
    ...(group.source === undefined ? {} : { source: group.source }),
    declaredBy: group.declaredBy,
    status,
    ...(acceptedValues === undefined ? {} : { acceptedValues }),
  };
}

function resultFinding(result: RepositoryRequirementEvaluation, index: number): RepositoryRequirementFinding | undefined {
  const path = `requirements[${index}]`;
  if (result.status === "conflicting") return finding("requirement-conflicting", path, "The declarations have no compatible accepted value for this requirement.");
  if (result.status === "unsatisfied") return finding("requirement-unsatisfied", path, "The observed evidence does not satisfy this requirement.");
  if (result.status === "unknown") return finding("requirement-unknown", path, "No conclusive observation was supplied for this requirement.");
  return undefined;
}

function overallStatus(results: readonly RepositoryRequirementEvaluation[]): RepositoryRequirementStatus {
  if (results.some((result) => result.status === "conflicting")) return "conflicting";
  if (results.some((result) => result.status === "unknown")) return "unknown";
  if (results.some((result) => result.status === "unsatisfied")) return "unsatisfied";
  return "satisfied";
}

/**
 * Evaluates already-discovered declarations against caller-normalized evidence.
 * It performs no discovery, provider access, installation, or mutation. Invalid
 * input and unknown evidence fail closed as explicit report states.
 */
export function evaluateRepositoryRequirements(value: unknown): RepositoryRequirementsEvaluation {
  const validationFindings = validateRepositoryRequirementsEvaluationInput(value);
  if (validationFindings.length > 0) {
    return { ok: false, status: "invalid", requirements: [], findings: validationFindings };
  }

  const input = value as RepositoryRequirementsEvaluationInput;
  const observations = new Map<string, RepositoryRequirementObservation>();
  for (const observation of input.observations) {
    observations.set(observationIdentity(observation.scope, observation.id, observation.source), observation);
  }
  const requirements = groupRequirements(input.declarations).map((group) => evaluateGroup(group, observations));
  const findings = requirements.flatMap((result, index) => {
    const entry = resultFinding(result, index);
    return entry ? [entry] : [];
  });
  const status = overallStatus(requirements);
  return { ok: status === "satisfied", status, requirements, findings };
}
