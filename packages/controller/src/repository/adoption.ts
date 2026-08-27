/**
 * One-package repository adoption is intentionally separate from a repository
 * profile. A profile is durable structural context; this module records the
 * evidence-bound transition that may use that context. It performs no I/O,
 * never changes a provider ruleset, and never creates a completion authority.
 */
import { computeDigest } from "../policy/digest.js";
import { gateSatisfied, gateViolated, createGateReasons, type GateResult } from "../gates/result.js";
import { validateRepositoryProfile } from "./validate.js";
import { CANONICAL_REPOSITORY_PROFILE_PATH, REPOSITORY_PROFILE_VERSION } from "./types.js";
import { validateReviewEvidence } from "../review/validate.js";
import { validateCompletionEvidence } from "../positions/completion-evidence.js";
import { isValueSafeReference } from "../internal/reference-safety.js";

export const REPOSITORY_PACKAGE_ADOPTION_VERSION = 1 as const;
export const REPOSITORY_PACKAGE_ADOPTION_COVERAGE = Object.freeze([
  "declaration", "commands", "protected-paths", "requirements", "root-entries",
] as const);
export const REPOSITORY_PACKAGE_ADOPTION_EVENT_KINDS = Object.freeze([
  "foundation", "post-main-canary", "atomic-ruleset-cutover", "activation", "closure",
] as const);

export type RepositoryPackageAdoptionCoverageAxis = (typeof REPOSITORY_PACKAGE_ADOPTION_COVERAGE)[number];
export type RepositoryPackageAdoptionEventKind = (typeof REPOSITORY_PACKAGE_ADOPTION_EVENT_KINDS)[number];
export type RepositoryPackageAdoptionFindingRule =
  | "adoption-shape" | "adoption-unknown-field" | "schema-version" | "id" | "package" | "package-version"
  | "package-integrity" | "stable-profile" | "stable-profile-path" | "stable-profile-hash" | "stable-profile-coverage"
  | "events-shape" | "event-shape" | "event-order" | "event-duplicate" | "event-package-mismatch"
  | "event-head-mismatch" | "event-check-mismatch" | "event-position-mismatch" | "event-cutover-not-atomic"
  | "event-reference" | "profile-schema-invalid" | "profile-version" | "profile-path-mismatch" | "profile-hash-mismatch"
  | "profile-coverage-missing" | "profile-coverage-invalid" | "profile-coverage-violated" | "profile-coverage-indeterminate"
  | "foundation-review-missing" | "foundation-review-invalid" | "foundation-review-stale" | "ruleset-observation-missing"
  | "ruleset-observation-invalid" | "ruleset-observation-mismatch" | "ruleset-not-enforced" | "ruleset-unknown"
  | "activation-incomplete" | "closure-incomplete" | "completion-position-mismatch" | "completion-package-mismatch";

export interface RepositoryPackageAdoptionFinding {
  readonly rule: RepositoryPackageAdoptionFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}

export interface RepositoryPackageAdoptionPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface RepositoryPackageAdoptionStableProfile {
  readonly path: typeof CANONICAL_REPOSITORY_PROFILE_PATH;
  readonly sha256: string;
  readonly requiredCoverage: readonly [
    "declaration", "commands", "protected-paths", "requirements", "root-entries",
  ];
}

export interface RepositoryPackageAdoptionV1 {
  readonly schemaVersion: typeof REPOSITORY_PACKAGE_ADOPTION_VERSION;
  readonly id: string;
  readonly package: RepositoryPackageAdoptionPackage;
  readonly stableProfile: RepositoryPackageAdoptionStableProfile;
  readonly events: readonly RepositoryPackageAdoptionEvent[];
}

export type RepositoryPackageAdoptionEvent =
  | RepositoryPackageAdoptionFoundation
  | RepositoryPackageAdoptionCanary
  | RepositoryPackageAdoptionCutover
  | RepositoryPackageAdoptionActivation
  | RepositoryPackageAdoptionClosure;

