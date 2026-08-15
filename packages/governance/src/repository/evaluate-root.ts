import { isRepositoryRootEntryName, validateRepositoryRootEntries } from "./validate.js";
import type {
  RepositoryRootEntry,
  RepositoryRootEntryEvaluation,
  RepositoryRootEvaluation,
  RepositoryRootEvaluationInput,
  RepositoryRootFinding,
  RepositoryRootFindingRule,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const INPUT_KEYS = new Set(["rootEntries", "observedEntries"]);
const MAX_ENTRIES = 10_000;
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
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || typeof length.value !== "number" || length.value > MAX_ENTRIES) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return false;
  const indexes = keys.filter((key): key is string => typeof key === "string" && isArrayIndexName(key));
  return indexes.length === length.value && indexes.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function finding(rule: RepositoryRootFindingRule, path: string, message: string): RepositoryRootFinding {
  return { rule, severity: "error", path, message };
}

/** Strictly validates a caller-owned root vocabulary and normalized direct-child observations. */
export function validateRepositoryRootEvaluationInput(value: unknown): RepositoryRootFinding[] {
  try {
    if (!isRecord(value)) return [finding("root-evaluation-shape", "$", "A repository root evaluation input must be an object.")];
    const findings: RepositoryRootFinding[] = [];
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      if (!INPUT_KEYS.has(key)) findings.push(finding("root-evaluation-unknown-field", `$.${key}`, "Unknown field."));
    }

    findings.push(...validateRepositoryRootEntries(ownData(value, "rootEntries")));

    const observedEntries = ownData(value, "observedEntries");
    if (!isDenseDataArray(observedEntries)) {
      findings.push(finding("observed-entries-shape", "observedEntries", `observedEntries must be a plain array of at most ${MAX_ENTRIES} direct-child names.`));
      return findings;
    }
    const seen = new Set<string>();
    for (let index = 0; index < observedEntries.length; index += 1) {
      const entry = ownData(observedEntries, String(index));
      const path = `observedEntries[${index}]`;
      if (!isRepositoryRootEntryName(entry)) {
        findings.push(finding("observed-entry-name", path, "An observed entry must be one trimmed direct-child name without path separators or control characters."));
      } else if (seen.has(entry)) {
        findings.push(finding("duplicate-observed-entry", path, `Duplicate observed entry "${entry}".`));
      } else {
        seen.add(entry);
      }
    }
    return findings;
  } catch {
    return [finding("root-evaluation-shape", "$", "A repository root evaluation input must be safely readable.")];
  }
}

function readDenseArray<T>(value: readonly T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(ownData(value, String(index)) as T);
  return result;
}

/**
 * Proves an exact repository root from already-discovered direct-child names.
 * It performs no filesystem discovery, retention decision, or mutation.
 */
export function evaluateRepositoryRoot(value: unknown): RepositoryRootEvaluation {
  const validationFindings = validateRepositoryRootEvaluationInput(value);
  if (validationFindings.length > 0) {
    return { ok: false, status: "invalid", entries: [], findings: validationFindings };
  }

  const input = value as RepositoryRootEvaluationInput;
  const rootEntries = readDenseArray<RepositoryRootEntry>(input.rootEntries);
  const observedEntries = readDenseArray<string>(input.observedEntries);
  const observed = new Set(observedEntries);
  const declared = new Set(rootEntries.map((entry) => entry.name));
  const findings: RepositoryRootFinding[] = [];
  const entries: RepositoryRootEntryEvaluation[] = rootEntries.map((entry, index) => {
    const isObserved = observed.has(entry.name);
    const status = entry.disposition === "required" && !isObserved
      ? "missing"
      : entry.disposition === "prohibited" && isObserved
        ? "prohibited"
        : "satisfied";
    if (status === "missing") findings.push(finding("root-entry-missing", `rootEntries[${index}]`, "A required root entry was not observed."));
    if (status === "prohibited") findings.push(finding("root-entry-prohibited", `rootEntries[${index}]`, "A prohibited root entry was observed."));
    return { ...entry, observed: isObserved, status };
  });

  for (let index = 0; index < observedEntries.length; index += 1) {
    const name = observedEntries[index]!;
    if (declared.has(name)) continue;
    entries.push({ name, observed: true, status: "unknown" });
    findings.push(finding("root-entry-unknown", `observedEntries[${index}]`, "An observed direct child is not declared in the root vocabulary."));
  }

  return {
    ok: findings.length === 0,
    status: findings.length === 0 ? "satisfied" : "nonconforming",
    entries,
    findings,
  };
}
