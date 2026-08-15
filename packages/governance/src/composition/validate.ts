import { COMPOSITION_SCHEMA_VERSION } from "./types.js";
import type {
  CompositionCapabilitySupply,
  CompositionConstraint,
  CompositionDeclaration,
  CompositionEvaluationInput,
  CompositionException,
  CompositionFinding,
  CompositionFindingRule,
  CompositionOperatorDecision,
  CompositionPlane,
  CompositionProvenance,
  CompositionScope,
} from "./types.js";
import { groupKey, scopeKey } from "./keys.js";

type UnknownRecord = Record<string, unknown>;

const INPUT_KEYS = new Set(["schemaVersion", "evaluatedAt", "declarations", "supplies", "decisions", "exceptions"]);
const DECLARATION_BASE_KEYS = ["kind", "id", "capability", "scope", "provenance"];
const HARD_DECLARATION_KEYS = new Set([...DECLARATION_BASE_KEYS, "constraint"]);
const PREFERENCE_DECLARATION_KEYS = new Set([...DECLARATION_BASE_KEYS, "value"]);
const SUPPLY_KEYS = new Set(["id", "capability", "scope", "state", "values", "provenance"]);
const DECISION_KEYS = new Set(["id", "capability", "scope", "selectedValue", "exceptionIds", "provenance"]);
const EXCEPTION_KEYS = new Set(["id", "scope", "targetDeclarationIds", "allowedValues", "reason", "reviewBy", "expiresAt", "provenance"]);
const SCOPE_KEYS = new Set(["plane", "id"]);
const PROVENANCE_KEYS = new Set(["source", "reference"]);
const PRESENCE_CONSTRAINT_KEYS = new Set(["kind"]);
const ONE_OF_CONSTRAINT_KEYS = new Set(["kind", "values"]);
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
const PLANES = new Set<CompositionPlane>(["producer", "workspace", "repository", "machine"]);
const MAX_ARRAY_ENTRIES = 10_000;
const MAX_ID_LENGTH = 128;
const MAX_VALUE_LENGTH = 256;
const MAX_SOURCE_LENGTH = 512;
const MAX_REFERENCE_LENGTH = 2_048;
const MAX_REASON_LENGTH = 2_048;
const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set<PropertyKey>([
  "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty",
  "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable",
  "toString", "valueOf", "__proto__", "toLocaleString",
]);

function hasStandardObjectPrototype(prototype: object): boolean {
  const keys = Reflect.ownKeys(prototype);
  if (keys.some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor || descriptor.enumerable !== false) return false;
    if (key === "__proto__") return !("value" in descriptor) && typeof descriptor.get === "function" && typeof descriptor.set === "function";
    return "value" in descriptor && typeof descriptor.value === "function";
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !hasStandardObjectPrototype(prototype))) return false;
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
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || typeof length.value !== "number" || length.value > MAX_ARRAY_ENTRIES) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return false;
  const indices = keys.filter((key): key is string => typeof key === "string" && isArrayIndexName(key));
  return indices.length === length.value && indices.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function arrayEntry(value: unknown[], index: number): unknown {
  return ownData(value, String(index));
}