export interface RepositoryPackageAdoptionFoundation {
  readonly kind: "foundation";
  readonly candidate: RepositoryPackageAdoptionPackage & { readonly headSha: string; readonly baseSha: string; readonly mainSha: string };
  readonly manifestRef: string;
  readonly lockfileRef: string;
  readonly cleanInstallRef: string;
  readonly reviewRef: string;
}
export interface RepositoryPackageAdoptionCanary {
  readonly kind: "post-main-canary";
  readonly mainSha: string;
  readonly check: string;
  readonly runRef: string;
  readonly completedAt: string;
  readonly verdict: "satisfied";
  /** The five named profile axes evaluated on this exact post-main canary. */
  readonly coverage: readonly { readonly name: RepositoryPackageAdoptionCoverageAxis; readonly verdict: "satisfied"; readonly evaluated: number }[];
}
export interface RepositoryPackageAdoptionCutover {
  readonly kind: "atomic-ruleset-cutover";
  readonly mode: "atomic";
  readonly mainSha: string;
  readonly requiredCheck: string;
  readonly ruleId: string;
  readonly sourceRef: string;
  readonly observedAt: string;
}
export interface RepositoryPackageAdoptionActivation {
  readonly kind: "activation";
  readonly package: RepositoryPackageAdoptionPackage;
  readonly positionId: string;
  readonly invocationRef: string;
  readonly placement: "blocking";
  readonly duplicateRef: string;
  readonly rollbackRef: string;
}
export interface RepositoryPackageAdoptionClosure {
  readonly kind: "closure";
  readonly positionId: string;
  readonly completionEvidenceRef: string;
}

export interface RepositoryPackageAdoptionFoundationReview {
  readonly policy: unknown;
  readonly evidence: unknown;
}
export interface RepositoryPackageAdoptionRulesetObservation {
  readonly state: "enforced" | "not-enforced" | "unknown";
  readonly mainSha: string;
  readonly requiredCheck: string;
  readonly ruleId: string;
  readonly sourceRef: string;
  readonly observedAt: string;
}
export interface RepositoryPackageAdoptionProfileInput {
  readonly value: unknown;
  readonly path: string;
  readonly sha256: string;
}
export interface RepositoryPackageAdoptionCoverageResult {
  readonly name: RepositoryPackageAdoptionCoverageAxis;
  readonly result: GateResult<RepositoryPackageAdoptionFinding, string>;
}
export interface RepositoryPackageAdoptionEvaluationInput {
  readonly adoption: unknown;
  readonly repositoryProfile: RepositoryPackageAdoptionProfileInput;
  readonly stableProfileCoverage: readonly RepositoryPackageAdoptionCoverageResult[];
  readonly foundationReview?: RepositoryPackageAdoptionFoundationReview;
  readonly rulesetObservation?: RepositoryPackageAdoptionRulesetObservation;
  readonly positionLedger?: unknown;
  readonly completionEvidence?: unknown;
}

export const REPOSITORY_PACKAGE_ADOPTION_REASONS = createGateReasons([
  "adoption-invalid", "foundation-missing", "profile-coverage-incomplete", "foundation-review-missing",
  "ruleset-observation-missing", "ruleset-unknown", "activation-incomplete", "closure-incomplete",
] as const);
export type RepositoryPackageAdoptionIndeterminateReason = (typeof REPOSITORY_PACKAGE_ADOPTION_REASONS.reasons)[number];
export type RepositoryPackageAdoptionResult = GateResult<RepositoryPackageAdoptionFinding, RepositoryPackageAdoptionIndeterminateReason>;
export interface RepositoryPackageAdoptionEvaluation {
  readonly result: RepositoryPackageAdoptionResult;
  readonly findings: readonly RepositoryPackageAdoptionFinding[];
  readonly phase: "candidate" | RepositoryPackageAdoptionEventKind;
}

