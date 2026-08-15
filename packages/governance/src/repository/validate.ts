import {
  LEGACY_REPOSITORY_PROFILE_VERSION,
  PREVIOUS_REPOSITORY_PROFILE_VERSION,
  REPOSITORY_PROFILE_VERSION,
} from "./types.js";
import type {
  RepositoryProfileFinding,
  RepositoryProfileFindingRule,
  RepositoryRequirementScope,
  RepositoryRootEntryClassification,
  RepositoryRootEntryDisposition,
} from "./types.js";

type RecordValue = Record<string, unknown>;

const PROFILE_V1_KEYS = new Set(["schemaVersion", "defaultBranch", "commands", "protectedPaths"]);
const PROFILE_V2_KEYS = new Set([...PROFILE_V1_KEYS, "requirements"]);
const PROFILE_V3_KEYS = new Set([...PROFILE_V2_KEYS, "rootEntries"]);
const COMMAND_KEYS = new Set(["name", "run", "cwd"]);
const REQUIREMENT_KEYS = new Set(["id", "scope", "constraint"]);
const PRESENCE_CONSTRAINT_KEYS = new Set(["kind"]);
const ONE_OF_CONSTRAINT_KEYS = new Set(["kind", "values"]);
const ROOT_ENTRY_KEYS = new Set(["name", "classification", "disposition"]);
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:(?:-|:)[a-z0-9]+)*$/;
const REQUIREMENT_ID = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;
const REQUIREMENT_SCOPES = new Set<RepositoryRequirementScope>(["repository", "workspace", "machine"]);
const ROOT_ENTRY_CLASSIFICATIONS = new Set<RepositoryRootEntryClassification>([
  "canonical",
  "extension",
  "exception",
  "compatibility-alias",
  "legacy-artifact",
]);
const ROOT_ENTRY_DISPOSITIONS = new Set<RepositoryRootEntryDisposition>(["required", "allowed", "prohibited"]);
const MAX_PROFILE_COLLECTION_ENTRIES = 10_000;
const MAX_REQUIREMENT_VALUE_LENGTH = 256;
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

function isRequirementValue(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_REQUIREMENT_VALUE_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isRepositoryRootEntryName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && value === value.trim()
    && value !== "."
    && value !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

export function validateRepositoryRootEntries(value: unknown): RepositoryProfileFinding[] {
  const entries = inspectArray(value);
  if (!entries) {
    return [finding("root-entries-shape", "rootEntries", `rootEntries must be a plain array of at most ${MAX_PROFILE_COLLECTION_ENTRIES} entries with no behavior-shadowing properties.`)];
  }

  const findings: RepositoryProfileFinding[] = [];
  const seen = new Set<string>();
  let nextExpectedIndex = 0;
  let reportedHole = false;
  for (const indexName of entries.indexNames) {
    const index = Number(indexName);
    if (!reportedHole && index > nextExpectedIndex) {
      findings.push(finding("root-entry-shape", `rootEntries[${nextExpectedIndex}]`, "rootEntries must not contain empty slots."));
      reportedHole = true;
    }
    nextExpectedIndex = index + 1;
    const entry = ownDataValue(entries.value, indexName)?.value;
    const entryPath = `rootEntries[${index}]`;
    if (!isRecord(entry)) {
      findings.push(finding("root-entry-shape", entryPath, "A root entry must be an object."));
      continue;
    }
    const entryKeys = Reflect.ownKeys(entry);
    if (entryKeys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      return typeof key !== "string" || descriptor === undefined || !("value" in descriptor);
    })) {
      findings.push(finding("root-entry-shape", entryPath, "A root entry must contain only own string-keyed data fields."));
      continue;
    }
    for (const key of entryKeys as string[]) {
      if (!ROOT_ENTRY_KEYS.has(key)) findings.push(finding("unknown-field", `${entryPath}.${key}`, `Unknown root entry field "${key}".`));
    }
    const name = ownDataValue(entry, "name")?.value;
    const classification = ownDataValue(entry, "classification")?.value;
    const disposition = ownDataValue(entry, "disposition")?.value;
    if (!isRepositoryRootEntryName(name)) {
      findings.push(finding("root-entry-name", `${entryPath}.name`, "name must be one trimmed direct-child name without path separators or control characters."));
    } else if (seen.has(name)) {
      findings.push(finding("duplicate-root-entry", `${entryPath}.name`, `Duplicate root entry "${name}".`));
    } else {
      seen.add(name);
    }
    if (typeof classification !== "string" || !ROOT_ENTRY_CLASSIFICATIONS.has(classification as RepositoryRootEntryClassification)) {
      findings.push(finding("root-entry-classification", `${entryPath}.classification`, "classification must be canonical, extension, exception, compatibility-alias, or legacy-artifact."));
    }
    if (typeof disposition !== "string" || !ROOT_ENTRY_DISPOSITIONS.has(disposition as RepositoryRootEntryDisposition)) {
      findings.push(finding("root-entry-disposition", `${entryPath}.disposition`, "disposition must be required, allowed, or prohibited."));
    }
  }
  if (!reportedHole && nextExpectedIndex < entries.length) {
    findings.push(finding("root-entry-shape", `rootEntries[${nextExpectedIndex}]`, "rootEntries must not contain empty slots."));
  }
  return findings;
}

