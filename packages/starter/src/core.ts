import { ledgerSuccession } from "./ledger.js";
import type { LedgerSuccession } from "./ledger.js";
import { isRegistrySpec, validateNpmIdentity } from "./npm.js";
import { validatePnpmIdentity } from "./pnpm.js";
import type {
  AdmissionEvaluationInput,
  AdmissionReport,
  HeadInstallEvaluationInput,
  HeadInstallIdentity,
  HeadInstallReport,
  HeadInstallRole,
  StarterEvaluationInput,
  StarterFinding,
  StarterReport,
  StarterRequest,
  StarterState,
  InstallReceipt,
  ProcessObservation,
  SnapshotManifest,
  TrustedEvent,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;
/** GitHub API commit OIDs are canonical, lowercase SHA-1 hex strings. */
const GIT_COMMIT_SHA1 = /^[a-f0-9]{40}$/;
/** Snapshot content commitments use canonical lowercase SHA-256 hex strings. */
const SHA256_HEX = /^[a-f0-9]{64}$/;
/** One SHA-512 digest is exactly 64 bytes, canonically encoded as 86 base64 symbols plus ==. */
const SHA512 = /^sha512-([A-Za-z0-9+/]{86})==$/;
const SEMVER_NUMERIC = "(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const VERSION = new RegExp(`^${SEMVER_NUMERIC}\\.${SEMVER_NUMERIC}\\.${SEMVER_NUMERIC}(?:-${SEMVER_PRERELEASE_ID}(?:\\.${SEMVER_PRERELEASE_ID})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const SAFE_NAME = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const SAFE_BIN = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_REQUEST = new Set(["schemaVersion", "phase", "packageManager", "snapshot", "starter", "advisor", "target", "evidence", "hub"]);
const HUB_KEYS = new Set(["owner", "repository", "inventoried"]);
const STARTER_KEYS = new Set(["name", "version", "integrity", "bin"]);
const ADVISOR_KEYS = new Set(["name", "version", "integrity", "bin"]);
const TARGET_KEYS = new Set(["name", "version", "integrity", "bin", "invocation"]);
const SNAPSHOT_KEYS = new Set(["schemaVersion", "provider", "eventName", "repository", "pullRequestNumber", "baseSha", "headSha", "workflowRunId", "artifactName", "digest", "capturedAt", "files"]);
const SNAPSHOT_FILE_KEYS = new Set(["path", "size", "sha256"]);
const TRUSTED_EVENT_KEYS = new Set(["schemaVersion", "provider", "eventName", "repository", "baseSha", "sourceWorkflowRunId", "sourceHeadSha", "artifactName", "sourceConclusion"]);

function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function find(rule: string, message: string): StarterFinding { return { rule, message }; }
function date(value: unknown): number | null { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null; }
function exactKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean { return Object.keys(value).every((key) => allowed.has(key)); }
function stateFromExit(exitCode: number): StarterState | null { return exitCode === 0 ? "satisfied" : exitCode === 1 ? "violated" : exitCode === 2 ? "indeterminate" : null; }
function validGitCommitSha1(value: unknown): value is string { return typeof value === "string" && GIT_COMMIT_SHA1.test(value); }
function validSha256Hex(value: unknown): value is string { return typeof value === "string" && SHA256_HEX.test(value); }
function validSha512Sri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = SHA512.exec(value);
  if (match === null) return false;
  const payload = match[1] as string;
  const bytes = Buffer.from(payload, "base64");
  return bytes.length === 64 && bytes.toString("base64") === `${payload}==`;
}

/** Require normalized portable relative paths before any filesystem adapter resolves them. */
export function isNormalizedRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function exactPackage(value: unknown, label: string, allowed: ReadonlySet<string>, findings: StarterFinding[]): boolean {
  if (!record(value) || !exactKeys(value, allowed)) {
    findings.push(find("package-shape", `${label} must be an exact package identity with no extra command surface.`)); return false;
  }
  if (!SAFE_NAME.test(String(value.name)) || !VERSION.test(String(value.version)) || !validSha512Sri(value.integrity)) {
    findings.push(find("package-identity", `${label} needs a safe scoped package name, exact semver version, and SHA-512 integrity.`)); return false;
  }
  return true;
}