type RecordValue = Record<string, unknown>;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const PACKAGE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const ID = /^[a-z][a-z0-9-]{2,127}$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function safeRecord(value: unknown): value is RecordValue {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => typeof key === "string" && (() => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    })());
  } catch { return false; }
}
function safeArray(value: unknown): value is unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const names = Object.getOwnPropertyNames(value);
    if (!names.every((name) => name === "length" || /^(?:0|[1-9]\d*)$/.test(name))) return false;
    if (value.length > 32 || names.length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return false;
    }
    return true;
  } catch { return false; }
}
function own(value: RecordValue, key: string): unknown { return Object.getOwnPropertyDescriptor(value, key)?.value; }
function exactKeys(value: unknown, fields: readonly string[]): value is RecordValue {
  if (!safeRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && keys.every((key, index) => key === [...fields].sort()[index]);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim() === value && value.length > 0; }
function reference(value: unknown): value is string { return nonempty(value) && isValueSafeReference(value); }
function instant(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}
function finding(findings: RepositoryPackageAdoptionFinding[], rule: RepositoryPackageAdoptionFindingRule, path: string, message: string): void {
  findings.push({ rule, severity: "error", path, message });
}
function packageShape(value: unknown, path: string, findings: RepositoryPackageAdoptionFinding[]): value is RepositoryPackageAdoptionPackage {
  if (!exactKeys(value, ["name", "version", "integrity"])) { finding(findings, "package", path, "must contain exactly name, version, and integrity"); return false; }
  const name = own(value, "name"); const version = own(value, "version"); const integrity = own(value, "integrity");
  if (typeof name !== "string" || !PACKAGE.test(name)) finding(findings, "package", `${path}.name`, "must be a scoped package name");
  if (typeof version !== "string" || !EXACT_SEMVER.test(version)) finding(findings, "package-version", `${path}.version`, "must be one exact semver, never a range or tag");
  if (typeof integrity !== "string" || !SRI.test(integrity)) finding(findings, "package-integrity", `${path}.integrity`, "must be one exact sha256, sha384, or sha512 SRI value");
  return findings.every((entry) => !entry.path.startsWith(path));
}
function samePackage(left: RepositoryPackageAdoptionPackage, right: RepositoryPackageAdoptionPackage): boolean {
  return left.name === right.name && left.version === right.version && left.integrity === right.integrity;
}
function sha(value: unknown): value is string { return typeof value === "string" && SHA.test(value); }
function opaque(value: unknown): value is string { return nonempty(value); }
function profileShape(value: unknown, findings: RepositoryPackageAdoptionFinding[]): value is RepositoryPackageAdoptionStableProfile {
  if (!exactKeys(value, ["path", "sha256", "requiredCoverage"])) { finding(findings, "stable-profile", "stableProfile", "must contain exactly path, sha256, and requiredCoverage"); return false; }
  if (own(value, "path") !== CANONICAL_REPOSITORY_PROFILE_PATH) finding(findings, "stable-profile-path", "stableProfile.path", `must equal ${CANONICAL_REPOSITORY_PROFILE_PATH}`);
  if (!SHA256.test(String(own(value, "sha256") ?? ""))) finding(findings, "stable-profile-hash", "stableProfile.sha256", "must be a lowercase sha256 digest");
  const coverage = own(value, "requiredCoverage");
  if (!safeArray(coverage) || coverage.length !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE.length || coverage.some((axis, index) => axis !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE[index])) {
    finding(findings, "stable-profile-coverage", "stableProfile.requiredCoverage", "must declare the five stable profile axes in canonical order");
  }
  return findings.every((entry) => !entry.path.startsWith("stableProfile"));
}
function eventShape(event: unknown, expected: RepositoryPackageAdoptionEventKind, path: string, topPackage: RepositoryPackageAdoptionPackage | undefined, foundation: RepositoryPackageAdoptionFoundation | undefined, canary: RepositoryPackageAdoptionCanary | undefined, activation: RepositoryPackageAdoptionActivation | undefined, findings: RepositoryPackageAdoptionFinding[]): event is RepositoryPackageAdoptionEvent {
  if (!safeRecord(event) || own(event, "kind") !== expected) { finding(findings, "event-order", path, `must be the next ${expected} event`); return false; }
  if (expected === "foundation") {
    if (!exactKeys(event, ["kind", "candidate", "manifestRef", "lockfileRef", "cleanInstallRef", "reviewRef"])) { finding(findings, "event-shape", path, "foundation has unknown or missing fields"); return false; }
    const candidate = own(event, "candidate");
    if (!exactKeys(candidate, ["name", "version", "integrity", "headSha", "baseSha", "mainSha"])) finding(findings, "event-shape", `${path}.candidate`, "must contain package identity and headSha, baseSha, mainSha");
    else {
      packageShape({ name: own(candidate, "name"), version: own(candidate, "version"), integrity: own(candidate, "integrity") }, `${path}.candidate`, findings);
      for (const key of ["headSha", "baseSha", "mainSha"] as const) if (!sha(own(candidate, key))) finding(findings, "event-head-mismatch", `${path}.candidate.${key}`, "must be an exact 40-character lowercase commit sha");
      if (topPackage && !samePackage(topPackage, candidate as unknown as RepositoryPackageAdoptionPackage)) finding(findings, "event-package-mismatch", `${path}.candidate`, "must exactly match the top-level package identity");
    }
    for (const key of ["manifestRef", "lockfileRef", "cleanInstallRef", "reviewRef"] as const) if (!reference(own(event, key))) finding(findings, "event-reference", `${path}.${key}`, "must be a nonempty safe retained reference");
  } else if (expected === "post-main-canary") {
    if (!exactKeys(event, ["kind", "mainSha", "check", "runRef", "completedAt", "verdict", "coverage"])) { finding(findings, "event-shape", path, "canary has unknown or missing fields"); return false; }
    if (!sha(own(event, "mainSha")) || own(event, "mainSha") !== foundation?.candidate.mainSha) finding(findings, "event-head-mismatch", `${path}.mainSha`, "must equal foundation candidate mainSha");
    if (!opaque(own(event, "check"))) finding(findings, "event-check-mismatch", `${path}.check`, "must be a nonempty required check name");
    if (!reference(own(event, "runRef"))) finding(findings, "event-reference", `${path}.runRef`, "must be a nonempty safe run reference");
    if (!instant(own(event, "completedAt"))) finding(findings, "event-shape", `${path}.completedAt`, "must be an RFC3339 completion instant");
    if (own(event, "verdict") !== "satisfied") finding(findings, "event-shape", `${path}.verdict`, "must record a successful canary");
    const coverage = own(event, "coverage");
    if (!safeArray(coverage) || coverage.length !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE.length || coverage.some((entry, index) => !exactKeys(entry, ["name", "verdict", "evaluated"]) || own(entry, "name") !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE[index] || own(entry, "verdict") !== "satisfied" || !Number.isInteger(own(entry, "evaluated")) || Number(own(entry, "evaluated")) < 1)) {
      finding(findings, "stable-profile-coverage", `${path}.coverage`, "must retain every stable profile axis as a positive evaluated satisfied result in canonical order");
    }
  } else if (expected === "atomic-ruleset-cutover") {
    if (!exactKeys(event, ["kind", "mode", "mainSha", "requiredCheck", "ruleId", "sourceRef", "observedAt"])) { finding(findings, "event-shape", path, "cutover has unknown or missing fields"); return false; }
    if (own(event, "mode") !== "atomic") finding(findings, "event-cutover-not-atomic", `${path}.mode`, "must be atomic");
    if (!sha(own(event, "mainSha")) || own(event, "mainSha") !== foundation?.candidate.mainSha) finding(findings, "event-head-mismatch", `${path}.mainSha`, "must equal foundation candidate mainSha");
    if (!opaque(own(event, "requiredCheck")) || own(event, "requiredCheck") !== canary?.check) finding(findings, "event-check-mismatch", `${path}.requiredCheck`, "must equal the successful canary check");
    if (!opaque(own(event, "ruleId"))) finding(findings, "event-shape", `${path}.ruleId`, "must be a nonempty provider-neutral rule identity");
    if (!reference(own(event, "sourceRef"))) finding(findings, "event-reference", `${path}.sourceRef`, "must be a nonempty safe ruleset reference");
    if (!instant(own(event, "observedAt"))) finding(findings, "event-shape", `${path}.observedAt`, "must be an RFC3339 observation instant");
  } else if (expected === "activation") {
    if (!exactKeys(event, ["kind", "package", "positionId", "invocationRef", "placement", "duplicateRef", "rollbackRef"])) { finding(findings, "event-shape", path, "activation has unknown or missing fields"); return false; }
    const packageValue = own(event, "package"); packageShape(packageValue, `${path}.package`, findings);
    if (topPackage && safeRecord(packageValue) && !samePackage(topPackage, packageValue as unknown as RepositoryPackageAdoptionPackage)) finding(findings, "event-package-mismatch", `${path}.package`, "must exactly match the top-level package identity");
    if (!opaque(own(event, "positionId"))) finding(findings, "event-position-mismatch", `${path}.positionId`, "must be a nonempty consumer position id");
    if (own(event, "placement") !== "blocking") finding(findings, "activation-incomplete", `${path}.placement`, "must be blocking");
    for (const key of ["invocationRef", "duplicateRef", "rollbackRef"] as const) if (!reference(own(event, key))) finding(findings, "event-reference", `${path}.${key}`, "must be a nonempty safe retained reference");
  } else {
    if (!exactKeys(event, ["kind", "positionId", "completionEvidenceRef"])) { finding(findings, "event-shape", path, "closure has unknown or missing fields"); return false; }
    if (!opaque(own(event, "positionId")) || own(event, "positionId") !== activation?.positionId) finding(findings, "event-position-mismatch", `${path}.positionId`, "must exactly match the activated position");
    if (!reference(own(event, "completionEvidenceRef"))) finding(findings, "event-reference", `${path}.completionEvidenceRef`, "must be a nonempty safe completion-evidence reference");
  }
  return true;
}

/** Strict structural validation. A valid record may be an intentionally open prefix. */
export function validateRepositoryPackageAdoption(value: unknown): readonly RepositoryPackageAdoptionFinding[] {
  const findings: RepositoryPackageAdoptionFinding[] = [];
  try {
    if (!exactKeys(value, ["schemaVersion", "id", "package", "stableProfile", "events"])) { finding(findings, "adoption-shape", "$", "must contain exactly schemaVersion, id, package, stableProfile, and events"); return findings; }
    if (own(value, "schemaVersion") !== REPOSITORY_PACKAGE_ADOPTION_VERSION) finding(findings, "schema-version", "schemaVersion", "must equal 1");
    if (!ID.test(String(own(value, "id") ?? ""))) finding(findings, "id", "id", "must be a stable lowercase hyphenated identifier");
    const packageValue = own(value, "package"); const packageValid = packageShape(packageValue, "package", findings);
    profileShape(own(value, "stableProfile"), findings);
    const events = own(value, "events");
    if (!safeArray(events) || events.length > REPOSITORY_PACKAGE_ADOPTION_EVENT_KINDS.length) { finding(findings, "events-shape", "events", "must be a dense event prefix of at most five entries"); return findings; }
    let foundation: RepositoryPackageAdoptionFoundation | undefined;
    let canary: RepositoryPackageAdoptionCanary | undefined;
    let activation: RepositoryPackageAdoptionActivation | undefined;
    for (let index = 0; index < events.length; index += 1) {
      const expected = REPOSITORY_PACKAGE_ADOPTION_EVENT_KINDS[index]!;
      eventShape(events[index], expected, `events[${index}]`, packageValid ? packageValue as RepositoryPackageAdoptionPackage : undefined, foundation, canary, activation, findings);
      if (expected === "foundation") foundation = events[index] as RepositoryPackageAdoptionFoundation;
      if (expected === "post-main-canary") canary = events[index] as RepositoryPackageAdoptionCanary;
      if (expected === "activation") activation = events[index] as RepositoryPackageAdoptionActivation;
    }
  } catch { finding(findings, "adoption-shape", "$", "must be safely readable plain data with no accessors, hostile prototype, or sparse arrays"); }
  return findings;
}

function canonicalJson(value: unknown): string | undefined {
  try {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined;
    if (safeArray(value)) {
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) { const item = canonicalJson(Object.getOwnPropertyDescriptor(value, String(index))?.value); if (item === undefined) return undefined; values.push(item); }
      return `[${values.join(",")}]`;
    }
    if (safeRecord(value)) {
      const parts: string[] = [];
      for (const key of Object.keys(value).sort()) { const item = canonicalJson(own(value, key)); if (item === undefined) return undefined; parts.push(`${JSON.stringify(key)}:${item}`); }
      return `{${parts.join(",")}}`;
    }
  } catch { /* fail closed below */ }
  return undefined;
}
function phase(adoption: RepositoryPackageAdoptionV1): RepositoryPackageAdoptionEvaluation["phase"] { return adoption.events.length === 0 ? "candidate" : adoption.events[adoption.events.length - 1]!.kind; }
function coverageResult(value: unknown): GateResult<RepositoryPackageAdoptionFinding, string> | undefined {
  if (!safeRecord(value)) return undefined;
  if (own(value, "verdict") === "satisfied" && Object.keys(value).length === 2 && Number.isInteger(own(value, "evaluated")) && Number(own(value, "evaluated")) > 0) return { verdict: "satisfied", evaluated: Number(own(value, "evaluated")) };
  if (own(value, "verdict") === "violated" && Object.keys(value).length === 2 && safeArray(own(value, "findings")) && (own(value, "findings") as unknown[]).length > 0) return { verdict: "violated", findings: own(value, "findings") as RepositoryPackageAdoptionFinding[] };
  if (own(value, "verdict") === "indeterminate" && (Object.keys(value).length === 2 || Object.keys(value).length === 3) && nonempty(own(value, "reason"))) return { verdict: "indeterminate", reason: String(own(value, "reason")), ...(nonempty(own(value, "detail")) ? { detail: String(own(value, "detail")) } : {}) };
  return undefined;
}
function observationShape(value: unknown): value is RepositoryPackageAdoptionRulesetObservation {
  return exactKeys(value, ["state", "mainSha", "requiredCheck", "ruleId", "sourceRef", "observedAt"])
    && (own(value, "state") === "enforced" || own(value, "state") === "not-enforced" || own(value, "state") === "unknown")
    && sha(own(value, "mainSha")) && opaque(own(value, "requiredCheck")) && opaque(own(value, "ruleId")) && reference(own(value, "sourceRef")) && instant(own(value, "observedAt"));
}

