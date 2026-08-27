import type {
  BootstrapEvaluationInput,
  BootstrapFinding,
  BootstrapReport,
  BootstrapRequest,
  BootstrapState,
  InstallReceipt,
  ProcessObservation,
  SnapshotManifest,
  TrustedEvent,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;
const SHA = /^[a-f0-9]{64}$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]{80,}={0,2}$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_NAME = /^@vespeneventures\/[a-z0-9][a-z0-9-]*$/;
const SAFE_BIN = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_REQUEST = new Set(["schemaVersion", "phase", "packageManager", "snapshot", "advisor", "target", "evidence"]);

function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function find(rule: string, message: string): BootstrapFinding { return { rule, message }; }
function date(value: unknown): number | null { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null; }
function exactKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean { return Object.keys(value).every((key) => allowed.has(key)); }
function stateFromExit(exitCode: number): BootstrapState | null { return exitCode === 0 ? "satisfied" : exitCode === 1 ? "violated" : exitCode === 2 ? "indeterminate" : null; }

/** Require normalized portable relative paths before any filesystem adapter resolves them. */
export function isNormalizedRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function exactPackage(value: unknown, label: string, findings: BootstrapFinding[]): boolean {
  if (!record(value) || !exactKeys(value, new Set(["name", "version", "integrity", "bin", "invocation"]))) {
    findings.push(find("package-shape", `${label} must be an exact package identity with no extra command surface.`)); return false;
  }
  if (!SAFE_NAME.test(String(value.name)) || !VERSION.test(String(value.version)) || !SHA512.test(String(value.integrity))) {
    findings.push(find("package-identity", `${label} needs a scoped package name, exact semver version, and SHA-512 integrity.`)); return false;
  }
  return true;
}

/** Strictly validates the protected-base request; unknown command/path fields are refused. */
export function validateBootstrapRequest(value: unknown): { request: BootstrapRequest | null; findings: BootstrapFinding[] } {
  const findings: BootstrapFinding[] = [];
  if (!record(value) || !exactKeys(value, ALLOWED_REQUEST)) return { request: null, findings: [find("request-shape", "Bootstrap request is not an exact v1 object; commands, shells, arguments, and CLI paths are not accepted.")] };
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
  if (!exactPackage(value.advisor, "advisor", findings) || !record(value.advisor) || value.advisor.name !== "@vespeneventures/advisor" || value.advisor.bin !== "advisor-execution-readiness") {
    findings.push(find("advisor-contract", "advisor must be @vespeneventures/advisor and its fixed advisor-execution-readiness bin."));
  }
  if (!exactPackage(value.target, "target", findings) || !record(value.target) || !SAFE_BIN.test(String(value.target.bin)) || value.target.invocation !== "single-json-input") {
    findings.push(find("target-contract", "target needs one manifest-selected bin and the fixed single-json-input invocation; paths and arbitrary arguments are forbidden."));
  }
  if (!record(value.evidence) || !exactKeys(value.evidence, new Set(["assessment", "targetInput"])) || !isNormalizedRelativePath(value.evidence.assessment) || !isNormalizedRelativePath(value.evidence.targetInput) || value.evidence.assessment === value.evidence.targetInput) {
    findings.push(find("evidence-path", "assessment and targetInput must be distinct normalized relative paths."));
  }
  return { request: findings.length === 0 ? value as unknown as BootstrapRequest : null, findings };
}

function validateSnapshot(value: unknown, request: BootstrapRequest, now: string): { snapshot: SnapshotManifest | null; findings: BootstrapFinding[] } {
  const findings: BootstrapFinding[] = [];
  if (!record(value) || value.schemaVersion !== 1 || value.provider !== "github-actions" || value.eventName !== "pull_request" || !Array.isArray(value.files) || !Number.isSafeInteger(value.pullRequestNumber) || Number(value.pullRequestNumber) <= 0 || !SHA.test(String(value.baseSha)) || !SHA.test(String(value.headSha)) || typeof value.workflowRunId !== "string" || value.workflowRunId.length === 0 || typeof value.artifactName !== "string" || value.artifactName !== `adoption-snapshot-${value.workflowRunId}` || !SHA.test(String(value.digest))) {
    return { snapshot: null, findings: [find("snapshot-shape", "snapshot manifest is unreadable or is not a pull_request GitHub Actions record.")] };
  }
  const joins: Array<[keyof BootstrapRequest["snapshot"], keyof SnapshotManifest]> = [["repository", "repository"]];
  for (const [left, right] of joins) if (request.snapshot[left] !== value[right]) findings.push(find("snapshot-join", `snapshot ${String(right)} does not match the protected-base request.`));
  const captured = date(value.capturedAt); const at = date(now);
  if (captured === null || at === null || at < captured || at - captured > request.snapshot.maxAgeMs) findings.push(find("snapshot-expired", "snapshot is missing, future-dated, or older than its declared maximum age."));
  const paths = new Map<string, unknown>();
  for (const entry of value.files) {
    if (!record(entry) || !isNormalizedRelativePath(entry.path) || !Number.isSafeInteger(entry.size) || Number(entry.size) < 0 || Number(entry.size) > 524_288 || !SHA.test(String(entry.sha256)) || paths.has(entry.path)) findings.push(find("snapshot-file", "every snapshot file must have one normalized path, bounded size, and SHA-256 digest."));
    else paths.set(entry.path, entry);
  }
  for (const path of [request.evidence.assessment, request.evidence.targetInput]) if (!paths.has(path)) findings.push(find("snapshot-evidence-missing", `snapshot did not capture required ${path}.`));
  return { snapshot: findings.length === 0 ? value as unknown as SnapshotManifest : null, findings };
}

