import { PACKAGE_LIFECYCLE_VERSION } from "./types.js";
import type { LifecycleFinding, LifecycleFindingRule } from "./types.js";

const DOCUMENT_KEYS = new Set(["schemaVersion", "packages"]);
const ENTRY_KEYS = new Set(["name", "status", "replacement", "noReplacementReason", "deprecatedOn", "decision", "migration"]);
const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const MAX_PACKAGES = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finding(rule: LifecycleFindingRule, path: string, message: string): LifecycleFinding {
  return { rule, severity: "error", path, message };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month as number) - 1 && date.getUTCDate() === day;
}

function ownDataValue(record: Record<string, unknown>, key: string): { readonly present: boolean; readonly value?: unknown; readonly accessor: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false, accessor: false };
  if (!("value" in descriptor)) return { present: true, accessor: true };
  return { present: true, value: descriptor.value, accessor: false };
}

function isDenseArray(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function validSemverRange(value: string): boolean {
  // A deliberately conservative subset of npm semver ranges. It accepts the
  // stable forms used in lifecycle records without accepting arbitrary prose.
  return /^(?:[~^]|>=?|<=?)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\s+(?:-|\|\||[~^]|>=?|<=?)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)*$/.test(value.trim());
}

function sortFindings(findings: LifecycleFinding[]): LifecycleFinding[] {
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule) || left.message.localeCompare(right.message));
}

/**
 * Validates a consumer-owned lifecycle registry without reading a workspace
 * or invoking a command. Completeness against a real catalog is checked by
 * `runGovernanceCheck`, where the catalog is already available.
 */
