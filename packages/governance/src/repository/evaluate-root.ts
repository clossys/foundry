import { isRepositoryRootEntryName, readRepositoryRootEntries } from "./validate.js";
import type {
  RepositoryRootEntry,
  RepositoryRootEntryEvaluation,
  RepositoryRootEvaluation,
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

function readDenseDataArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || typeof length.value !== "number" || length.value > MAX_ENTRIES) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return undefined;
  const indexes = keys.filter((key): key is string => typeof key === "string" && isArrayIndexName(key));
  if (indexes.length !== length.value) return undefined;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return undefined;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function finding(rule: RepositoryRootFindingRule, path: string, message: string): RepositoryRootFinding {
  return { rule, severity: "error", path, message };
}

interface RepositoryRootEvaluationSnapshot {
  readonly rootEntries: readonly RepositoryRootEntry[];
  readonly observedEntries: readonly string[];
}

interface RepositoryRootEvaluationInputRead {
  readonly findings: readonly RepositoryRootFinding[];
  readonly snapshot: RepositoryRootEvaluationSnapshot | undefined;
}

function readRepositoryRootEvaluationInput(value: unknown): RepositoryRootEvaluationInputRead {
  try {
    if (!isRecord(value)) return { findings: [finding("root-evaluation-shape", "$", "A repository root evaluation input must be an object.")], snapshot: undefined };
    const findings: RepositoryRootFinding[] = [];
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      if (!INPUT_KEYS.has(key)) findings.push(finding("root-evaluation-unknown-field", `$.${key}`, "Unknown field."));
    }

    const rootEntries = readRepositoryRootEntries(ownData(value, "rootEntries"));
    findings.push(...rootEntries.findings);

    const observedEntries = readDenseDataArray(ownData(value, "observedEntries"));
    if (!observedEntries) {
      findings.push(finding("observed-entries-shape", "observedEntries", `observedEntries must be a plain array of at most ${MAX_ENTRIES} direct-child names.`));
      return { findings: Object.freeze(findings), snapshot: undefined };
    }
    const seen = new Set<string>();
    const observedSnapshot: string[] = [];
    for (let index = 0; index < observedEntries.length; index += 1) {
      const entry = observedEntries[index];
      const path = `observedEntries[${index}]`;
      if (!isRepositoryRootEntryName(entry)) {
        findings.push(finding("observed-entry-name", path, "An observed entry must be one trimmed direct-child name without path separators or control characters."));
      } else if (seen.has(entry)) {
        findings.push(finding("duplicate-observed-entry", path, `Duplicate observed entry "${entry}".`));
      } else {
        seen.add(entry);
        observedSnapshot.push(entry);
      }
    }
    if (findings.length > 0 || !rootEntries.entries) return { findings: Object.freeze(findings), snapshot: undefined };
    return {
      findings: Object.freeze(findings),
      snapshot: Object.freeze({
        rootEntries: rootEntries.entries,
        observedEntries: Object.freeze(observedSnapshot),
      }),
    };
  } catch {
    return { findings: [finding("root-evaluation-shape", "$", "A repository root evaluation input must be safely readable.")], snapshot: undefined };
  }
}

/** Strictly validates a caller-owned root vocabulary and normalized direct-child observations. */
export function validateRepositoryRootEvaluationInput(value: unknown): RepositoryRootFinding[] {
  return [...readRepositoryRootEvaluationInput(value).findings];
}

/**
 * Proves an exact repository root from already-discovered direct-child names.
 * It performs no filesystem discovery, retention decision, or mutation.
 */
export function evaluateRepositoryRoot(value: unknown): RepositoryRootEvaluation {
  const input = readRepositoryRootEvaluationInput(value);
  if (input.findings.length > 0 || !input.snapshot) {
    return { ok: false, status: "invalid", entries: [], findings: [...input.findings] };
  }

  const { rootEntries, observedEntries } = input.snapshot;
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