function validateRequirementArray(value: unknown): RepositoryProfileFinding[] {
  const requirements = inspectArray(value);
  if (!requirements) {
    return [finding("requirements-shape", "requirements", `requirements must be a plain array of at most ${MAX_PROFILE_COLLECTION_ENTRIES} entries with no behavior-shadowing properties.`)];
  }

  const findings: RepositoryProfileFinding[] = [];
  const seen = new Set<string>();
  let nextExpectedIndex = 0;
  let reportedHole = false;
  for (const indexName of requirements.indexNames) {
    const index = Number(indexName);
    if (!reportedHole && index > nextExpectedIndex) {
      findings.push(finding("requirement-shape", `requirements[${nextExpectedIndex}]`, "requirements must not contain empty slots."));
      reportedHole = true;
    }
    nextExpectedIndex = index + 1;
    const requirement = ownDataValue(requirements.value, indexName)?.value;
    const requirementPath = `requirements[${index}]`;
    if (!isRecord(requirement)) {
      findings.push(finding("requirement-shape", requirementPath, "A requirement must be an object."));
      continue;
    }
    for (const key of Object.getOwnPropertyNames(requirement)) {
      if (!REQUIREMENT_KEYS.has(key)) findings.push(finding("unknown-field", `${requirementPath}.${key}`, `Unknown requirement field "${key}".`));
    }

    const id = ownDataValue(requirement, "id")?.value;
    const scope = ownDataValue(requirement, "scope")?.value;
    if (typeof id !== "string" || !REQUIREMENT_ID.test(id)) {
      findings.push(finding("requirement-id", `${requirementPath}.id`, "id must be lowercase words separated by dots, hyphens, or colons."));
    }
    if (typeof scope !== "string" || !REQUIREMENT_SCOPES.has(scope as RepositoryRequirementScope)) {
      findings.push(finding("requirement-scope", `${requirementPath}.scope`, "scope must be repository, workspace, or machine."));
    }
    if (typeof id === "string" && REQUIREMENT_ID.test(id) && typeof scope === "string" && REQUIREMENT_SCOPES.has(scope as RepositoryRequirementScope)) {
      const identity = `${scope}\u0000${id}`;
      if (seen.has(identity)) findings.push(finding("duplicate-requirement", requirementPath, `Duplicate ${scope}-scoped requirement "${id}".`));
      else seen.add(identity);
    }

    const constraint = ownDataValue(requirement, "constraint")?.value;
    if (!isRecord(constraint)) {
      findings.push(finding("constraint-shape", `${requirementPath}.constraint`, "constraint must be an object."));
      continue;
    }
    const kind = ownDataValue(constraint, "kind")?.value;
    const allowedKeys = kind === "present" ? PRESENCE_CONSTRAINT_KEYS : kind === "one-of" ? ONE_OF_CONSTRAINT_KEYS : new Set<string>(["kind"]);
    for (const key of Object.getOwnPropertyNames(constraint)) {
      if (!allowedKeys.has(key)) findings.push(finding("unknown-field", `${requirementPath}.constraint.${key}`, `Unknown constraint field "${key}".`));
    }
    if (kind !== "present" && kind !== "one-of") {
      findings.push(finding("constraint-kind", `${requirementPath}.constraint.kind`, "kind must be present or one-of."));
      continue;
    }
    if (kind === "present") continue;

    const values = inspectArray(ownDataValue(constraint, "values")?.value);
    if (!values || values.length === 0) {
      findings.push(finding("constraint-values-shape", `${requirementPath}.constraint.values`, `values must be a non-empty plain array of at most ${MAX_PROFILE_COLLECTION_ENTRIES} entries with no behavior-shadowing properties.`));
      continue;
    }
    const seenValues = new Set<string>();
    let nextExpectedValueIndex = 0;
    let reportedValueHole = false;
    for (const valueIndexName of values.indexNames) {
      const valueIndex = Number(valueIndexName);
      if (!reportedValueHole && valueIndex > nextExpectedValueIndex) {
        findings.push(finding("constraint-value", `${requirementPath}.constraint.values[${nextExpectedValueIndex}]`, "values must not contain empty slots."));
        reportedValueHole = true;
      }
      nextExpectedValueIndex = valueIndex + 1;
      const acceptedValue = ownDataValue(values.value, valueIndexName)?.value;
      const valuePath = `${requirementPath}.constraint.values[${valueIndex}]`;
      if (!isRequirementValue(acceptedValue)) {
        findings.push(finding("constraint-value", valuePath, `A constraint value must be a trimmed, non-empty string of at most ${MAX_REQUIREMENT_VALUE_LENGTH} characters without control characters.`));
      } else if (seenValues.has(acceptedValue)) {
        findings.push(finding("duplicate-constraint-value", valuePath, "Constraint values must be unique."));
      } else {
        seenValues.add(acceptedValue);
      }
    }
    if (!reportedValueHole && nextExpectedValueIndex < values.length) {
      findings.push(finding("constraint-value", `${requirementPath}.constraint.values[${nextExpectedValueIndex}]`, "values must not contain empty slots."));
    }
  }
  if (!reportedHole && nextExpectedIndex < requirements.length) {
    findings.push(finding("requirement-shape", `requirements[${nextExpectedIndex}]`, "requirements must not contain empty slots."));
  }
  return findings;
}