/** Strictly validates the protected-base request; unknown command/path fields are refused. */
export function validateStarterRequest(value: unknown): { request: StarterRequest | null; findings: StarterFinding[] } {
  const findings: StarterFinding[] = [];
  if (!record(value) || !exactKeys(value, ALLOWED_REQUEST)) return { request: null, findings: [find("request-shape", "Starter request is not an exact v1 object; commands, shells, arguments, and CLI paths are not accepted.")] };
  if (value.schemaVersion !== 1 || (value.phase !== "foundation" && value.phase !== "activation" && value.phase !== "admission") || (value.packageManager !== "npm" && value.packageManager !== "pnpm")) {
    findings.push(find("request-shape", "schemaVersion, phase, and packageManager are invalid."));
  }
  if (!record(value.snapshot) || !exactKeys(value.snapshot, new Set(["repository", "maxAgeMs"]))) {
    findings.push(find("snapshot-request-shape", "snapshot request is malformed."));
  } else {
    const snapshot = value.snapshot;
    if (typeof snapshot.repository !== "string" || snapshot.repository.length === 0 || !Number.isSafeInteger(snapshot.maxAgeMs) || Number(snapshot.maxAgeMs) <= 0 || Number(snapshot.maxAgeMs) > 604_800_000) {
      findings.push(find("snapshot-request-identity", "snapshot request needs the fixed consumer repository and a bounded maximum age."));
    }
  }
  if (!exactPackage(value.starter, "starter", STARTER_KEYS, findings) || !record(value.starter) || value.starter.name !== "@clossys/starter" || value.starter.bin !== "foundry-starter") {
    findings.push(find("starter-contract", "starter must be @clossys/starter and its fixed foundry-starter bin."));
  }
  if (!exactPackage(value.advisor, "advisor", ADVISOR_KEYS, findings) || !record(value.advisor) || value.advisor.name !== "@clossys/advisor" || value.advisor.bin !== "advisor-execution-readiness") {
    findings.push(find("advisor-contract", "advisor must be @clossys/advisor and its fixed advisor-execution-readiness bin."));
  }
  if (!exactPackage(value.target, "target", TARGET_KEYS, findings) || !record(value.target) || !SAFE_BIN.test(String(value.target.bin)) || value.target.invocation !== "single-json-input") {
    findings.push(find("target-contract", "target needs one manifest-selected bin and the fixed single-json-input invocation; paths and arbitrary arguments are forbidden."));
  }
  if (!record(value.evidence) || !exactKeys(value.evidence, new Set(["assessment", "targetInput"])) || !isNormalizedRelativePath(value.evidence.assessment) || !isNormalizedRelativePath(value.evidence.targetInput) || value.evidence.assessment === value.evidence.targetInput) {
    findings.push(find("evidence-path", "assessment and targetInput must be distinct normalized relative paths."));
  }
  if (value.hub !== undefined && (!record(value.hub) || !exactKeys(value.hub, HUB_KEYS) || typeof value.hub.owner !== "string" || value.hub.owner.length === 0 || typeof value.hub.repository !== "string" || value.hub.repository.length === 0 || typeof value.hub.inventoried !== "boolean")) {
    findings.push(find("hub-evidence", "hub, when present, must be an exact caller-supplied { owner, repository, inventoried } object; Starter reads it, never fetches it."));
  }
  return { request: findings.length === 0 ? value as unknown as StarterRequest : null, findings };
}