function finding(rule: CompositionFindingRule, path: string, message: string): CompositionFinding {
  return { rule, severity: "error", path, message };
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isIdentifier(value: unknown): value is string {
  return isSafeString(value, MAX_ID_LENGTH) && IDENTIFIER.test(value);
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function unknownFields(value: UnknownRecord, allowed: ReadonlySet<string>, path: string, findings: CompositionFinding[]): void {
  for (const key of Object.getOwnPropertyNames(value).sort()) {
    if (!allowed.has(key)) findings.push(finding("unknown-field", `${path}.${key}`, "Unknown field."));
  }
}

function readScope(value: unknown, path: string, findings: CompositionFinding[]): CompositionScope | undefined {
  if (!isRecord(value)) {
    findings.push(finding("scope-shape", path, "scope must be an object containing only plane and id data fields."));
    return undefined;
  }
  unknownFields(value, SCOPE_KEYS, path, findings);
  const plane = ownData(value, "plane");
  const id = ownData(value, "id");
  if (typeof plane !== "string" || !PLANES.has(plane as CompositionPlane)) {
    findings.push(finding("scope-plane", `${path}.plane`, "plane must be producer, workspace, repository, or machine."));
  }
  if (!isIdentifier(id)) findings.push(finding("scope-id", `${path}.id`, "scope id must use lowercase words separated by dots, hyphens, or colons."));
  return typeof plane === "string" && PLANES.has(plane as CompositionPlane) && isIdentifier(id)
    ? Object.freeze({ plane: plane as CompositionPlane, id })
    : undefined;
}

function readProvenance(value: unknown, path: string, findings: CompositionFinding[]): CompositionProvenance | undefined {
  if (!isRecord(value)) {
    findings.push(finding("provenance-shape", path, "provenance must be an object containing only source and reference data fields."));
    return undefined;
  }
  unknownFields(value, PROVENANCE_KEYS, path, findings);
  const source = ownData(value, "source");
  const reference = ownData(value, "reference");
  if (!isSafeString(source, MAX_SOURCE_LENGTH)) {
    findings.push(finding("provenance-source", `${path}.source`, `source must be a trimmed opaque string of at most ${MAX_SOURCE_LENGTH} characters without control characters.`));
  }
  if (!isSafeString(reference, MAX_REFERENCE_LENGTH)) {
    findings.push(finding("provenance-reference", `${path}.reference`, `reference must be a trimmed durable reference of at most ${MAX_REFERENCE_LENGTH} characters without control characters.`));
  }
  return isSafeString(source, MAX_SOURCE_LENGTH) && isSafeString(reference, MAX_REFERENCE_LENGTH)
    ? Object.freeze({ source, reference })
    : undefined;
}

function readStringList(
  value: unknown,
  path: string,
  itemRule: CompositionFindingRule,
  duplicateRule: CompositionFindingRule,
  findings: CompositionFinding[],
  options: { identifier?: boolean; allowEmpty?: boolean } = {},
): readonly string[] | undefined {
  if (!isDenseDataArray(value) || (!options.allowEmpty && value.length === 0)) {
    findings.push(finding("collection-shape", path, `${path} must be a ${options.allowEmpty ? "" : "non-empty "}plain dense array of at most ${MAX_ARRAY_ENTRIES} entries.`));
    return undefined;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = arrayEntry(value, index);
    const valid = options.identifier ? isIdentifier(item) : isSafeString(item, MAX_VALUE_LENGTH);
    if (!valid) {
      findings.push(finding(itemRule, `${path}[${index}]`, options.identifier
        ? "The value must be a lowercase identifier."
        : `The value must be a trimmed string of at most ${MAX_VALUE_LENGTH} characters without control characters.`));
      continue;
    }
    const stringItem = item as string;
    if (seen.has(stringItem)) findings.push(finding(duplicateRule, `${path}[${index}]`, "Duplicate value."));
    else {
      seen.add(stringItem);
      result.push(stringItem);
    }
  }
  return result.length === value.length ? Object.freeze(result) : undefined;
}

function readConstraint(value: unknown, path: string, findings: CompositionFinding[]): CompositionConstraint | undefined {
  if (!isRecord(value)) {
    findings.push(finding("constraint-shape", path, "constraint must be an object."));
    return undefined;
  }
  const kind = ownData(value, "kind");
  if (kind !== "present" && kind !== "one-of") {
    unknownFields(value, new Set(["kind", "values"]), path, findings);
    findings.push(finding("constraint-kind", `${path}.kind`, "kind must be present or one-of."));
    return undefined;
  }
  unknownFields(value, kind === "present" ? PRESENCE_CONSTRAINT_KEYS : ONE_OF_CONSTRAINT_KEYS, path, findings);
  if (kind === "present") return Object.freeze({ kind });
  const values = readStringList(ownData(value, "values"), `${path}.values`, "constraint-value", "duplicate-constraint-value", findings);
  return values ? Object.freeze({ kind, values }) : undefined;
}

function readCollections(value: unknown, path: string, findings: CompositionFinding[], allowEmpty: boolean): unknown[] | undefined {
  if (!isDenseDataArray(value) || (!allowEmpty && value.length === 0)) {
    findings.push(finding("collection-shape", path, `${path} must be a ${allowEmpty ? "" : "non-empty "}plain dense array of at most ${MAX_ARRAY_ENTRIES} entries.`));
    return undefined;
  }
  return value;
}

function readDeclarations(value: unknown, findings: CompositionFinding[], ids: Set<string>): readonly CompositionDeclaration[] | undefined {
  const entries = readCollections(value, "declarations", findings, false);
  if (!entries) return undefined;
  const result: CompositionDeclaration[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const path = `declarations[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("entry-shape", path, "A declaration must be a plain data object."));
      continue;
    }
    const kind = ownData(entry, "kind");
    const allowed = kind === "preference" ? PREFERENCE_DECLARATION_KEYS : HARD_DECLARATION_KEYS;
    unknownFields(entry, allowed, path, findings);
    if (kind !== "requirement" && kind !== "policy" && kind !== "preference") {
      findings.push(finding("declaration-kind", `${path}.kind`, "kind must be requirement, policy, or preference."));
    }
    const id = ownData(entry, "id");
    const capability = ownData(entry, "capability");
    if (!isIdentifier(id)) findings.push(finding("identifier", `${path}.id`, "id must use lowercase words separated by dots, hyphens, or colons."));
    else if (ids.has(id)) findings.push(finding("duplicate-identifier", `${path}.id`, "Every declaration, supply, decision, and exception id must be unique."));
    else ids.add(id);
    if (!isIdentifier(capability)) findings.push(finding("capability", `${path}.capability`, "capability must use lowercase words separated by dots, hyphens, or colons."));
    const scope = readScope(ownData(entry, "scope"), `${path}.scope`, findings);
    const provenance = readProvenance(ownData(entry, "provenance"), `${path}.provenance`, findings);
    if (kind === "preference") {
      const preference = ownData(entry, "value");
      if (!isSafeString(preference, MAX_VALUE_LENGTH)) findings.push(finding("preference-value", `${path}.value`, "value must be a non-empty, trimmed opaque value."));
      if (isIdentifier(id) && isIdentifier(capability) && scope && provenance && isSafeString(preference, MAX_VALUE_LENGTH)) {
        result.push(Object.freeze({ kind, id, capability, scope, value: preference, provenance }));
      }
    } else {
      const constraint = readConstraint(ownData(entry, "constraint"), `${path}.constraint`, findings);
      if ((kind === "requirement" || kind === "policy") && isIdentifier(id) && isIdentifier(capability) && scope && provenance && constraint) {
        result.push(Object.freeze({ kind, id, capability, scope, constraint, provenance }));
      }
    }
  }
  return result.length === entries.length ? Object.freeze(result) : undefined;
}

function readSupplies(value: unknown, findings: CompositionFinding[], ids: Set<string>): readonly CompositionCapabilitySupply[] | undefined {
  const entries = readCollections(value, "supplies", findings, true);
  if (!entries) return undefined;
  const result: CompositionCapabilitySupply[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const path = `supplies[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("entry-shape", path, "A supply must be a plain data object."));
      continue;
    }
    unknownFields(entry, SUPPLY_KEYS, path, findings);
    const id = ownData(entry, "id");
    const capability = ownData(entry, "capability");
    const state = ownData(entry, "state");
    if (!isIdentifier(id)) findings.push(finding("identifier", `${path}.id`, "id must be a lowercase identifier."));
    else if (ids.has(id)) findings.push(finding("duplicate-identifier", `${path}.id`, "Every declaration, supply, decision, and exception id must be unique."));
    else ids.add(id);
    if (!isIdentifier(capability)) findings.push(finding("capability", `${path}.capability`, "capability must be a lowercase identifier."));
    if (state !== "available" && state !== "unavailable" && state !== "unknown") findings.push(finding("supply-state", `${path}.state`, "state must be available, unavailable, or unknown."));
    const scope = readScope(ownData(entry, "scope"), `${path}.scope`, findings);
    const provenance = readProvenance(ownData(entry, "provenance"), `${path}.provenance`, findings);
    const hasValues = Object.prototype.hasOwnProperty.call(entry, "values");
    const values = state === "available"
      ? readStringList(ownData(entry, "values"), `${path}.values`, "supply-value", "duplicate-supply-value", findings)
      : undefined;
    if (state !== "available" && hasValues) findings.push(finding("supply-value", `${path}.values`, "Only available supply may carry values."));
    if (isIdentifier(id) && isIdentifier(capability) && scope && provenance) {
      if (state === "available" && values) result.push(Object.freeze({ id, capability, scope, state, values, provenance }));
      if ((state === "unavailable" || state === "unknown") && !hasValues) result.push(Object.freeze({ id, capability, scope, state, provenance }));
    }
  }
  return result.length === entries.length ? Object.freeze(result) : undefined;
}

function readDecisions(value: unknown, findings: CompositionFinding[], ids: Set<string>): readonly CompositionOperatorDecision[] | undefined {
  const entries = readCollections(value, "decisions", findings, true);
  if (!entries) return undefined;
  const result: CompositionOperatorDecision[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const path = `decisions[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("entry-shape", path, "A decision must be a plain data object."));
      continue;
    }
    unknownFields(entry, DECISION_KEYS, path, findings);
    const id = ownData(entry, "id");
    const capability = ownData(entry, "capability");
    const selectedValue = ownData(entry, "selectedValue");
    if (!isIdentifier(id)) findings.push(finding("identifier", `${path}.id`, "id must be a lowercase identifier."));
    else if (ids.has(id)) findings.push(finding("duplicate-identifier", `${path}.id`, "Every declaration, supply, decision, and exception id must be unique."));
    else ids.add(id);
    if (!isIdentifier(capability)) findings.push(finding("capability", `${path}.capability`, "capability must be a lowercase identifier."));
    if (!isSafeString(selectedValue, MAX_VALUE_LENGTH)) findings.push(finding("decision-value", `${path}.selectedValue`, "selectedValue must be a non-empty, trimmed opaque value."));
    const scope = readScope(ownData(entry, "scope"), `${path}.scope`, findings);
    const provenance = readProvenance(ownData(entry, "provenance"), `${path}.provenance`, findings);
    const exceptionIds = readStringList(ownData(entry, "exceptionIds"), `${path}.exceptionIds`, "exception-reference", "duplicate-exception-reference", findings, { identifier: true, allowEmpty: true });
    if (isIdentifier(id) && isIdentifier(capability) && isSafeString(selectedValue, MAX_VALUE_LENGTH) && scope && provenance && exceptionIds) {
      result.push(Object.freeze({ id, capability, scope, selectedValue, exceptionIds, provenance }));
    }
  }
  return result.length === entries.length ? Object.freeze(result) : undefined;
}

function readExceptions(value: unknown, findings: CompositionFinding[], ids: Set<string>): readonly CompositionException[] | undefined {
  const entries = readCollections(value, "exceptions", findings, true);
  if (!entries) return undefined;
  const result: CompositionException[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const path = `exceptions[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("entry-shape", path, "An exception must be a plain data object."));
      continue;
    }
    unknownFields(entry, EXCEPTION_KEYS, path, findings);
    const id = ownData(entry, "id");
    const reason = ownData(entry, "reason");
    const reviewBy = ownData(entry, "reviewBy");
    const expiresAt = ownData(entry, "expiresAt");
    if (!isIdentifier(id)) findings.push(finding("identifier", `${path}.id`, "id must be a lowercase identifier."));
    else if (ids.has(id)) findings.push(finding("duplicate-identifier", `${path}.id`, "Every declaration, supply, decision, and exception id must be unique."));
    else ids.add(id);
    if (!isSafeString(reason, MAX_REASON_LENGTH)) findings.push(finding("exception-reason", `${path}.reason`, "reason must be a non-empty, trimmed explanation without control characters."));
    if (Object.prototype.hasOwnProperty.call(entry, "reviewBy") && !isCanonicalInstant(reviewBy)) findings.push(finding("exception-review-by", `${path}.reviewBy`, "reviewBy must be a canonical UTC ISO timestamp with milliseconds."));
    if (Object.prototype.hasOwnProperty.call(entry, "expiresAt") && !isCanonicalInstant(expiresAt)) findings.push(finding("exception-expires-at", `${path}.expiresAt`, "expiresAt must be a canonical UTC ISO timestamp with milliseconds."));
    const scope = readScope(ownData(entry, "scope"), `${path}.scope`, findings);
    const provenance = readProvenance(ownData(entry, "provenance"), `${path}.provenance`, findings);
    const targetDeclarationIds = readStringList(ownData(entry, "targetDeclarationIds"), `${path}.targetDeclarationIds`, "exception-target", "duplicate-exception-target", findings, { identifier: true });
    const allowedValues = readStringList(ownData(entry, "allowedValues"), `${path}.allowedValues`, "exception-value", "duplicate-exception-value", findings);
    if (isIdentifier(id) && isSafeString(reason, MAX_REASON_LENGTH) && scope && provenance && targetDeclarationIds && allowedValues
      && (!Object.prototype.hasOwnProperty.call(entry, "reviewBy") || isCanonicalInstant(reviewBy))
      && (!Object.prototype.hasOwnProperty.call(entry, "expiresAt") || isCanonicalInstant(expiresAt))) {
      result.push(Object.freeze({
        id, scope, targetDeclarationIds, allowedValues, reason,
        ...(typeof reviewBy === "string" ? { reviewBy } : {}),
        ...(typeof expiresAt === "string" ? { expiresAt } : {}),
        provenance,
      }));
    }
  }
  return result.length === entries.length ? Object.freeze(result) : undefined;
}