function validateTrustedEvent(value: unknown, request: BootstrapRequest, snapshot: SnapshotManifest): BootstrapFinding[] {
  if (!record(value) || value.schemaVersion !== 1 || value.provider !== "github-actions" || value.eventName !== "workflow_run") return [find("trusted-event-shape", "trusted event is unreadable or is not a GitHub workflow_run record.")];
  const event = value as unknown as TrustedEvent;
  const findings: BootstrapFinding[] = [];
  if (event.repository !== request.snapshot.repository || event.sourceWorkflowRunId !== snapshot.workflowRunId || event.sourceHeadSha !== snapshot.headSha || event.baseSha !== snapshot.baseSha || event.artifactName !== snapshot.artifactName) {
    findings.push(find("trusted-event-join", "trusted event does not join the protected repository, base, source run, head, and snapshot artifact."));
  }
  if (event.repository !== snapshot.repository || event.sourceWorkflowRunId !== snapshot.workflowRunId || event.sourceHeadSha !== snapshot.headSha || event.artifactName !== snapshot.artifactName) findings.push(find("snapshot-event-join", "trusted event does not join the downloaded pull-request snapshot."));
  if (event.sourceConclusion !== "success") findings.push(find("source-workflow-not-successful", "the pull-request evidence workflow did not complete successfully; this is indeterminate, never a skipped green."));
  return findings;
}

function validateInstall(value: unknown, request: BootstrapRequest): { install: InstallReceipt | null; findings: BootstrapFinding[] } {
  if (!record(value) || value.schemaVersion !== 1 || value.packageManager !== request.packageManager || typeof value.attempted !== "boolean" || ![0, 1, 2].includes(value.exitCode as number)) {
    return { install: null, findings: [find("install-receipt", "fixed installation receipt is malformed or names the wrong package manager.")] };
  }
  if (!value.attempted) return { install: null, findings: [find("install-skipped", "the fixed install step did not run; skipped installation is indeterminate, never clean.")] };
  return { install: value as unknown as InstallReceipt, findings: [] };
}

/** Validate a raw JSON process report and its 0/1/2 exit code as one fact. */
export function evaluateProcessResult(value: ProcessObservation | undefined, label: string, now?: string): { state: BootstrapState; findings: BootstrapFinding[] } {
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

function report(state: BootstrapState, phase: BootstrapRequest["phase"] | null, findings: readonly BootstrapFinding[], advisor: BootstrapState | null, target: BootstrapState | null): BootstrapReport { return { state, phase, findings, advisor, target }; }

/**
 * Pure decision core. Node adapters collect files, manifests, locks, and raw
 * process output; this function never accepts or executes arbitrary commands.
 */
export function evaluateBootstrap(input: BootstrapEvaluationInput): BootstrapReport {
  const requestResult = validateBootstrapRequest(input.request);
  if (!requestResult.request) return report("indeterminate", null, requestResult.findings, null, null);
  const request = requestResult.request;
  const snapshotResult = validateSnapshot(input.snapshot, request, input.now);
  const findings = [...snapshotResult.findings];
  if (!snapshotResult.snapshot) return report("indeterminate", request.phase, findings, null, null);
  findings.push(...validateTrustedEvent(input.trustedEvent, request, snapshotResult.snapshot));
  const installResult = validateInstall(input.install, request); findings.push(...installResult.findings);
  if (findings.length > 0) return report("indeterminate", request.phase, findings, null, null);
  if (request.phase === "foundation") return report("indeterminate", request.phase, [find("foundation-only", "Foundation installs and records evidence but intentionally makes no activation claim.")], null, null);
  const installState = stateFromExit(installResult.install?.exitCode ?? 2) ?? "indeterminate";
  if (installState !== "satisfied") return report(installState, request.phase, [find("install-result", `Fixed ${request.packageManager} install exited ${installResult.install?.exitCode}.`)], null, null);
  const advisor = evaluateProcessResult(input.advisor, "advisor", input.now);
  if (advisor.state !== "satisfied") return report(advisor.state, request.phase, advisor.findings, advisor.state, null);
  const target = evaluateProcessResult(input.target, "target");
  return report(target.state, request.phase, target.findings, advisor.state, target.state);
}