function validateSnapshot(value: unknown, request: StarterRequest, now: string): { snapshot: SnapshotManifest | null; findings: StarterFinding[] } {
  const findings: StarterFinding[] = [];
  if (!record(value) || !exactKeys(value, SNAPSHOT_KEYS) || value.schemaVersion !== 1 || value.provider !== "github-actions" || value.eventName !== "pull_request" || !Array.isArray(value.files) || !Number.isSafeInteger(value.pullRequestNumber) || Number(value.pullRequestNumber) <= 0 || !validGitCommitSha1(value.baseSha) || !validGitCommitSha1(value.headSha) || typeof value.workflowRunId !== "string" || value.workflowRunId.length === 0 || typeof value.artifactName !== "string" || value.artifactName !== `adoption-snapshot-${value.workflowRunId}` || !validSha256Hex(value.digest)) {
    return { snapshot: null, findings: [find("snapshot-shape", "snapshot manifest is unreadable or is not a pull_request GitHub Actions record.")] };
  }
  const joins: Array<[keyof StarterRequest["snapshot"], keyof SnapshotManifest]> = [["repository", "repository"]];
  for (const [left, right] of joins) if (request.snapshot[left] !== value[right]) findings.push(find("snapshot-join", `snapshot ${String(right)} does not match the protected-base request.`));
  const captured = date(value.capturedAt); const at = date(now);
  if (captured === null || at === null || at < captured || at - captured > request.snapshot.maxAgeMs) findings.push(find("snapshot-expired", "snapshot is missing, future-dated, or older than its declared maximum age."));
  const paths = new Map<string, unknown>();
  for (const entry of value.files) {
    if (!record(entry) || !exactKeys(entry, SNAPSHOT_FILE_KEYS) || !isNormalizedRelativePath(entry.path) || !Number.isSafeInteger(entry.size) || Number(entry.size) < 0 || Number(entry.size) > 524_288 || !validSha256Hex(entry.sha256) || paths.has(entry.path)) findings.push(find("snapshot-file", "every snapshot file must have one normalized path, bounded size, and SHA-256 digest."));
    else paths.set(entry.path, entry);
  }
  for (const path of [request.evidence.assessment, request.evidence.targetInput]) if (!paths.has(path)) findings.push(find("snapshot-evidence-missing", `snapshot did not capture required ${path}.`));
  return { snapshot: findings.length === 0 ? value as unknown as SnapshotManifest : null, findings };
}

function validateTrustedEvent(value: unknown, request: StarterRequest, snapshot: SnapshotManifest): StarterFinding[] {
  if (!record(value) || !exactKeys(value, TRUSTED_EVENT_KEYS) || value.schemaVersion !== 1 || value.provider !== "github-actions" || value.eventName !== "workflow_run" || !validGitCommitSha1(value.baseSha) || !validGitCommitSha1(value.sourceHeadSha)) return [find("trusted-event-shape", "trusted event is unreadable or is not a GitHub workflow_run record with canonical Git commit OIDs.")];
  const event = value as unknown as TrustedEvent;
  const findings: StarterFinding[] = [];
  if (event.repository !== request.snapshot.repository || event.sourceWorkflowRunId !== snapshot.workflowRunId || event.sourceHeadSha !== snapshot.headSha || event.baseSha !== snapshot.baseSha || event.artifactName !== snapshot.artifactName) {
    findings.push(find("trusted-event-join", "trusted event does not join the protected repository, base, source run, head, and snapshot artifact."));
  }
  if (event.repository !== snapshot.repository || event.sourceWorkflowRunId !== snapshot.workflowRunId || event.sourceHeadSha !== snapshot.headSha || event.artifactName !== snapshot.artifactName) findings.push(find("snapshot-event-join", "trusted event does not join the downloaded pull-request snapshot."));
  if (event.sourceConclusion !== "success") findings.push(find("source-workflow-not-successful", "the pull-request evidence workflow did not complete successfully; this is indeterminate, never a skipped green."));
  return findings;
}

