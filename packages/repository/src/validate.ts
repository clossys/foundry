import { REPOSITORY_PROFILE_VERSION } from "./types.js";
import type { RepositoryProfile, RepositoryProfileFinding, RepositoryProfileFindingRule } from "./types.js";

type RecordValue = Record<string, unknown>;

const PROFILE_KEYS = new Set(["schemaVersion", "defaultBranch", "commands", "protectedPaths"]);
const COMMAND_KEYS = new Set(["name", "run", "cwd"]);
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:(?:-|:)[a-z0-9]+)*$/;
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
const REQUIRED_ARRAY_PROTOTYPE_FUNCTIONS = [
  "constructor",
  "at",
  "concat",
  "copyWithin",
  "fill",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "lastIndexOf",
  "pop",
  "push",
  "reverse",
  "shift",
  "unshift",
  "slice",
  "sort",
  "splice",
  "includes",
  "indexOf",
  "join",
  "keys",
  "entries",
  "values",
  "forEach",
  "filter",
  "flat",
  "flatMap",
  "map",
  "every",
  "some",
  "reduce",
  "reduceRight",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
  "toLocaleString",
  "toString",
] as const;

function hasStandardObjectPrototype(prototype: object): boolean {
  const actualKeys = Reflect.ownKeys(prototype);
  if (actualKeys.length !== STANDARD_OBJECT_PROTOTYPE_KEYS.size || actualKeys.some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) return false;

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

function hasStandardArrayPrototype(prototype: object): boolean {
  const objectPrototype = Object.getPrototypeOf(prototype);
  if (typeof objectPrototype !== "object" || objectPrototype === null || Object.getPrototypeOf(objectPrototype) !== null) return false;
  if (!hasStandardObjectPrototype(objectPrototype)) return false;

  const length = Object.getOwnPropertyDescriptor(prototype, "length");
  if (!length || !("value" in length) || length.value !== 0 || length.enumerable !== false) return false;
  for (const key of REQUIRED_ARRAY_PROTOTYPE_FUNCTIONS) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || descriptor.enumerable !== false) return false;
  }

  const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
  const values = Object.getOwnPropertyDescriptor(prototype, "values");
  return Boolean(iterator && values && "value" in iterator && "value" in values && iterator.value === values.value && iterator.enumerable === false);
}

function isArrayIndexName(name: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(name) && Number(name) < 0xffffffff;
}

function isPlainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexName(key)))) return false;
  const prototype = Object.getPrototypeOf(value);
  return typeof prototype === "object" && prototype !== null && hasStandardArrayPrototype(prototype);
}

