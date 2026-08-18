import { PACKAGE_LIFECYCLE_VERSION } from "./types.js";
import type { LifecycleFinding, LifecycleFindingRule } from "./types.js";

const DOCUMENT_KEYS = new Set(["schemaVersion", "packages"]);
const ENTRY_KEYS = new Set([
  "name",
  "status",
  "replacement",
  "noReplacementReason",
  "deprecatedOn",
  "retiredOn",
  "decision",
  "migration",
  "qualifiedEvidence",
  "adoptedEvidence",
  "forwardsToReplacement",
]);
const PROMOTION_EVIDENCE_KEYS = new Set(["reference", "date"]);
const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const MAX_PACKAGES = 10_000;
const CURRENT_STATUSES = new Set(["active", "incubating", "published", "qualified", "adopted"]);
const TERMINAL_STATUSES = new Set(["deprecated", "retired"]);
const REPLACEMENT_STATUSES = new Set(["active", "published", "qualified", "adopted"]);

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
 * Validates one `qualifiedEvidence`/`adoptedEvidence` object's shape when
 * present. Presence itself (required once status reaches `qualified` or
 * `adopted`) is enforced by the caller, since an absent field and a
 * malformed one are reported with different, more specific messages.
 */
function validatePromotionEvidenceShape(
  value: unknown,
  path: string,
  rule: Extract<LifecycleFindingRule, "qualified-evidence" | "adopted-evidence">,
  findings: LifecycleFinding[],
): void {
  if (!isRecord(value)) {
    findings.push(finding(rule, path, `${path.split(".").pop()} must be an object with a durable reference and a date.`));
    return;
  }
  for (const key of Object.keys(value)) {
    if (!PROMOTION_EVIDENCE_KEYS.has(key)) findings.push(finding("unknown-field", `${path}.${key}`, `Unknown lifecycle-entry field "${key}".`));
  }
  const reference = ownDataValue(value, "reference");
  const date = ownDataValue(value, "date");
  if (reference.accessor) findings.push(finding("field-accessor", `${path}.reference`, "Lifecycle fields must be own data properties."));
  if (date.accessor) findings.push(finding("field-accessor", `${path}.date`, "Lifecycle fields must be own data properties."));
  if (typeof reference.value !== "string" || reference.value.trim() === "") {
    findings.push(finding(rule, `${path}.reference`, "reference must be a non-empty durable citation (a URL or a repo-relative path)."));
  }
  if (typeof date.value !== "string" || !validDate(date.value)) {
    findings.push(finding(rule, `${path}.date`, "date must be a real calendar date in YYYY-MM-DD form."));
  }
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
    const retiredOnValue = ownDataValue(entry, "retiredOn");
    const decisionValue = ownDataValue(entry, "decision");
    const migrationValue = ownDataValue(entry, "migration");
    const qualifiedEvidenceValue = ownDataValue(entry, "qualifiedEvidence");
    const adoptedEvidenceValue = ownDataValue(entry, "adoptedEvidence");
    const forwardsToReplacementValue = ownDataValue(entry, "forwardsToReplacement");
    for (const [key, field] of Object.entries({
      name: nameValue,
      status: statusValue,
      replacement: replacementValue,
      noReplacementReason: noReplacementReasonValue,
      deprecatedOn: deprecatedOnValue,
      retiredOn: retiredOnValue,
      decision: decisionValue,
      migration: migrationValue,
      qualifiedEvidence: qualifiedEvidenceValue,
      adoptedEvidence: adoptedEvidenceValue,
      forwardsToReplacement: forwardsToReplacementValue,
    })) {
      if (field.accessor) findings.push(finding("field-accessor", `${path}.${key}`, "Lifecycle fields must be own data properties."));
    }
    const name = nameValue.value;
    if (typeof name !== "string" || !PACKAGE_NAME.test(name)) {
      findings.push(finding("package-name", `${path}.name`, "name must be a scoped npm package name."));
      continue;
    }
    if (entries.has(name)) findings.push(finding("duplicate-package", `${path}.name`, `Duplicate lifecycle entry for "${name}".`));
    else entries.set(name, { status: typeof statusValue.value === "string" ? statusValue.value : "", path });

    const status = statusValue.value;
    const deprecated = status === "deprecated";
    const retired = status === "retired";
    const terminal = typeof status === "string" && TERMINAL_STATUSES.has(status);
    if (typeof status !== "string" || (!CURRENT_STATUSES.has(status) && !terminal)) {
      findings.push(finding("status", `${path}.status`, 'status must be "active", "incubating", "published", "qualified", "adopted", "deprecated", or "retired".'));
    }
    const replacement = replacementValue.value;
    const noReplacementReason = noReplacementReasonValue.value;
    const deprecatedOn = deprecatedOnValue.value;
    if (terminal) {
      if (replacementValue.present && noReplacementReasonValue.present) {
        findings.push(finding("replacement-reason", path, "A terminal package must declare either replacement or noReplacementReason, not both."));
      } else if (!replacementValue.present) {
        if (typeof noReplacementReason !== "string" || noReplacementReason.trim() === "") {
          findings.push(finding("replacement-reason", `${path}.noReplacementReason`, "A terminal package without a successor needs a non-empty noReplacementReason."));
        }
      } else {
        const replacementName = isRecord(replacement) ? ownDataValue(replacement, "name") : undefined;
        const replacementRange = isRecord(replacement) ? ownDataValue(replacement, "range") : undefined;
        if (replacementName?.accessor) findings.push(finding("field-accessor", `${path}.replacement.name`, "Lifecycle fields must be own data properties."));
        if (replacementRange?.accessor) findings.push(finding("field-accessor", `${path}.replacement.range`, "Lifecycle fields must be own data properties."));
        if (typeof replacementName?.value !== "string" || !PACKAGE_NAME.test(replacementName.value)) {
          findings.push(finding("replacement", `${path}.replacement`, "A terminal package needs a replacement with a scoped package name."));
        } else if (replacementName.value === name) {
          findings.push(finding("replacement-self", `${path}.replacement`, "A terminal package cannot replace itself."));
        }
        if (typeof replacementRange?.value !== "string" || !validSemverRange(replacementRange.value)) {
          findings.push(finding("replacement-range", `${path}.replacement.range`, "A terminal package needs a valid replacement semver range."));
        }
      }
      if (deprecated && (typeof deprecatedOn !== "string" || !validDate(deprecatedOn))) {
        findings.push(finding("deprecated-on", `${path}.deprecatedOn`, "A deprecated package needs a real calendar date in YYYY-MM-DD form."));
      }
      const retiredOn = retiredOnValue.value;
      if (retired && (typeof retiredOn !== "string" || !validDate(retiredOn))) {
        findings.push(finding("retired-on", `${path}.retiredOn`, "A retired package needs a real calendar date in YYYY-MM-DD form."));
      }
      if (typeof decisionValue.value !== "string" || decisionValue.value.trim() === "" || typeof migrationValue.value !== "string" || migrationValue.value.trim() === "") {
        findings.push(finding("evidence", path, "A terminal package needs non-empty decision and migration evidence references."));
      }
    } else if (replacementValue.present || noReplacementReasonValue.present || deprecatedOnValue.present || retiredOnValue.present) {
      findings.push(finding("replacement", path, "Only a deprecated or retired package may declare replacement, noReplacementReason, deprecatedOn, or retiredOn."));
    } else if (decisionValue.present || migrationValue.present) {
      findings.push(finding("evidence", path, "Only a deprecated or retired package may declare decision or migration evidence."));
    }

    // Promotion evidence is independent of the terminal/non-terminal split
    // above: an entry may record it early (before reaching qualified or
    // adopted) or retain it as historical evidence after being deprecated or
    // retired, exactly like deprecatedOn may survive onto a later retiredOn
    // record. Only presence-once-reached is required, not exclusivity.
    if (qualifiedEvidenceValue.present) {
      validatePromotionEvidenceShape(qualifiedEvidenceValue.value, `${path}.qualifiedEvidence`, "qualified-evidence", findings);
    } else if (status === "qualified" || status === "adopted") {
      findings.push(finding("qualified-evidence", `${path}.qualifiedEvidence`, 'A "qualified" or "adopted" package needs qualifiedEvidence citing the owner-defined integration or release proof it passed.'));
    }
    if (adoptedEvidenceValue.present) {
      validatePromotionEvidenceShape(adoptedEvidenceValue.value, `${path}.adoptedEvidence`, "adopted-evidence", findings);
    } else if (status === "adopted") {
      findings.push(finding("adopted-evidence", `${path}.adoptedEvidence`, 'An "adopted" package needs adoptedEvidence citing durable, checkable confirmed consumer use, in addition to qualifiedEvidence.'));
    }

    // forwardsToReplacement is what lets a reader tell "deprecated, still
    // resolves" apart from "deprecated, will not resolve" without following
    // a prose citation out of the machine-readable registry. It only makes
    // sense once a package is at least deprecated; only deprecated makes it
    // required, since a retired package is by definition no longer
    // installable from this workspace and the field would only ever read
    // `false` there.
    if (forwardsToReplacementValue.present && typeof forwardsToReplacementValue.value !== "boolean") {
      findings.push(finding("forwards-to-replacement", `${path}.forwardsToReplacement`, "forwardsToReplacement must be a boolean."));
    } else if (deprecated && !forwardsToReplacementValue.present) {
      findings.push(finding("forwards-to-replacement", `${path}.forwardsToReplacement`, "A deprecated package needs forwardsToReplacement: true if its old import path still resolves to working code, or false for a hard break."));
    } else if (!terminal && forwardsToReplacementValue.present) {
      findings.push(finding("forwards-to-replacement", `${path}.forwardsToReplacement`, "Only a deprecated or retired package may declare forwardsToReplacement."));
    }
  }

  for (let index = 0; index < packages.length; index++) {
    const entry = packages[index];
    const replacementValue = isRecord(entry) ? ownDataValue(entry, "replacement").value : undefined;
    const replacementName = isRecord(replacementValue) ? ownDataValue(replacementValue, "name").value : undefined;
    if (!isRecord(entry) || !TERMINAL_STATUSES.has(String(ownDataValue(entry, "status").value)) || typeof replacementName !== "string") continue;
    const replacement = entries.get(replacementName);
    if (!replacement) {
      findings.push(finding("replacement-missing", `packages[${index}].replacement`, `Replacement "${replacementName}" has no lifecycle entry.`));
    } else if (!REPLACEMENT_STATUSES.has(replacement.status)) {
      findings.push(finding("replacement-not-active", `packages[${index}].replacement`, `Replacement "${replacementName}" must be published, qualified, adopted, or legacy active.`));
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
    // Terminal entries are durable evidence and may intentionally outlive
    // their workspace package directory.
    if (!TERMINAL_STATUSES.has(String(status)) && !packageNames.includes(name)) {
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
