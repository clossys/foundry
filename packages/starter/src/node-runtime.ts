import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { NPM_CI_IGNORE_SCRIPTS, validateNpmIdentity } from "./npm.js";
import { PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS, validatePnpmIdentity } from "./pnpm.js";
import { evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
import type { StarterFinding, StarterReport, StarterRequest, ExactPackage, ProcessObservation, SnapshotManifest } from "./types.js";

const MAX_FILE_BYTES = 524_288;
export const PROCESS_TIMEOUT_MS = 5_000;
const CREDENTIAL_ENVIRONMENT_NAMES = ["NODE_AUTH_TOKEN", "NPM_TOKEN", "GH_PACKAGES_TOKEN"] as const;
type UnknownRecord = Record<string, unknown>;
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finding(rule: string, message: string): StarterFinding { return { rule, message }; }
function exitFor(state: StarterReport["state"]): number { return state === "satisfied" ? 0 : state === "violated" ? 1 : 2; }
function contained(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !resolve(candidate).startsWith(`${resolve(root)}${sep}..`)); }

export class StarterInputError extends Error {}

/** Read one bounded, real, non-symlink file contained by a trusted root. */
export function readContainedRegularFile(root: string, path: string, maxBytes = MAX_FILE_BYTES): Buffer {
  if (!isNormalizedRelativePath(path)) throw new StarterInputError(`path "${path}" is not normalized relative`);
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, path);
  if (!contained(realRoot, candidate)) throw new StarterInputError(`path "${path}" escapes its root`);
  const link = lstatSync(candidate);
  if (link.isSymbolicLink() || !link.isFile()) throw new StarterInputError(`path "${path}" is not a regular non-symlink file`);
  const realFile = realpathSync(candidate);
  if (!contained(realRoot, realFile) || !statSync(realFile).isFile()) throw new StarterInputError(`path "${path}" resolves outside its root`);
  const size = statSync(realFile).size;
  if (size > maxBytes) throw new StarterInputError(`path "${path}" exceeds ${maxBytes} bytes`);
  return readFileSync(realFile);
}

function readJsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (cause) { throw new StarterInputError(`cannot read JSON ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

function snapshotFromDirectory(root: string, request: StarterRequest): { snapshot: unknown; evidence: Map<string, Buffer>; findings: StarterFinding[] } {
  const findings: StarterFinding[] = [];
  let snapshot: unknown;
  try { snapshot = JSON.parse(readContainedRegularFile(root, "snapshot.json").toString("utf8")); } catch (cause) { return { snapshot: {}, evidence: new Map(), findings: [finding("snapshot-manifest", cause instanceof Error ? cause.message : String(cause))] }; }
  if (!record(snapshot) || !Array.isArray(snapshot.files)) return { snapshot, evidence: new Map(), findings: [finding("snapshot-shape", "snapshot.json has no file manifest.")] };
  const entries = new Map<string, unknown>();
  for (const entry of snapshot.files) if (record(entry) && typeof entry.path === "string") entries.set(entry.path, entry);
  const evidence = new Map<string, Buffer>();
  for (const path of [request.evidence.assessment, request.evidence.targetInput]) {
    const entry = entries.get(path);
    try {
      const content = readContainedRegularFile(root, path);
      const digest = createHash("sha256").update(content).digest("hex");
      if (!record(entry) || entry.size !== content.length || entry.sha256 !== digest) findings.push(finding("snapshot-content", `captured ${path} does not match its size and SHA-256 manifest.`));
      else evidence.set(path, content);
    } catch (cause) { findings.push(finding("snapshot-containment", cause instanceof Error ? cause.message : String(cause))); }
  }
  return { snapshot, evidence, findings };
}

/** Derive a binary path only from the exact installed manifest's bin map. */
export function resolveInstalledBin(root: string, expected: ExactPackage & { readonly bin: string }): string {
  const nodeModules = resolve(root, "node_modules");
  const packagePath = resolve(nodeModules, expected.name);
  if (!contained(nodeModules, packagePath) || !existsSync(packagePath)) throw new StarterInputError(`installed ${expected.name} is absent`);
  const packageRoot = realpathSync(packagePath);
  if (!contained(realpathSync(nodeModules), packageRoot)) throw new StarterInputError(`installed ${expected.name} resolves outside node_modules`);
  const manifestPath = resolve(packageRoot, "package.json");
  if (!contained(packageRoot, manifestPath) || lstatSync(manifestPath).isSymbolicLink() || !statSync(manifestPath).isFile()) throw new StarterInputError(`installed ${expected.name} manifest is not a regular file`);
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { throw new StarterInputError(`installed ${expected.name} manifest is unreadable JSON`); }
  if (!record(manifest) || manifest.name !== expected.name || manifest.version !== expected.version || !record(manifest.bin) || typeof manifest.bin[expected.bin] !== "string") throw new StarterInputError(`installed ${expected.name} manifest does not match the expected identity and bin`);
  const bin = manifest.bin[expected.bin] as string;
  if (!isNormalizedRelativePath(bin.replace(/^\.\//, "")) || bin.includes("..")) throw new StarterInputError(`installed ${expected.name} bin escapes its manifest root`);
  const candidate = resolve(packageRoot, bin);
  if (!contained(packageRoot, candidate) || lstatSync(candidate).isSymbolicLink() || !statSync(candidate).isFile()) throw new StarterInputError(`installed ${expected.name} bin is not a regular contained file`);
  const realBin = realpathSync(candidate);
  if (!contained(packageRoot, realBin)) throw new StarterInputError(`installed ${expected.name} bin resolves outside its package`);
  return realBin;
}

function validateInstalledIdentity(root: string, request: StarterRequest): StarterFinding[] {
  let manifest: unknown; let lock: unknown;
  try { manifest = readJsonFile(resolve(root, "package.json")); } catch (cause) { return [finding("root-manifest", cause instanceof Error ? cause.message : String(cause))]; }
  try {
    if (request.packageManager === "npm") lock = readJsonFile(resolve(root, NPM_CI_IGNORE_SCRIPTS.lockPath));
    else lock = readFileSync(resolve(root, PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS.lockPath), "utf8");
  } catch (cause) { return [finding("lockfile", cause instanceof Error ? cause.message : String(cause))]; }
  const validate = request.packageManager === "npm" ? validateNpmIdentity : validatePnpmIdentity;
  const findings = [request.starter, request.advisor, request.target].flatMap((expected) => validate(manifest, lock, expected)).map((message) => finding("exact-install-identity", message));
  for (const expected of [request.starter, request.advisor, request.target]) {
    try { resolveInstalledBin(root, expected); } catch (cause) { findings.push(finding("installed-bin", cause instanceof Error ? cause.message : String(cause))); }
  }
  return findings;
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const name of CREDENTIAL_ENVIRONMENT_NAMES) delete clean[name];
  return clean;
}
function credentialFindings(): StarterFinding[] {
  return CREDENTIAL_ENVIRONMENT_NAMES.filter((name) => typeof process.env[name] === "string" && process.env[name] !== "").map((name) => finding("decision-credential", `${name} is present in a decisive CLI step; credentials belong only to the fixed install step.`));
}
export function runNode(bin: string, args: readonly string[], currentAsOf?: string, timeout = PROCESS_TIMEOUT_MS): ProcessObservation {
  const child = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", maxBuffer: 1_048_576, shell: false, env: sanitizedEnvironment(), timeout, killSignal: "SIGKILL" });
  const timedOut = (child.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { attempted: child.error === undefined || timedOut, exitCode: child.status, stdout: child.stdout ?? "", timedOut, currentAsOf };
}
function advisorPlanBindsTarget(stdout: string, target: ExactPackage & { readonly bin: string; readonly invocation: string }, repository: string): { state: "violated" | "indeterminate"; findings: StarterFinding[] } | null {
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return { state: "indeterminate", findings: [finding("advisor-output", "Advisor did not produce a readable report.")] }; }
  const plan = record(raw) && record(raw.assessment) && record(raw.assessment.firstWavePlan) ? raw.assessment.firstWavePlan : null;
  const workItems = plan !== null && Array.isArray(plan.workItems) ? plan.workItems : null;
  if (plan === null || workItems === null) return { state: "indeterminate", findings: [finding("advisor-plan", "Advisor report has no readable evidence-derived firstWavePlan.workItems.")] };
  if (plan.state !== "ready-for-sponsor-approval") return { state: "indeterminate", findings: [finding("advisor-plan-state", "Advisor reported ready execution without a readable ready-for-sponsor-approval plan.")] };
  if (workItems.some((item) => !record(item) || !record(item.package) || typeof item.targetRepositoryId !== "string" || typeof item.bin !== "string" || typeof item.invocation !== "string")) {
    return { state: "indeterminate", findings: [finding("advisor-plan", "Advisor plan contains an unreadable work-item authorization.")] };
  }
  const samePackage = workItems.filter((item) => record(item) && record(item.package) && item.package.name === target.name && item.package.version === target.version && item.package.integrity === target.integrity);
  const matches = samePackage.some((item) => item.targetRepositoryId === repository && item.bin === target.bin && item.invocation === target.invocation);
  if (matches) return null;
  if (samePackage.length === 0) return { state: "violated", findings: [finding("advisor-target-identity", "Advisor's runner-time first-wave plan does not authorize this exact target package identity.")] };
  const wrongRepository = samePackage.every((item) => item.targetRepositoryId !== repository);
  if (wrongRepository) return { state: "violated", findings: [finding("advisor-target-repository", "Advisor authorizes this target only for a different repository; cross-repository replay is refused.")] };
  const rightRepository = samePackage.filter((item) => item.targetRepositoryId === repository);
  if (rightRepository.every((item) => item.bin !== target.bin)) return { state: "violated", findings: [finding("advisor-target-bin", "Advisor does not authorize this exact installed target bin.")] };
  return { state: "violated", findings: [finding("advisor-target-invocation", "Advisor does not authorize this target's exact fixed invocation.")] };
}

function writeReport(path: string | undefined, report: StarterReport): void { if (path !== undefined) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`); }