export function validatePackageLifecycle(value: unknown): LifecycleFinding[] {
  if (!isRecord(value)) return [finding("document-shape", "$", "A lifecycle document must be a plain object.")];

  const findings: LifecycleFinding[] = [];
  for (const key of Object.keys(value)) {
    if (!DOCUMENT_KEYS.has(key)) findings.push(finding("unknown-field", key, `Unknown lifecycle-document field "${key}".`));
  }
  const schemaVersion = ownDataValue(value, "schemaVersion");
  const packagesValue = ownDataValue(value, "packages");
  if (schemaVersion.accessor) findings.push(finding("field-accessor", "schemaVersion", "Lifecycle fields must be own data properties."));
  if (packagesValue.accessor) findings.push(finding("field-accessor", "packages", "Lifecycle fields must be own data properties."));
  if (schemaVersion.value !== PACKAGE_LIFECYCLE_VERSION) {
    findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${PACKAGE_LIFECYCLE_VERSION}.`));
  }
  if (!Array.isArray(packagesValue.value) || packagesValue.value.length === 0 || packagesValue.value.length > MAX_PACKAGES || !isDenseArray(packagesValue.value)) {
    findings.push(finding("packages-shape", "packages", "packages must be a non-empty array."));
    return findings;
  }

  const packages = packagesValue.value;
  const entries = new Map<string, { status: string; path: string }>();
  for (let index = 0; index < packages.length; index++) {
    const entry = packages[index];
    const path = `packages[${index}]`;
    if (!isRecord(entry)) {
      findings.push(finding("entry-shape", path, "A lifecycle package entry must be an object."));
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) findings.push(finding("unknown-field", `${path}.${key}`, `Unknown lifecycle-entry field "${key}".`));
    }
    const nameValue = ownDataValue(entry, "name");
    const statusValue = ownDataValue(entry, "status");
    const replacementValue = ownDataValue(entry, "replacement");
    const noReplacementReasonValue = ownDataValue(entry, "noReplacementReason");
    const deprecatedOnValue = ownDataValue(entry, "deprecatedOn");
    const decisionValue = ownDataValue(entry, "decision");
    const migrationValue = ownDataValue(entry, "migration");
    for (const [key, field] of Object.entries({ name: nameValue, status: statusValue, replacement: replacementValue, noReplacementReason: noReplacementReasonValue, deprecatedOn: deprecatedOnValue, decision: decisionValue, migration: migrationValue })) {
      if (field.accessor) findings.push(finding("field-accessor", `${path}.${key}`, "Lifecycle fields must be own data properties."));
    }
    const name = nameValue.value;
    if (typeof name !== "string" || !PACKAGE_NAME.test(name)) {
      findings.push(finding("package-name", `${path}.name`, "name must be a scoped npm package name."));
      continue;
    }
    if (entries.has(name)) findings.push(finding("duplicate-package", `${path}.name`, `Duplicate lifecycle entry for "${name}".`));
    else entries.set(name, { status: typeof statusValue.value === "string" ? statusValue.value : "", path });

    const deprecated = statusValue.value === "deprecated";
    if (statusValue.value !== "active" && !deprecated) {
      findings.push(finding("status", `${path}.status`, 'status must be "active" or "deprecated".'));
    }
    const replacement = replacementValue.value;
    const noReplacementReason = noReplacementReasonValue.value;
    const deprecatedOn = deprecatedOnValue.value;
    if (deprecated) {
      if (replacementValue.present && noReplacementReasonValue.present) {
        findings.push(finding("replacement-reason", path, "A deprecated package must declare either replacement or noReplacementReason, not both."));
      } else if (!replacementValue.present) {
        if (typeof noReplacementReason !== "string" || noReplacementReason.trim() === "") {
          findings.push(finding("replacement-reason", `${path}.noReplacementReason`, "A deprecated package without a successor needs a non-empty noReplacementReason."));
        }
      } else {
        const replacementName = isRecord(replacement) ? ownDataValue(replacement, "name") : undefined;
        const replacementRange = isRecord(replacement) ? ownDataValue(replacement, "range") : undefined;
        if (replacementName?.accessor) findings.push(finding("field-accessor", `${path}.replacement.name`, "Lifecycle fields must be own data properties."));
        if (replacementRange?.accessor) findings.push(finding("field-accessor", `${path}.replacement.range`, "Lifecycle fields must be own data properties."));
        if (typeof replacementName?.value !== "string" || !PACKAGE_NAME.test(replacementName.value)) {
          findings.push(finding("replacement", `${path}.replacement`, "A deprecated package needs a replacement with a scoped package name."));
        } else if (replacementName.value === name) {
          findings.push(finding("replacement-self", `${path}.replacement`, "A deprecated package cannot replace itself."));
        }
        if (typeof replacementRange?.value !== "string" || !validSemverRange(replacementRange.value)) {
          findings.push(finding("replacement-range", `${path}.replacement.range`, "A deprecated package needs a valid replacement semver range."));
        }
      }
      if (typeof deprecatedOn !== "string" || !validDate(deprecatedOn)) {
        findings.push(finding("deprecated-on", `${path}.deprecatedOn`, "A deprecated package needs a real calendar date in YYYY-MM-DD form."));
      }
      if (typeof decisionValue.value !== "string" || decisionValue.value.trim() === "" || typeof migrationValue.value !== "string" || migrationValue.value.trim() === "") {
        findings.push(finding("evidence", path, "A deprecated package needs non-empty decision and migration evidence references."));
      }
    } else if (replacementValue.present || noReplacementReasonValue.present || deprecatedOnValue.present) {
      findings.push(finding("replacement", path, "Only a deprecated package may declare replacement, noReplacementReason, or deprecatedOn."));
    } else if (decisionValue.present || migrationValue.present) {
      findings.push(finding("evidence", path, "Only a deprecated package may declare decision or migration evidence."));
    }
  }

  for (let index = 0; index < packages.length; index++) {
    const entry = packages[index];
    const replacementValue = isRecord(entry) ? ownDataValue(entry, "replacement").value : undefined;
    const replacementName = isRecord(replacementValue) ? ownDataValue(replacementValue, "name").value : undefined;
    if (!isRecord(entry) || ownDataValue(entry, "status").value !== "deprecated" || typeof replacementName !== "string") continue;
    const replacement = entries.get(replacementName);
    if (!replacement) {
      findings.push(finding("replacement-missing", `packages[${index}].replacement`, `Replacement "${replacementName}" has no lifecycle entry.`));
    } else if (replacement.status !== "active") {
      findings.push(finding("replacement-not-active", `packages[${index}].replacement`, `Replacement "${entry.replacement}" must be active.`));
    }
  }
  return sortFindings(findings);
}

/** Validates that a lifecycle registry names exactly the supplied package names. */
export function evaluateLifecycleCoverage(value: unknown, packageNames: readonly string[]): LifecycleFinding[] {
  const findings = validatePackageLifecycle(value);
  if (!isRecord(value)) return findings;
  const packagesValue = ownDataValue(value, "packages");
  if (!Array.isArray(packagesValue.value) || !isDenseArray(packagesValue.value)) return findings;

  const declared = new Set<string>();
  packagesValue.value.forEach((entry, index) => {
    const name = isRecord(entry) ? ownDataValue(entry, "name").value : undefined;
    const status = isRecord(entry) ? ownDataValue(entry, "status").value : undefined;
    if (typeof name !== "string" || !PACKAGE_NAME.test(name)) return;
    declared.add(name);
    // A deprecated lifecycle entry is durable retirement evidence and may
    // intentionally outlive its workspace package directory.
    if (status !== "deprecated" && !packageNames.includes(name)) {
      findings.push(finding("catalog-package-missing", `packages[${index}].name`, `Lifecycle entry "${name}" is not present in the workspace catalog.`));
    }
  });
  for (const packageName of [...packageNames].sort()) {
    if (!declared.has(packageName)) {
      findings.push(finding("lifecycle-entry-missing", "packages", `Workspace package "${packageName}" has no lifecycle entry.`));
    }
  }
  return sortFindings(findings);
}
