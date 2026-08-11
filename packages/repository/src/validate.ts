import { REPOSITORY_PROFILE_VERSION } from "./types.js";
import type { RepositoryProfileFinding, RepositoryProfileFindingRule } from "./types.js";

type RecordValue = Record<string, unknown>;

const PROFILE_KEYS = new Set(["schemaVersion", "defaultBranch", "commands", "protectedPaths"]);
const COMMAND_KEYS = new Set(["name", "run", "cwd"]);
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:(?:-|:)[a-z0-9]+)*$/;
const MAX_PROFILE_COLLECTION_ENTRIES = 10_000;
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

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  return Object.getPrototypeOf(prototype) === null && hasStandardObjectPrototype(prototype);
}

function isArrayIndexName(name: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(name) && Number(name) < 0xffffffff;
}

interface InspectedArray {
  value: unknown[];
  length: number;
  indexNames: string[];
}

function inspectArray(value: unknown): InspectedArray | undefined {
  if (!Array.isArray(value)) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || typeof length.value !== "number") return undefined;
  if (length.value > MAX_PROFILE_COLLECTION_ENTRIES) return undefined;
  return {
    value,
    length: length.value,
    indexNames: ownKeys
      .filter((key): key is string => typeof key === "string" && isArrayIndexName(key))
      .sort((left, right) => Number(left) - Number(right)),
  };
}

function finding(rule: RepositoryProfileFindingRule, path: string, message: string): RepositoryProfileFinding {
  return { rule, severity: "error", path, message };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownDataValue(value: object, key: PropertyKey): { value: unknown } | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? { value: descriptor.value } : undefined;
}