/** Executes only manifest-derived Advisor and target binaries after the pure joins pass. */
export function decide(requestPath: string, snapshotRoot: string, trustedEventPath: string, installReceiptPath: string, reportPath?: string, invokedPath?: string): StarterReport {
  let requestRaw: unknown; let trustedEvent: unknown; let install: unknown;
  try { requestRaw = readJsonFile(requestPath); trustedEvent = readJsonFile(trustedEventPath); install = readJsonFile(installReceiptPath); } catch (cause) {
    const report: StarterReport = { state: "indeterminate", phase: null, findings: [finding("input", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report;
  }
  const parsedRequest = validateStarterRequest(requestRaw);
  if (!parsedRequest.request) { const report: StarterReport = { state: "indeterminate", phase: null, findings: parsedRequest.findings, advisor: null, target: null }; writeReport(reportPath, report); return report; }
  const request = parsedRequest.request;
  const snapshotData = snapshotFromDirectory(snapshotRoot, request);
  const now = new Date().toISOString();
  const base = evaluateStarter({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor: { attempted: true, exitCode: 0, stdout: '{"state":"satisfied"}', currentAsOf: now }, target: { attempted: true, exitCode: 0, stdout: '{"state":"satisfied"}' } });
  const foundationOnly = request.phase === "foundation" && base.state === "indeterminate" && base.findings.length === 1 && base.findings[0]?.rule === "foundation-only";
  if ((!foundationOnly && base.state !== "satisfied") || snapshotData.findings.length > 0) { const report = snapshotData.findings.length === 0 ? base : { ...base, state: "indeterminate" as const, findings: [...base.findings, ...snapshotData.findings] }; writeReport(reportPath, report); return report; }
  const credential = credentialFindings(); const installed = validateInstalledIdentity(process.cwd(), request);
  if (credential.length > 0 || installed.length > 0) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [...credential, ...installed], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  let starterBin: string; let advisorBin: string; let targetBin: string;
  try { starterBin = resolveInstalledBin(process.cwd(), request.starter); advisorBin = resolveInstalledBin(process.cwd(), request.advisor); targetBin = resolveInstalledBin(process.cwd(), request.target); } catch (cause) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [finding("installed-bin", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  if (invokedPath !== undefined) {
    try {
      if (realpathSync(resolve(invokedPath)) !== starterBin) throw new StarterInputError("the decision executable is not Starter's exact installed manifest-derived bin");
    } catch (cause) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [finding("starter-invocation", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  }
  if (foundationOnly) { writeReport(reportPath, base); return base; }
  const assessment = resolve(snapshotRoot, request.evidence.assessment); const targetInput = resolve(snapshotRoot, request.evidence.targetInput);
  const advisor = runNode(advisorBin, [assessment, now], now);
  const advisorOutcome = evaluateProcessResult(advisor, "advisor", now);
  if (advisorOutcome.state !== "satisfied") { const report = evaluateStarter({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor }); writeReport(reportPath, report); return report; }
  const binding = advisorPlanBindsTarget(advisor.stdout, request.target, request.snapshot.repository);
  if (binding !== null) { const report: StarterReport = { state: binding.state, phase: request.phase, findings: binding.findings, advisor: "satisfied", target: null }; writeReport(reportPath, report); return report; }
  const target = runNode(targetBin, [targetInput]);
  const report = evaluateStarter({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor, target });
  writeReport(reportPath, report); return report;
}

export function decisionExitCode(report: StarterReport): number { return exitFor(report.state); }