function validateInstall(value: unknown, request: StarterRequest): { install: InstallReceipt | null; findings: StarterFinding[] } {
  if (!record(value) || !exactKeys(value, new Set(["schemaVersion", "packageManager", "attempted", "exitCode"])) || value.schemaVersion !== 1 || value.packageManager !== request.packageManager || typeof value.attempted !== "boolean" || ![0, 1, 2].includes(value.exitCode as number)) {
    return { install: null, findings: [find("install-receipt", "fixed installation receipt is malformed or names the wrong package manager.")] };
  }
  if (!value.attempted) return { install: null, findings: [find("install-skipped", "the fixed install step did not run; skipped installation is indeterminate, never clean.")] };
  return { install: value as unknown as InstallReceipt, findings: [] };
}

/** Validate a raw JSON process report and its 0/1/2 exit code as one fact. */
export function evaluateProcessResult(value: ProcessObservation | undefined, label: string, now?: string): { state: StarterState; findings: StarterFinding[] } {
  if (value?.timedOut === true) return { state: "indeterminate", findings: [find(`${label}-timeout`, `${label} exceeded Starter's fixed execution deadline.`)] };
  if (!value || !value.attempted || value.exitCode === null) return { state: "indeterminate", findings: [find(`${label}-skipped`, `${label} did not run; an omitted phase is indeterminate.`)] };
  if (now !== undefined && value.currentAsOf !== now) return { state: "indeterminate", findings: [find(`${label}-runner-time`, `${label} was not invoked with this runner's current instant.`)] };
  const fromExit = stateFromExit(value.exitCode);
  if (!fromExit) return { state: "indeterminate", findings: [find(`${label}-exit`, `${label} exited outside the 0/1/2 contract.`)] };
  let parsed: unknown;
  try { parsed = JSON.parse(value.stdout); } catch { return { state: "indeterminate", findings: [find(`${label}-output`, `${label} did not emit one readable JSON report.`)] }; }
  if (!record(parsed) || (parsed.state !== "satisfied" && parsed.state !== "violated" && parsed.state !== "indeterminate")) return { state: "indeterminate", findings: [find(`${label}-output`, `${label} report has no canonical state.`)] };
  if (parsed.state !== fromExit) return { state: "indeterminate", findings: [find(`${label}-exit-output`, `${label} JSON state and process exit code disagree.`)] };
  return { state: parsed.state, findings: [] };
}

function report(state: StarterState, phase: StarterRequest["phase"] | null, findings: readonly StarterFinding[], advisor: StarterState | null, target: StarterState | null): StarterReport { return { state, phase, findings, advisor, target }; }

/**
 * Pure decision core. Node adapters collect files, manifests, locks, and raw
 * process output; this function never accepts or executes arbitrary commands.
 */
export function evaluateStarter(input: StarterEvaluationInput): StarterReport {
  const requestResult = validateStarterRequest(input.request);
  if (!requestResult.request) return report("indeterminate", null, requestResult.findings, null, null);
  const request = requestResult.request;
  // Hub evidence is caller-supplied and non-blocking (issue #997): an
  // un-inventoried repository still activates, but the finding rides along in
  // every result so the hub's own reconciliation can see the gap. Absent hub
  // evidence changes nothing.
  const hubFindings: StarterFinding[] =
    request.hub !== undefined && !request.hub.inventoried
      ? [find("not-hub-inventoried", "The caller-supplied hub evidence reports this repository as not hub-inventoried; activation proceeds, and this finding is reported for the hub's own reconciliation.")]
      : [];
  if (request.phase === "admission") {
    return report("indeterminate", request.phase, [find("admission-ledgers", "phase admission compares the protected base ledger with the pull-request ledger."), ...hubFindings], null, null);
  }
  const snapshotResult = validateSnapshot(input.snapshot, request, input.now);
  const findings = [...snapshotResult.findings];
  if (!snapshotResult.snapshot) return report("indeterminate", request.phase, [...findings, ...hubFindings], null, null);
  findings.push(...validateTrustedEvent(input.trustedEvent, request, snapshotResult.snapshot));
  const installResult = validateInstall(input.install, request); findings.push(...installResult.findings);
  if (findings.length > 0) return report("indeterminate", request.phase, [...findings, ...hubFindings], null, null);
  const installState = stateFromExit(installResult.install?.exitCode ?? 2) ?? "indeterminate";
  if (installState !== "satisfied") return report(installState, request.phase, [find("install-result", `Fixed ${request.packageManager} install exited ${installResult.install?.exitCode}.`), ...hubFindings], null, null);
  if (request.phase === "foundation") return report("indeterminate", request.phase, [find("foundation-only", "Foundation installs and records evidence but intentionally makes no activation claim."), ...hubFindings], null, null);
  const advisor = evaluateProcessResult(input.advisor, "advisor", input.now);
  if (advisor.state !== "satisfied") return report(advisor.state, request.phase, [...advisor.findings, ...hubFindings], advisor.state, null);
  const target = evaluateProcessResult(input.target, "target");
  return report(target.state, request.phase, [...target.findings, ...hubFindings], advisor.state, target.state);
}

