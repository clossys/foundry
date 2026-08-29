import type {
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
const ALLOWED_REQUEST = new Set(["schemaVersion", "phase", "packageManager", "snapshot", "starter", "advisor", "target", "evidence"]);
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
  if (value.schemaVersion !== 1 || (value.phase !== "foundation" && value.phase !== "activation") || (value.packageManager !== "npm" && value.packageManager !== "pnpm")) {
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
  const snapshotResult = validateSnapshot(input.snapshot, request, input.now);
  const findings = [...snapshotResult.findings];
  if (!snapshotResult.snapshot) return report("indeterminate", request.phase, findings, null, null);
  findings.push(...validateTrustedEvent(input.trustedEvent, request, snapshotResult.snapshot));
  const installResult = validateInstall(input.install, request); findings.push(...installResult.findings);
  if (findings.length > 0) return report("indeterminate", request.phase, findings, null, null);
  const installState = stateFromExit(installResult.install?.exitCode ?? 2) ?? "indeterminate";
  if (installState !== "satisfied") return report(installState, request.phase, [find("install-result", `Fixed ${request.packageManager} install exited ${installResult.install?.exitCode}.`)], null, null);
  if (request.phase === "foundation") return report("indeterminate", request.phase, [find("foundation-only", "Foundation installs and records evidence but intentionally makes no activation claim.")], null, null);
  const advisor = evaluateProcessResult(input.advisor, "advisor", input.now);
  if (advisor.state !== "satisfied") return report(advisor.state, request.phase, advisor.findings, advisor.state, null);
  const target = evaluateProcessResult(input.target, "target");
  return report(target.state, request.phase, target.findings, advisor.state, target.state);
}