function validateRelationships(input: CompositionEvaluationInput, findings: CompositionFinding[]): void {
  const declarations = new Map(input.declarations.map((entry) => [entry.id, entry]));
  const groups = new Set(input.declarations.map((entry) => groupKey(entry.capability, entry.scope)));
  const decisions = new Set<string>();
  const exceptions = new Map(input.exceptions.map((entry) => [entry.id, entry]));

  input.supplies.forEach((supply, index) => {
    if (!groups.has(groupKey(supply.capability, supply.scope))) findings.push(finding("orphan-supply", `supplies[${index}]`, "Supply must match an explicitly declared capability and scope."));
  });
  input.decisions.forEach((decision, index) => {
    const key = groupKey(decision.capability, decision.scope);
    if (!groups.has(key)) findings.push(finding("orphan-decision", `decisions[${index}]`, "Decision must match an explicitly declared capability and scope."));
    if (decisions.has(key)) findings.push(finding("duplicate-decision", `decisions[${index}]`, "Each capability and scope may have at most one operator decision."));
    decisions.add(key);
    decision.exceptionIds.forEach((id, exceptionIndex) => {
      const exception = exceptions.get(id);
      if (!exception) {
        findings.push(finding("exception-reference", `decisions[${index}].exceptionIds[${exceptionIndex}]`, "Referenced exception does not exist."));
        return;
      }
      const targets = exception.targetDeclarationIds.map((target) => declarations.get(target)).filter((target) => target !== undefined);
      if (scopeKey(exception.scope) !== scopeKey(decision.scope) || targets.some((target) => target.capability !== decision.capability)) {
        findings.push(finding("exception-scope", `decisions[${index}].exceptionIds[${exceptionIndex}]`, "Referenced exception must target this exact capability and scope."));
      }
    });
  });
  input.exceptions.forEach((exception, index) => {
    let targetCapability: string | undefined;
    exception.targetDeclarationIds.forEach((id, targetIndex) => {
      const target = declarations.get(id);
      if (!target) {
        findings.push(finding("exception-target", `exceptions[${index}].targetDeclarationIds[${targetIndex}]`, "Target declaration does not exist."));
        return;
      }
      if (target.kind === "preference") {
        findings.push(finding("exception-target-kind", `exceptions[${index}].targetDeclarationIds[${targetIndex}]`, "Exceptions may target only requirement or policy declarations."));
      }
      if (scopeKey(target.scope) !== scopeKey(exception.scope)) {
        findings.push(finding("exception-scope", `exceptions[${index}].targetDeclarationIds[${targetIndex}]`, "Every target must have the exception's exact scope."));
      }
      if (targetCapability !== undefined && target.capability !== targetCapability) {
        findings.push(finding("exception-scope", `exceptions[${index}].targetDeclarationIds[${targetIndex}]`, "One exception may target only one capability."));
      }
      targetCapability = target.capability;
    });
  });
}