function validateRepositoryProfileValue(value: unknown): RepositoryProfileFinding[] {
  if (!isRecord(value)) return [finding("profile-shape", "$", "A repository profile must be an object.")];

  const findings: RepositoryProfileFinding[] = [];
  const schemaVersion = ownDataValue(value, "schemaVersion")?.value;
  const profileKeys = schemaVersion === LEGACY_REPOSITORY_PROFILE_VERSION
    ? PROFILE_V1_KEYS
    : schemaVersion === PREVIOUS_REPOSITORY_PROFILE_VERSION
      ? PROFILE_V2_KEYS
      : PROFILE_V3_KEYS;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!profileKeys.has(key)) findings.push(finding("unknown-field", key, `Unknown profile field "${key}".`));
  }

  if (schemaVersion !== LEGACY_REPOSITORY_PROFILE_VERSION && schemaVersion !== PREVIOUS_REPOSITORY_PROFILE_VERSION && schemaVersion !== REPOSITORY_PROFILE_VERSION) {
    findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${LEGACY_REPOSITORY_PROFILE_VERSION}, ${PREVIOUS_REPOSITORY_PROFILE_VERSION}, or ${REPOSITORY_PROFILE_VERSION}.`));
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

  if (schemaVersion !== LEGACY_REPOSITORY_PROFILE_VERSION) {
    findings.push(...validateRequirementArray(ownDataValue(value, "requirements")?.value));
  }
  if (schemaVersion !== LEGACY_REPOSITORY_PROFILE_VERSION && schemaVersion !== PREVIOUS_REPOSITORY_PROFILE_VERSION) {
    findings.push(...validateRepositoryRootEntries(ownDataValue(value, "rootEntries")?.value));
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