const HEAD_ROLES: readonly HeadInstallRole[] = ["starter", "advisor", "target"];
function sameIdentity(left: UnknownRecord, right: UnknownRecord): boolean {
  return left.name === right.name && left.version === right.version && left.integrity === right.integrity && left.bin === right.bin && left.invocation === right.invocation;
}
function headReport(state: StarterState, event: TrustedEvent | null, findings: readonly StarterFinding[], changedFromBase: readonly HeadInstallRole[] | null, proved: readonly HeadInstallIdentity[] | null = null): HeadInstallReport {
  return { schemaVersion: 1, kind: "head-install", state, headSha: event?.sourceHeadSha ?? null, baseSha: event?.baseSha ?? null, proved, changedFromBase, findings };
}

/**
 * Pure head-install evaluator (issue #1474). It proves only that the pull
 * request head's own manifest and lockfile, read as data by the trusted base
 * workflow, installed with the fixed npm command and contain the head
 * request's exact identities. It never executes an installed head package and
 * never changes the protected-base `decide` verdict.
 */
export function evaluateHeadInstall(input: HeadInstallEvaluationInput): HeadInstallReport {
  const base = validateStarterRequest(input.request);
  if (!base.request) return headReport("indeterminate", null, [...input.inputFindings, ...base.findings], null);
  const request = base.request;
  const eventValue = input.trustedEvent;
  if (!record(eventValue) || !exactKeys(eventValue, TRUSTED_EVENT_KEYS) || eventValue.schemaVersion !== 1 || eventValue.provider !== "github-actions" || eventValue.eventName !== "workflow_run" || !validGitCommitSha1(eventValue.baseSha) || !validGitCommitSha1(eventValue.sourceHeadSha)) {
    return headReport("indeterminate", null, [...input.inputFindings, find("trusted-event-shape", "trusted event is unreadable or is not a GitHub workflow_run record with canonical Git commit OIDs.")], null);
  }
  const event = eventValue as unknown as TrustedEvent;
  const findings: StarterFinding[] = [...input.inputFindings];
  if (event.repository !== request.snapshot.repository) findings.push(find("trusted-event-join", "trusted event does not name the protected-base request's repository."));
  if (request.packageManager !== "npm") findings.push(find("head-manager-unsupported", "head-install proof supports only the npm caller; the protected-base request names another package manager."));
  if (input.headCommit !== event.sourceHeadSha) findings.push(find("head-commit", "the head checkout does not hold the trusted workflow_run head commit."));
  const head = validateStarterRequest(input.headRequest);
  let changedFromBase: HeadInstallRole[] | null = null;
  if (!head.request) findings.push(...head.findings.map((entry) => find(`head-${entry.rule}`, `pull-request head request: ${entry.message}`)));
  else {
    const headRequest = head.request;
    changedFromBase = HEAD_ROLES.filter((role) => !sameIdentity(request[role] as unknown as UnknownRecord, headRequest[role] as unknown as UnknownRecord));
    if (headRequest.packageManager !== "npm") findings.push(find("head-manager-unsupported", "head-install proof supports only npm; the pull-request head request names another package manager."));
    if (headRequest.snapshot.repository !== request.snapshot.repository) findings.push(find("head-request-join", "the pull-request head request names a different repository from the protected base."));
  }
  if (findings.length > 0) return headReport("indeterminate", event, findings, changedFromBase);
  if (input.sourceViolations.length > 0) return headReport("violated", event, input.sourceViolations, changedFromBase);
  const install = input.install;
  if (install?.timedOut === true) return headReport("indeterminate", event, [find("head-install-timeout", "the fixed head install exceeded Starter's deadline.")], changedFromBase);
  if (install === undefined || !install.attempted || install.exitCode === null) return headReport("indeterminate", event, [find("head-install-not-run", "the fixed head install did not run; an omitted install is indeterminate.")], changedFromBase);
  if (install.exitCode !== 0) return headReport("indeterminate", event, [find("head-install-failed", `the fixed npm ci --ignore-scripts over the pull-request head exited ${install.exitCode}.`)], changedFromBase);
  const identityFindings = input.identityFindings ?? [];
  if (identityFindings.length > 0) return headReport("violated", event, identityFindings, changedFromBase);
  const headRequest = head.request as StarterRequest;
  const proved = HEAD_ROLES.map((role) => ({ role, name: headRequest[role].name, version: headRequest[role].version, integrity: headRequest[role].integrity, bin: headRequest[role].bin }));
  return headReport("satisfied", event, [], changedFromBase, proved);
}