export interface CompositionInputRead {
  readonly input?: CompositionEvaluationInput;
  readonly findings: readonly CompositionFinding[];
}

/** Internal one-pass read that snapshots validated caller data before evaluation. */
export function readCompositionEvaluationInput(value: unknown): CompositionInputRead {
  try {
    if (!isRecord(value)) return { findings: [finding("input-shape", "$", "A composition evaluation input must be a plain data object.")] };
    const findings: CompositionFinding[] = [];
    unknownFields(value, INPUT_KEYS, "$", findings);
    const schemaVersion = ownData(value, "schemaVersion");
    const evaluatedAt = ownData(value, "evaluatedAt");
    if (schemaVersion !== COMPOSITION_SCHEMA_VERSION) findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${COMPOSITION_SCHEMA_VERSION}.`));
    if (!isCanonicalInstant(evaluatedAt)) findings.push(finding("evaluated-at", "evaluatedAt", "evaluatedAt must be a canonical UTC ISO timestamp with milliseconds."));
    const ids = new Set<string>();
    const declarations = readDeclarations(ownData(value, "declarations"), findings, ids);
    const supplies = readSupplies(ownData(value, "supplies"), findings, ids);
    const decisions = readDecisions(ownData(value, "decisions"), findings, ids);
    const exceptions = readExceptions(ownData(value, "exceptions"), findings, ids);
    if (findings.length > 0 || schemaVersion !== COMPOSITION_SCHEMA_VERSION || !isCanonicalInstant(evaluatedAt)
      || !declarations || !supplies || !decisions || !exceptions) return { findings };
    const input: CompositionEvaluationInput = Object.freeze({ schemaVersion, evaluatedAt, declarations, supplies, decisions, exceptions });
    validateRelationships(input, findings);
    return findings.length === 0 ? { input, findings: Object.freeze([]) } : { findings: Object.freeze(findings) };
  } catch {
    return { findings: [finding("input-shape", "$", "A composition evaluation input must be safely readable.")] };
  }
}

/** Strictly validates untrusted composition data without I/O, mutation, or throwing. */
export function validateCompositionEvaluationInput(value: unknown): CompositionFinding[] {
  return [...readCompositionEvaluationInput(value).findings];
}