/**
 * Evaluates only caller-supplied evidence. Missing evidence remains
 * indeterminate; a known enforcement mismatch is violated. No branch,
 * provider, package manager, or completion authority is contacted here.
 */
export function evaluateRepositoryPackageAdoption(input: RepositoryPackageAdoptionEvaluationInput): RepositoryPackageAdoptionEvaluation {
  const suppliedInput = safeRecord(input as unknown) ? input as unknown as RecordValue : undefined;
  if (!suppliedInput) {
    const unreadable: RepositoryPackageAdoptionFinding[] = [{ rule: "adoption-shape", severity: "error", path: "$input", message: "evaluation input must be safely readable plain data" }];
    return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("adoption-invalid", "The evaluation input is not safely readable."), findings: unreadable, phase: "candidate" };
  }
  const rawAdoptionValue = own(suppliedInput, "adoption");
  const structural = validateRepositoryPackageAdoption(rawAdoptionValue);
  const rawAdoption = safeRecord(rawAdoptionValue) ? rawAdoptionValue : undefined;
  const rawEvents = rawAdoption === undefined ? undefined : own(rawAdoption, "events");
  const initialPhase = safeArray(rawEvents) && rawEvents.length > 0
    ? (safeRecord(rawEvents[rawEvents.length - 1]) ? String(own(rawEvents[rawEvents.length - 1] as RecordValue, "kind")) as RepositoryPackageAdoptionEvaluation["phase"] : "candidate") : "candidate";
  if (structural.length > 0) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("adoption-invalid", "The adoption record does not satisfy the strict v1 schema."), findings: structural, phase: initialPhase };
  const adoption = rawAdoptionValue as RepositoryPackageAdoptionV1;
  const findings: RepositoryPackageAdoptionFinding[] = [];
  const profile = own(suppliedInput, "repositoryProfile");
  if (!safeRecord(profile) || !exactKeys(profile, ["value", "path", "sha256"])) {
    finding(findings, "profile-schema-invalid", "repositoryProfile", "must contain value, path, and sha256");
  } else {
    const profileValue = own(profile, "value");
    const profilePath = own(profile, "path");
    const profileHash = own(profile, "sha256");
    const profileFindings = validateRepositoryProfile(profileValue);
    if (profileFindings.length > 0) finding(findings, "profile-schema-invalid", "repositoryProfile.value", "must validate as a repository profile before coverage is read");
    else if (!safeRecord(profileValue) || own(profileValue, "schemaVersion") !== REPOSITORY_PROFILE_VERSION) finding(findings, "profile-version", "repositoryProfile.value.schemaVersion", "adoption requires stable repository profile v3");
    if (profilePath !== adoption.stableProfile.path) finding(findings, "profile-path-mismatch", "repositoryProfile.path", "must exactly match the adopted canonical stable profile path");
    const canonical = canonicalJson(profileValue);
    const computed = canonical === undefined ? undefined : computeDigest(canonical, "sha256");
    if (typeof profileHash !== "string" || !SHA256.test(profileHash) || computed === undefined || profileHash !== computed || profileHash !== adoption.stableProfile.sha256) finding(findings, "profile-hash-mismatch", "repositoryProfile.sha256", "must exactly equal the canonical profile content hash committed by adoption");
  }
  const suppliedCoverage = own(suppliedInput, "stableProfileCoverage");
  const seen = new Set<string>();
  if (!safeArray(suppliedCoverage) || suppliedCoverage.length !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE.length) finding(findings, "profile-coverage-missing", "stableProfileCoverage", "must contain every required stable profile coverage axis exactly once");
  else {
    for (const [index, coverage] of suppliedCoverage.entries()) {
      if (!safeRecord(coverage) || own(coverage, "name") !== REPOSITORY_PACKAGE_ADOPTION_COVERAGE[index] || seen.has(String(own(coverage, "name")))) { finding(findings, "profile-coverage-missing", `stableProfileCoverage[${index}]`, "must be in canonical five-axis order with no duplicates"); continue; }
      seen.add(String(own(coverage, "name")));
      const result = coverageResult(own(coverage, "result"));
      if (!result) finding(findings, "profile-coverage-invalid", `stableProfileCoverage[${index}].result`, "must be a strict GateResult");
      else if (result.verdict === "violated") finding(findings, "profile-coverage-violated", `stableProfileCoverage[${index}]`, `the ${String(own(coverage, "name"))} axis is violated`);
      else if (result.verdict === "indeterminate") finding(findings, "profile-coverage-indeterminate", `stableProfileCoverage[${index}]`, `the ${String(own(coverage, "name"))} axis is indeterminate`);
    }
  }
  const baseIndeterminate = findings.some((entry) => ["profile-schema-invalid", "profile-version", "profile-coverage-missing", "profile-coverage-invalid", "profile-coverage-indeterminate"].includes(entry.rule));
  if (baseIndeterminate) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("profile-coverage-incomplete", "The stable profile was not completely and conclusively covered."), findings, phase: phase(adoption) };
  if (findings.length > 0) return { result: gateViolated(findings), findings, phase: phase(adoption) };
  const foundation = adoption.events[0] as RepositoryPackageAdoptionFoundation | undefined;
  if (!foundation) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("foundation-missing", "Candidate-only planning is not an adoption or cutover."), findings, phase: "candidate" };
  const foundationReview = own(suppliedInput, "foundationReview");
  if (!foundationReview || !safeRecord(foundationReview) || !exactKeys(foundationReview, ["policy", "evidence"])) {
    return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("foundation-review-missing", "Foundation requires caller-supplied exact-head review policy and evidence."), findings, phase: phase(adoption) };
  }
  const reviewEvidence = own(foundationReview, "evidence");
  const reviewFindings = validateReviewEvidence(reviewEvidence, own(foundationReview, "policy"));
  if (reviewFindings.length > 0 || !safeRecord(reviewEvidence) || own(reviewEvidence, "headSha") !== foundation.candidate.headSha || own(reviewEvidence, "baseSha") !== foundation.candidate.baseSha) {
    finding(findings, reviewFindings.length > 0 ? "foundation-review-invalid" : "foundation-review-stale", "foundation.review", reviewFindings.length > 0 ? "the reused review validator did not clear foundation evidence" : "review evidence must exactly match the foundation candidate head and base");
    return { result: gateViolated(findings), findings, phase: phase(adoption) };
  }
  const cutover = adoption.events[2] as RepositoryPackageAdoptionCutover | undefined;
  if (!cutover) return { result: gateSatisfied(1), findings, phase: phase(adoption) };
  const rulesetObservation = own(suppliedInput, "rulesetObservation");
  if (!observationShape(rulesetObservation)) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("ruleset-observation-missing", "Atomic cutover needs a complete provider-neutral ruleset observation."), findings, phase: phase(adoption) };
  const observation = rulesetObservation;
  if (observation.state === "unknown") return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("ruleset-unknown", "The provider-neutral ruleset observation is unknown."), findings, phase: phase(adoption) };
  if (observation.state === "not-enforced") { finding(findings, "ruleset-not-enforced", "rulesetObservation.state", "the required check is known not to be enforced"); return { result: gateViolated(findings), findings, phase: phase(adoption) }; }
  if (observation.mainSha !== cutover.mainSha || observation.requiredCheck !== cutover.requiredCheck || observation.ruleId !== cutover.ruleId || observation.sourceRef !== cutover.sourceRef || observation.observedAt !== cutover.observedAt) {
    finding(findings, "ruleset-observation-mismatch", "rulesetObservation", "must exactly join the recorded atomic cutover's main SHA, check, rule, source, and observed instant");
    return { result: gateViolated(findings), findings, phase: phase(adoption) };
  }
  const activation = adoption.events[3] as RepositoryPackageAdoptionActivation | undefined;
  if (!activation) return { result: gateSatisfied(1), findings, phase: phase(adoption) };
  const closure = adoption.events[4] as RepositoryPackageAdoptionClosure | undefined;
  if (!closure) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("activation-incomplete", "Activation is open until its separately retained closure evidence exists."), findings, phase: phase(adoption) };
  const positionLedger = own(suppliedInput, "positionLedger");
  const completionEvidence = own(suppliedInput, "completionEvidence");
  if (positionLedger === undefined || completionEvidence === undefined) return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("closure-incomplete", "Closure needs consumer ledger and completion evidence supplied to the existing validator."), findings, phase: phase(adoption) };
  const completion = validateCompletionEvidence(completionEvidence, positionLedger);
  if (completion.positionId !== closure.positionId || completion.positionId !== activation.positionId) finding(findings, "completion-position-mismatch", "completionEvidence.positionId", "must exactly join the activated and closed position");
  if (completion.package !== adoption.package.name) finding(findings, "completion-package-mismatch", "completionEvidence.package", "must exactly join the adopted package name");
  if (findings.length > 0) return { result: gateViolated(findings), findings, phase: phase(adoption) };
  if (completion.result.verdict === "satisfied") return { result: gateSatisfied(1), findings, phase: "closure" };
  if (completion.result.verdict === "violated") return { result: gateViolated(completion.findings.map((entry) => ({ rule: "closure-incomplete" as const, severity: "error" as const, path: entry.path, message: entry.message }))), findings: completion.findings.map((entry) => ({ rule: "closure-incomplete" as const, severity: "error" as const, path: entry.path, message: entry.message })), phase: "closure" };
  return { result: REPOSITORY_PACKAGE_ADOPTION_REASONS.indeterminate("closure-incomplete", "Existing completion-evidence validation is not yet satisfied."), findings, phase: "closure" };
}

export interface RepositoryPackageAdoptionPlanInput {
  readonly id: string;
  readonly package: RepositoryPackageAdoptionPackage;
  readonly stableProfile: RepositoryPackageAdoptionStableProfile;
}
export interface RepositoryPackageAdoptionPlan {
  readonly adoption: RepositoryPackageAdoptionV1;
  readonly nextPhase: "foundation";
  readonly requiredActions: readonly ["record-foundation-evidence", "run-post-main-canary", "perform-atomic-ruleset-cutover", "activate-consumer-position", "validate-completion-evidence"];
}

/** Returns candidate-only data; it cannot write, install, activate, or close anything. */
export function planRepositoryPackageAdoption(input: RepositoryPackageAdoptionPlanInput): RepositoryPackageAdoptionPlan {
  return {
    adoption: { schemaVersion: 1, id: input.id, package: input.package, stableProfile: input.stableProfile, events: [] },
    nextPhase: "foundation",
    requiredActions: ["record-foundation-evidence", "run-post-main-canary", "perform-atomic-ruleset-cutover", "activate-consumer-position", "validate-completion-evidence"],
  };
}
