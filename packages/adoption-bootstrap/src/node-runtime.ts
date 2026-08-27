import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { NPM_CI_IGNORE_SCRIPTS, validateNpmIdentity } from "./npm.js";
import { PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS, validatePnpmIdentity } from "./pnpm.js";
import { evaluateBootstrap, evaluateProcessResult, isNormalizedRelativePath, validateBootstrapRequest } from "./core.js";
import type { BootstrapFinding, BootstrapReport, BootstrapRequest, ExactPackage, ProcessObservation, SnapshotManifest } from "./types.js";

const MAX_FILE_BYTES = 524_288;
const CREDENTIAL_ENVIRONMENT_NAMES = ["NODE_AUTH_TOKEN", "NPM_TOKEN", "GH_PACKAGES_TOKEN"] as const;
type UnknownRecord = Record<string, unknown>;
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finding(rule: string, message: string): BootstrapFinding { return { rule, message }; }
function exitFor(state: BootstrapReport["state"]): number { return state === "satisfied" ? 0 : state === "violated" ? 1 : 2; }
function contained(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !resolve(candidate).startsWith(`${resolve(root)}${sep}..`)); }

export class BootstrapInputError extends Error {}

/** Read one bounded, real, non-symlink file contained by a trusted root. */
export function readContainedRegularFile(root: string, path: string, maxBytes = MAX_FILE_BYTES): Buffer {
  if (!isNormalizedRelativePath(path)) throw new BootstrapInputError(`path "${path}" is not normalized relative`);
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, path);
  if (!contained(realRoot, candidate)) throw new BootstrapInputError(`path "${path}" escapes its root`);
  const link = lstatSync(candidate);
  if (link.isSymbolicLink() || !link.isFile()) throw new BootstrapInputError(`path "${path}" is not a regular non-symlink file`);
  const realFile = realpathSync(candidate);
  if (!contained(realRoot, realFile) || !statSync(realFile).isFile()) throw new BootstrapInputError(`path "${path}" resolves outside its root`);
  const size = statSync(realFile).size;
  if (size > maxBytes) throw new BootstrapInputError(`path "${path}" exceeds ${maxBytes} bytes`);
  return readFileSync(realFile);
}

function readJsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (cause) { throw new BootstrapInputError(`cannot read JSON ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

function snapshotFromDirectory(root: string, request: BootstrapRequest): { snapshot: unknown; evidence: Map<string, Buffer>; findings: BootstrapFinding[] } {
  const findings: BootstrapFinding[] = [];
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
  if (!contained(nodeModules, packagePath) || !existsSync(packagePath)) throw new BootstrapInputError(`installed ${expected.name} is absent`);
  const packageRoot = realpathSync(packagePath);
  if (!contained(realpathSync(nodeModules), packageRoot)) throw new BootstrapInputError(`installed ${expected.name} resolves outside node_modules`);
  const manifestPath = resolve(packageRoot, "package.json");
  if (!contained(packageRoot, manifestPath) || lstatSync(manifestPath).isSymbolicLink() || !statSync(manifestPath).isFile()) throw new BootstrapInputError(`installed ${expected.name} manifest is not a regular file`);
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { throw new BootstrapInputError(`installed ${expected.name} manifest is unreadable JSON`); }
  if (!record(manifest) || manifest.name !== expected.name || manifest.version !== expected.version || !record(manifest.bin) || typeof manifest.bin[expected.bin] !== "string") throw new BootstrapInputError(`installed ${expected.name} manifest does not match the expected identity and bin`);
  const bin = manifest.bin[expected.bin] as string;
  if (!isNormalizedRelativePath(bin.replace(/^\.\//, "")) || bin.includes("..")) throw new BootstrapInputError(`installed ${expected.name} bin escapes its manifest root`);
  const candidate = resolve(packageRoot, bin);
  if (!contained(packageRoot, candidate) || lstatSync(candidate).isSymbolicLink() || !statSync(candidate).isFile()) throw new BootstrapInputError(`installed ${expected.name} bin is not a regular contained file`);
  const realBin = realpathSync(candidate);
  if (!contained(packageRoot, realBin)) throw new BootstrapInputError(`installed ${expected.name} bin resolves outside its package`);
  return realBin;
}

function validateInstalledIdentity(root: string, request: BootstrapRequest): BootstrapFinding[] {
  let manifest: unknown; let lock: unknown;
  try { manifest = readJsonFile(resolve(root, "package.json")); } catch (cause) { return [finding("root-manifest", cause instanceof Error ? cause.message : String(cause))]; }
  try {
    if (request.packageManager === "npm") lock = readJsonFile(resolve(root, NPM_CI_IGNORE_SCRIPTS.lockPath));
    else lock = readFileSync(resolve(root, PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS.lockPath), "utf8");
  } catch (cause) { return [finding("lockfile", cause instanceof Error ? cause.message : String(cause))]; }
  const validate = request.packageManager === "npm" ? validateNpmIdentity : validatePnpmIdentity;
  const findings = [...validate(manifest, lock, request.advisor), ...validate(manifest, lock, request.target)].map((message) => finding("exact-install-identity", message));
  for (const expected of [request.advisor, request.target]) {
    try { resolveInstalledBin(root, expected); } catch (cause) { findings.push(finding("installed-bin", cause instanceof Error ? cause.message : String(cause))); }
  }
  return findings;
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const name of CREDENTIAL_ENVIRONMENT_NAMES) delete clean[name];
  return clean;
}
function credentialFindings(): BootstrapFinding[] {
  return CREDENTIAL_ENVIRONMENT_NAMES.filter((name) => typeof process.env[name] === "string" && process.env[name] !== "").map((name) => finding("decision-credential", `${name} is present in a decisive CLI step; credentials belong only to the fixed install step.`));
}
function runNode(bin: string, args: readonly string[], currentAsOf?: string): ProcessObservation {
  const child = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", maxBuffer: 1_048_576, shell: false, env: sanitizedEnvironment() });
  return { attempted: child.error === undefined, exitCode: child.status, stdout: child.stdout ?? "", currentAsOf };
}
function advisorPlanBindsTarget(stdout: string, target: ExactPackage): BootstrapFinding[] {
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return [finding("advisor-output", "Advisor did not produce a readable report.")]; }
  const workItems = record(raw) && record(raw.assessment) && record(raw.assessment.firstWave) && Array.isArray(raw.assessment.firstWave.workItems) ? raw.assessment.firstWave.workItems : null;
  if (!workItems) return [finding("advisor-plan", "Advisor report has no first-wave work items to bind the target package.")];
  const matches = workItems.some((item) => record(item) && record(item.package) && item.package.name === target.name && item.package.version === target.version && item.package.integrity === target.integrity);
  return matches ? [] : [finding("advisor-target-identity", "Advisor's runner-time ready plan does not contain this target's exact name, version, and integrity.")];
}

function writeReport(path: string | undefined, report: BootstrapReport): void { if (path !== undefined) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`); }