type LedgerPlacement = "dependencies" | "devDependencies";
interface LedgerPackage { readonly name: string; readonly version: string; readonly integrity: string; readonly placement: LedgerPlacement }

function admissionReport(state: StarterState, phase: "admission" | null, findings: readonly StarterFinding[]): AdmissionReport {
  return { schemaVersion: 1, kind: "admission", state, phase, findings };
}

/** Maps a report state to the admission check's exit code: 0 satisfied, 1 violated, 2 indeterminate. */
export function admissionExitCode(report: AdmissionReport): number {
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function successionFindings(succession: LedgerSuccession): StarterFinding[] {
  return succession.violations.map((violation) => find(`ledger-${violation.side ?? "pair"}-${violation.rule}`, violation.message));
}

/** A head the succession reader could not parse. A parsed ledger in another spelling is a mismatch, not this. */
function headDocumentUnreadable(succession: LedgerSuccession): boolean {
  return succession.violations.some((violation) => violation.side === "head" && violation.rule === "bytes" && !violation.message.includes("exact bytes the ledger contract's RENDER"));
}

function ledgerPackages(bytes: Uint8Array): readonly LedgerPackage[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!record(parsed) || !Array.isArray(parsed.packages)) return null;
  const packages: LedgerPackage[] = [];
  for (const row of parsed.packages) {
    if (!record(row) || typeof row.name !== "string" || typeof row.version !== "string" || typeof row.integrity !== "string" || (row.placement !== "dependencies" && row.placement !== "devDependencies")) return null;
    packages.push({ name: row.name, version: row.version, integrity: row.integrity, placement: row.placement });
  }
  return packages;
}

function manifestSpec(manifest: unknown, placement: LedgerPlacement, name: string): unknown {
  if (!record(manifest)) return undefined;
  const section = manifest[placement];
  if (!record(section)) return undefined;
  return section[name];
}

/**
 * Compares the frozen base install with the base ledger's package rows.
 * Each row's manifest spec must pass the registry-spec grammar (`isRegistrySpec`),
 * and its name, version, and integrity must match the lockfile through the same
 * identity check the install proofs use (`validateNpmIdentity` / `validatePnpmIdentity`).
 */