function finding(rule: RepositoryProfileFindingRule, path: string, message: string): RepositoryProfileFinding {
  return { rule, severity: "error", path, message };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function arrayIndexNames(value: unknown[]): string[] {
  return Object.getOwnPropertyNames(value)
    .filter(isArrayIndexName)
    .sort((left, right) => Number(left) - Number(right));
}

function validateRepositoryProfileValue(value: unknown): RepositoryProfileFinding[] {
  if (!isRecord(value)) return [finding("profile-shape", "$", "A repository profile must be an object.")];

  const findings: RepositoryProfileFinding[] = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!PROFILE_KEYS.has(key)) findings.push(finding("unknown-field", key, `Unknown profile field "${key}".`));
  }

  if (!hasOwn(value, "schemaVersion") || value.schemaVersion !== REPOSITORY_PROFILE_VERSION) {
    findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${REPOSITORY_PROFILE_VERSION}.`));
  }

  if (!hasOwn(value, "defaultBranch") || typeof value.defaultBranch !== "string" || !isBranchName(value.defaultBranch)) {
    findings.push(finding("default-branch", "defaultBranch", "defaultBranch must be a valid Git branch name."));
  }

  if (!hasOwn(value, "commands") || !isPlainArray(value.commands)) {
    findings.push(finding("commands-shape", "commands", "commands must be a plain array with no behavior-shadowing properties."));
  } else {
    const seenNames = new Set<string>();
    let nextExpectedIndex = 0;
    let reportedHole = false;
    for (const indexName of arrayIndexNames(value.commands)) {
      const index = Number(indexName);
      if (!reportedHole && index > nextExpectedIndex) {
        findings.push(finding("command-shape", `commands[${nextExpectedIndex}]`, "commands must not contain empty slots."));
        reportedHole = true;
      }
      nextExpectedIndex = index + 1;
      const command = value.commands[index];
      const commandPath = `commands[${index}]`;
      if (!isRecord(command)) {
        findings.push(finding("command-shape", commandPath, "A command must be an object."));
        continue;
      }
      for (const key of Object.getOwnPropertyNames(command)) {
        if (!COMMAND_KEYS.has(key)) findings.push(finding("unknown-field", `${commandPath}.${key}`, `Unknown command field "${key}".`));
      }
      if (!hasOwn(command, "name") || typeof command.name !== "string" || !COMMAND_NAME.test(command.name)) {
        findings.push(finding("command-name", `${commandPath}.name`, "name must be lowercase words separated by hyphens or colons."));
      } else if (seenNames.has(command.name)) {
        findings.push(finding("duplicate-command-name", `${commandPath}.name`, `Duplicate command name "${command.name}".`));
      } else {
        seenNames.add(command.name);
      }
      if (!hasOwn(command, "run") || typeof command.run !== "string" || command.run.trim().length === 0) {
        findings.push(finding("command-run", `${commandPath}.run`, "run must be a non-empty string."));
      }
      const ownsCwd = hasOwn(command, "cwd");
      if ((!ownsCwd && "cwd" in command) || (ownsCwd && (typeof command.cwd !== "string" || !isRepositoryRelative(command.cwd, false)))) {
        findings.push(finding("command-cwd", `${commandPath}.cwd`, "cwd, when present, must be an own repository-relative directory without glob syntax or parent traversal."));
      }
    }
    if (!reportedHole && nextExpectedIndex < value.commands.length) {
      findings.push(finding("command-shape", `commands[${nextExpectedIndex}]`, "commands must not contain empty slots."));
    }
  }

  if (!hasOwn(value, "protectedPaths") || !isPlainArray(value.protectedPaths)) {
    findings.push(finding("protected-paths-shape", "protectedPaths", "protectedPaths must be a plain array with no behavior-shadowing properties."));
  } else {
    const seen = new Set<string>();
    let nextExpectedIndex = 0;
    let reportedHole = false;
    for (const indexName of arrayIndexNames(value.protectedPaths)) {
      const index = Number(indexName);
      if (!reportedHole && index > nextExpectedIndex) {
        findings.push(finding("protected-path", `protectedPaths[${nextExpectedIndex}]`, "protectedPaths must not contain empty slots."));
        reportedHole = true;
      }
      nextExpectedIndex = index + 1;
      const path = value.protectedPaths[index];
      const inputPath = `protectedPaths[${index}]`;
      if (typeof path !== "string" || !isRepositoryRelative(path, true)) {
        findings.push(finding("protected-path", inputPath, "A protected path must be a repository-relative path or glob without parent traversal."));
        continue;
      }
      if (seen.has(path)) findings.push(finding("duplicate-protected-path", inputPath, `Duplicate protected path "${path}".`));
      seen.add(path);
    }
    if (!reportedHole && nextExpectedIndex < value.protectedPaths.length) {
      findings.push(finding("protected-path", `protectedPaths[${nextExpectedIndex}]`, "protectedPaths must not contain empty slots."));
    }
  }

  return findings;
}

/**
 * Validates an untrusted repository profile without I/O or throwing.
 * Findings are emitted in input order and every independently checkable
 * problem is reported.
 */
export function validateRepositoryProfile(value: unknown): RepositoryProfileFinding[] {
  try {
    return validateRepositoryProfileValue(value);
  } catch {
    return [finding("profile-shape", "$", "A repository profile must be a safely readable object.")];
  }
}

/** Returns true only when the value conforms to the complete profile shape. */
export function isRepositoryProfile(value: unknown): value is RepositoryProfile {
  return validateRepositoryProfile(value).length === 0;
}