/** Executes only manifest-derived Advisor and target binaries after the pure joins pass. */
export function decide(requestPath: string, snapshotRoot: string, trustedEventPath: string, installReceiptPath: string, reportPath?: string): BootstrapReport {
  let requestRaw: unknown; let trustedEvent: unknown; let install: unknown;
  try { requestRaw = readJsonFile(requestPath); trustedEvent = readJsonFile(trustedEventPath); install = readJsonFile(installReceiptPath); } catch (cause) {
    const report: BootstrapReport = { state: "indeterminate", phase: null, findings: [finding("input", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report;
  }
  const parsedRequest = validateBootstrapRequest(requestRaw);
  if (!parsedRequest.request) { const report: BootstrapReport = { state: "indeterminate", phase: null, findings: parsedRequest.findings, advisor: null, target: null }; writeReport(reportPath, report); return report; }
  const request = parsedRequest.request;
  const snapshotData = snapshotFromDirectory(snapshotRoot, request);
  const now = new Date().toISOString();
  const base = evaluateBootstrap({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor: { attempted: true, exitCode: 0, stdout: '{"state":"satisfied"}', currentAsOf: now }, target: { attempted: true, exitCode: 0, stdout: '{"state":"satisfied"}' } });
  if (base.state !== "satisfied" || snapshotData.findings.length > 0) { const report = snapshotData.findings.length === 0 ? base : { ...base, state: "indeterminate" as const, findings: [...base.findings, ...snapshotData.findings] }; writeReport(reportPath, report); return report; }
  const credential = credentialFindings(); const installed = validateInstalledIdentity(process.cwd(), request);
  if (credential.length > 0 || installed.length > 0) { const report: BootstrapReport = { state: "indeterminate", phase: request.phase, findings: [...credential, ...installed], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  let advisorBin: string; let targetBin: string;
  try { advisorBin = resolveInstalledBin(process.cwd(), request.advisor); targetBin = resolveInstalledBin(process.cwd(), request.target); } catch (cause) { const report: BootstrapReport = { state: "indeterminate", phase: request.phase, findings: [finding("installed-bin", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  const assessment = resolve(snapshotRoot, request.evidence.assessment); const targetInput = resolve(snapshotRoot, request.evidence.targetInput);
  const advisor = runNode(advisorBin, [assessment, now], now);
  const advisorOutcome = evaluateProcessResult(advisor, "advisor", now);
  if (advisorOutcome.state !== "satisfied") { const report = evaluateBootstrap({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor }); writeReport(reportPath, report); return report; }
  const binding = advisorPlanBindsTarget(advisor.stdout, request.target);
  if (binding.length > 0) { const report: BootstrapReport = { state: "indeterminate", phase: request.phase, findings: binding, advisor: "satisfied", target: null }; writeReport(reportPath, report); return report; }
  const target = runNode(targetBin, [targetInput]);
  const report = evaluateBootstrap({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor, target });
  writeReport(reportPath, report); return report;
}

export function decisionExitCode(report: BootstrapReport): number { return exitFor(report.state); }