function ledgerInstallFindings(manager: StarterRequest["packageManager"], manifest: unknown, lock: unknown, packages: readonly LedgerPackage[]): StarterFinding[] {
  const findings: StarterFinding[] = [];
  packages.forEach((pkg, index) => {
    const spec = manifestSpec(manifest, pkg.placement, pkg.name);
    if (typeof spec !== "string" || !isRegistrySpec(spec)) findings.push(find("registry-spec", `package.json ${pkg.placement} spec for ledger package #${index + 1} is not a registry spec.`));
    const expected = { name: pkg.name, version: pkg.version, integrity: pkg.integrity };
    const messages = manager === "npm" ? validateNpmIdentity(manifest, lock, expected, pkg.placement) : validatePnpmIdentity(manifest, lock, expected, pkg.placement);
    for (const message of messages) findings.push(find("ledger-install", message));
  });
  return findings;
}

/**
 * Admission check for issue #1492. Calls `ledgerSuccession` on the two ledgers'
 * own bytes, so the comparison is the canonical spelling the succession reader
 * already requires. A proved match is an identical ledger or the admitted next
 * generation. A next generation whose last entry is labeled approved is a
 * refusal; an unchanged ledger is not. An unreadable
 * or absent head ledger is indeterminate. When the ledgers match, the frozen
 * base install must match the base ledger's packages, including integrity.
 */
export function evaluateAdmission(input: AdmissionEvaluationInput): AdmissionReport {
  const parsed = validateStarterRequest(input.request);
  if (!parsed.request) return admissionReport("indeterminate", null, parsed.findings);
  const request = parsed.request;
  const hubFindings: StarterFinding[] = request.hub !== undefined && !request.hub.inventoried
    ? [find("not-hub-inventoried", "The caller-supplied hub evidence reports this repository as not hub-inventoried; activation proceeds, and this finding is reported for the hub's own reconciliation.")]
    : [];
  if (request.phase !== "admission") return admissionReport("indeterminate", null, [find("admission-phase", "the admission check requires phase admission."), ...hubFindings]);
  if (input.headUnreadable === true) return admissionReport("indeterminate", "admission", [find("head-ledger-unreadable", "the pull-request head ledger is not a readable ledger document."), ...hubFindings]);
  if (input.headLedger === null) return admissionReport("indeterminate", "admission", [find("head-ledger-absent", "the pull-request head ledger is absent."), ...hubFindings]);
  if (input.baseUnreadable === true) return admissionReport("indeterminate", "admission", [find("base-ledger-unreadable", "the protected base ledger is not a readable ledger document."), ...hubFindings]);
  const succession = ledgerSuccession(input.baseLedger, input.headLedger);
  if (headDocumentUnreadable(succession)) return admissionReport("indeterminate", "admission", [...successionFindings(succession), ...hubFindings]);
  if (succession.violations.length > 0) return admissionReport("violated", "admission", [...successionFindings(succession), ...hubFindings]);
  if (succession.admission === "approval-claimed") return admissionReport("violated", "admission", [find("approval-claimed", "the pull-request ledger's last generation is labeled approved, so the comparison refuses it."), ...hubFindings]);
  if (succession.change !== "none" && succession.admission !== "admitted") return admissionReport("violated", "admission", [find("ledger-succession", "the pull-request ledger is not the protected base ledger and is not its admitted next generation."), ...hubFindings]);
  if (input.baseLedger === null) return admissionReport("indeterminate", "admission", [find("base-ledger-absent", "the protected base ledger is absent, so its packages cannot be compared with the frozen install."), ...hubFindings]);
  const packages = ledgerPackages(input.baseLedger);
  if (packages === null) return admissionReport("indeterminate", "admission", [find("base-ledger-packages", "the protected base ledger's package rows could not be read."), ...hubFindings]);
  if (input.install === null) return admissionReport("indeterminate", "admission", [find("ledger-install-absent", "the frozen base install could not be read, so it was not compared with the base ledger's packages."), ...hubFindings]);
  const installFindings = ledgerInstallFindings(request.packageManager, input.install.manifest, input.install.lock, packages);
  if (installFindings.length > 0) return admissionReport("violated", "admission", [...installFindings, ...hubFindings]);
  return admissionReport("satisfied", "admission", hubFindings);
}