function isRepositoryRelative(value: string, allowPatterns: boolean): boolean {
  if (value.length === 0 || value.startsWith("/") || /^[a-z]:/i.test(value) || value.includes("\\") || value.includes("\0")) return false;
  if (!allowPatterns && /[*?[\]{}]/.test(value)) return false;
  if (allowPatterns && (/[?[\]{}]/.test(value) || /[@+?!*]\(/.test(value) || value.startsWith("!"))) return false;
  const withoutTrailingSeparator = value.endsWith("/") ? value.slice(0, -1) : value;
  return withoutTrailingSeparator.length > 0 && !withoutTrailingSeparator.split("/").some((segment) => segment === ".." || segment.length === 0);
}

function isBranchName(value: string): boolean {
  if (value.length === 0 || value === "HEAD" || value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock") || value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || forbidden.has(character)) return false;
  }
  return !value
    .split("/")
    .some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"));
}

function validateRepositoryProfileValue(value: unknown): RepositoryProfileFinding[] {
  if (!isRecord(value)) return [finding("profile-shape", "$", "A repository profile must be an object.")];

  const findings: RepositoryProfileFinding[] = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!PROFILE_KEYS.has(key)) findings.push(finding("unknown-field", key, `Unknown profile field "${key}".`));
  }

  const schemaVersion = ownDataValue(value, "schemaVersion")?.value;
  if (schemaVersion !== REPOSITORY_PROFILE_VERSION) {
    findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${REPOSITORY_PROFILE_VERSION}.`));
  }

  const defaultBranch = ownDataValue(value, "defaultBranch")?.value;
  if (typeof defaultBranch !== "string" || !isBranchName(defaultBranch)) {
    findings.push(finding("default-branch", "defaultBranch", "defaultBranch must be a valid Git branch name."));
  }

  const commands = inspectArray(ownDataValue(value, "commands")?.value);
  if (!commands) {
    findings.push(finding("commands-shape", "commands", `commands must be a plain array of at most ${MAX_PROFILE_COLLECTION_ENTRIES} entries with no behavior-shadowing properties.`));
  } else {
    const seenNames = new Set<string>();
    let nextExpectedIndex = 0;
    let reportedHole = false;
    for (const indexName of commands.indexNames) {
      const index = Number(indexName);
      if (!reportedHole && index > nextExpectedIndex) {
        findings.push(finding("command-shape", `commands[${nextExpectedIndex}]`, "commands must not contain empty slots."));
        reportedHole = true;
      }
      nextExpectedIndex = index + 1;
      const command = ownDataValue(commands.value, indexName)?.value;
      const commandPath = `commands[${index}]`;
      if (!isRecord(command)) {
        findings.push(finding("command-shape", commandPath, "A command must be an object."));
        continue;
      }
      for (const key of Object.getOwnPropertyNames(command)) {
        if (!COMMAND_KEYS.has(key)) findings.push(finding("unknown-field", `${commandPath}.${key}`, `Unknown command field "${key}".`));
      }
      const name = ownDataValue(command, "name")?.value;
      if (typeof name !== "string" || !COMMAND_NAME.test(name)) {
        findings.push(finding("command-name", `${commandPath}.name`, "name must be lowercase words separated by hyphens or colons."));
      } else if (seenNames.has(name)) {
        findings.push(finding("duplicate-command-name", `${commandPath}.name`, `Duplicate command name "${name}".`));
      } else {
        seenNames.add(name);
      }
      const run = ownDataValue(command, "run")?.value;
      if (typeof run !== "string" || run.trim().length === 0) {
        findings.push(finding("command-run", `${commandPath}.run`, "run must be a non-empty string."));
      }
      const ownsCwd = hasOwn(command, "cwd");
      const cwd = ownDataValue(command, "cwd")?.value;
      if ((!ownsCwd && "cwd" in command) || (ownsCwd && (typeof cwd !== "string" || !isRepositoryRelative(cwd, false)))) {
        findings.push(finding("command-cwd", `${commandPath}.cwd`, "cwd, when present, must be an own repository-relative directory without glob syntax or parent traversal."));
      }
    }
    if (!reportedHole && nextExpectedIndex < commands.length) {
      findings.push(finding("command-shape", `commands[${nextExpectedIndex}]`, "commands must not contain empty slots."));
    }
  }

  const protectedPaths = inspectArray(ownDataValue(value, "protectedPaths")?.value);
  if (!protectedPaths) {
    findings.push(finding("protected-paths-shape", "protectedPaths", `protectedPaths must be a plain array of at most ${MAX_PROFILE_COLLECTION_ENTRIES} entries with no behavior-shadowing properties.`));
  } else {
    const seen = new Set<string>();
    let nextExpectedIndex = 0;
    let reportedHole = false;
    for (const indexName of protectedPaths.indexNames) {
      const index = Number(indexName);
      if (!reportedHole && index > nextExpectedIndex) {
        findings.push(finding("protected-path", `protectedPaths[${nextExpectedIndex}]`, "protectedPaths must not contain empty slots."));
        reportedHole = true;
      }
      nextExpectedIndex = index + 1;
      const path = ownDataValue(protectedPaths.value, indexName)?.value;
      const inputPath = `protectedPaths[${index}]`;
      if (typeof path !== "string" || !isRepositoryRelative(path, true)) {
        findings.push(finding("protected-path", inputPath, "A protected path must be a repository-relative path or glob without parent traversal."));
        continue;
      }
      if (seen.has(path)) findings.push(finding("duplicate-protected-path", inputPath, `Duplicate protected path "${path}".`));
      seen.add(path);
    }
    if (!reportedHole && nextExpectedIndex < protectedPaths.length) {
      findings.push(finding("protected-path", `protectedPaths[${nextExpectedIndex}]`, "protectedPaths must not contain empty slots."));
    }
  }

  return findings;
}

/**
 * Validates an untrusted repository profile without I/O or throwing.
 * Fields are inspected as own data descriptors; accessors are never invoked.
 * Findings are emitted deterministically and every independently checkable
 * problem is reported.
 */
export function validateRepositoryProfile(value: unknown): RepositoryProfileFinding[] {
  try {
    return validateRepositoryProfileValue(value);
  } catch {
    return [finding("profile-shape", "$", "A repository profile must be a safely readable object.")];
  }
}
