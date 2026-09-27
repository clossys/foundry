import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { compareHeadHiddenLockfile, NPM_CI_IGNORE_SCRIPTS, PUBLIC_NPM_REGISTRY, stagedNpmManifest, validateNpmIdentity, validateNpmLockfileSources, validateNpmManifestSources } from "./npm.js";
import { PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS, validatePnpmIdentity } from "./pnpm.js";
import { evaluateAdmission, evaluateHeadInstall, evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
import { ContractDocumentError, readContractDocument } from "./generated/contract-schema.generated.js";
import type { AdmissionReport, HeadInstallObservation, HeadInstallReport, StarterFinding, StarterReport, StarterRequest, ExactPackage, ProcessObservation } from "./types.js";

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

/** Validates manifest, lock, and installed bins for the identities the request names. */
export function validateInstalledIdentity(root: string, request: StarterRequest): StarterFinding[] {
  let manifest: unknown; let lock: unknown;
  try { manifest = readJsonFile(resolve(root, "package.json")); } catch (cause) { return [finding("root-manifest", cause instanceof Error ? cause.message : String(cause))]; }
  try {
    if (request.packageManager === "npm") lock = readJsonFile(resolve(root, NPM_CI_IGNORE_SCRIPTS.lockPath));
    else lock = readFileSync(resolve(root, PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS.lockPath), "utf8");
  } catch (cause) { return [finding("lockfile", cause instanceof Error ? cause.message : String(cause))]; }
  const validate = request.packageManager === "npm" ? validateNpmIdentity : validatePnpmIdentity;
  const expectedPackages = [request.starter, ...(request.advisor === undefined ? [] : [request.advisor]), request.target];
  const findings = expectedPackages.flatMap((expected) => validate(manifest, lock, expected)).map((message) => finding("exact-install-identity", message));
  for (const expected of expectedPackages) {
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

function authorizationPlanDigestFromAssessment(content: Buffer | undefined): unknown {
  if (content === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(content.toString("utf8")); } catch { return undefined; }
  if (!record(parsed) || !record(parsed.engagement)) return undefined;
  const authorization = parsed.engagement.executionAuthorization;
  if (!record(authorization)) return undefined;
  return authorization.planDigest;
}

function ledgerEntryPlanDigest(bytes: Uint8Array): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { return undefined; }
  if (!record(parsed) || !Array.isArray(parsed.history) || parsed.history.length === 0) return undefined;
  const entry = parsed.history[parsed.history.length - 1];
  return record(entry) ? entry.planDigest : undefined;
}

function planDigestEvaluationFields(assessmentContent: Buffer | undefined, ledgerBytes: Uint8Array | null): { authorization: { planDigest: unknown }; ledgerPlanDigest: unknown } {
  return {
    authorization: { planDigest: authorizationPlanDigestFromAssessment(assessmentContent) },
    ledgerPlanDigest: ledgerBytes === null ? undefined : ledgerEntryPlanDigest(ledgerBytes),
  };
}

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
  const assessmentContent = snapshotData.evidence.get(request.evidence.assessment);
  const ledgerRead = readLedgerFile(process.cwd());
  const planDigestFields = request.advisor === undefined ? planDigestEvaluationFields(assessmentContent, ledgerRead.status === "present" ? ledgerRead.bytes : null) : null;
  const satisfiedStub = { attempted: true as const, exitCode: 0 as const, stdout: '{"state":"satisfied"}' };
  const base = evaluateStarter({
    request: requestRaw,
    snapshot: snapshotData.snapshot,
    trustedEvent,
    install,
    now,
    ...(request.advisor === undefined
      ? planDigestFields ?? { authorization: { planDigest: undefined }, ledgerPlanDigest: undefined }
      : { advisor: { ...satisfiedStub, currentAsOf: now } }),
    target: satisfiedStub,
  });
  const foundationOnly = request.phase === "foundation" && base.state === "indeterminate" && base.findings.length === 1 && base.findings[0]?.rule === "foundation-only";
  if ((!foundationOnly && base.state !== "satisfied") || snapshotData.findings.length > 0) { const report = snapshotData.findings.length === 0 ? base : { ...base, state: "indeterminate" as const, findings: [...base.findings, ...snapshotData.findings] }; writeReport(reportPath, report); return report; }
  const credential = credentialFindings(); const installed = validateInstalledIdentity(process.cwd(), request);
  if (credential.length > 0 || installed.length > 0) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [...credential, ...installed], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  let starterBin: string; let advisorBin: string | undefined; let targetBin: string;
  try {
    starterBin = resolveInstalledBin(process.cwd(), request.starter);
    if (request.advisor !== undefined) advisorBin = resolveInstalledBin(process.cwd(), request.advisor);
    targetBin = resolveInstalledBin(process.cwd(), request.target);
  } catch (cause) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [finding("installed-bin", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  if (invokedPath !== undefined) {
    try {
      if (realpathSync(resolve(invokedPath)) !== starterBin) throw new StarterInputError("the decision executable is not Starter's exact installed manifest-derived bin");
    } catch (cause) { const report: StarterReport = { state: "indeterminate", phase: request.phase, findings: [finding("starter-invocation", cause instanceof Error ? cause.message : String(cause))], advisor: null, target: null }; writeReport(reportPath, report); return report; }
  }
  if (foundationOnly) { writeReport(reportPath, base); return base; }
  const assessment = resolve(snapshotRoot, request.evidence.assessment); const targetInput = resolve(snapshotRoot, request.evidence.targetInput);
  if (request.advisor === undefined) {
    const target = runNode(targetBin, [targetInput]);
    const report = evaluateStarter({
      request: requestRaw,
      snapshot: snapshotData.snapshot,
      trustedEvent,
      install,
      now,
      ...(planDigestFields ?? { authorization: { planDigest: undefined }, ledgerPlanDigest: undefined }),
      target,
    });
    writeReport(reportPath, report); return report;
  }
  const advisor = runNode(advisorBin as string, [assessment, now], now);
  const advisorOutcome = evaluateProcessResult(advisor, "advisor", now);
  if (advisorOutcome.state !== "satisfied") { const report = evaluateStarter({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor }); writeReport(reportPath, report); return report; }
  const binding = advisorPlanBindsTarget(advisor.stdout, request.target, request.snapshot.repository);
  if (binding !== null) { const report: StarterReport = { state: binding.state, phase: request.phase, findings: binding.findings, advisor: "satisfied", target: null }; writeReport(reportPath, report); return report; }
  const target = runNode(targetBin, [targetInput]);
  const report = evaluateStarter({ request: requestRaw, snapshot: snapshotData.snapshot, trustedEvent, install, now, advisor, target });
  writeReport(reportPath, report); return report;
}

export function decisionExitCode(report: StarterReport): number { return exitFor(report.state); }

/** Fixed bounds for the pull-request head's install data. */
export const HEAD_LOCKFILE_MAX_BYTES = 16_777_216;
export const HEAD_INSTALL_TIMEOUT_MS = 600_000;
const HEAD_COMMIT_PATH = ".git/HEAD";

/** Internal test seams only; the CLI never passes these, so a caller cannot choose the registry, deadline, or npm path. */
export interface HeadInstallOptions {
  readonly registry?: string;
  readonly timeoutMs?: number;
  readonly invokedPath?: string;
  /** The protected-base project whose installed Starter is running; defaults to the working directory. */
  readonly baseRoot?: string;
}

/**
 * The hardened npm environment for the head install. Deliberately built from
 * a literal rather than process.env: no token, user/global npmrc, registry
 * override, or script setting from the job reaches npm, and the staged project
 * carries no .npmrc of its own.
 */
export function headInstallEnvironment(stagingRoot: string, registry: string = PUBLIC_NPM_REGISTRY): NodeJS.ProcessEnv {
  const home = resolve(stagingRoot, "home");
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home, USERPROFILE: home, TMPDIR: resolve(stagingRoot, "tmp"), TEMP: resolve(stagingRoot, "tmp"), TMP: resolve(stagingRoot, "tmp"),
    XDG_CONFIG_HOME: resolve(home, ".config"), XDG_CACHE_HOME: resolve(home, ".cache"),
    npm_config_userconfig: resolve(stagingRoot, "config", "user-npmrc"),
    npm_config_globalconfig: resolve(stagingRoot, "config", "global-npmrc"),
    npm_config_cache: resolve(stagingRoot, "cache"),
    npm_config_registry: registry,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

/** Parses head-supplied JSON bytes with a position-only refusal: never the native parser's own message, which quotes a snippet of the input. */
function parseHeadJsonBytes(bytes: Buffer): unknown {
  try { return readContractDocument(bytes); }
  catch (cause) {
    const position = cause instanceof ContractDocumentError ? cause.position : undefined;
    throw new StarterInputError(`is not valid JSON${position === undefined ? "" : ` at position ${position}`}`);
  }
}

function readHeadJson(root: string, path: string, maxBytes: number, findings: StarterFinding[], rule: string): { value: unknown; bytes: Buffer | null } {
  try { const bytes = readContainedRegularFile(root, path, maxBytes); return { value: parseHeadJsonBytes(bytes), bytes }; }
  catch (cause) { findings.push(finding(rule, `pull-request head ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)); return { value: undefined, bytes: null }; }
}

function freshStaging(stagingRoot: string): void {
  if (existsSync(stagingRoot) && (lstatSync(stagingRoot).isSymbolicLink() || !statSync(stagingRoot).isDirectory() || readdirSync(stagingRoot).length > 0)) throw new StarterInputError("head staging directory must be absent or an empty real directory");
  for (const directory of ["project", "home", "tmp", "cache", "config"]) mkdirSync(resolve(stagingRoot, directory), { recursive: true });
  writeFileSync(resolve(stagingRoot, "config", "user-npmrc"), "");
  writeFileSync(resolve(stagingRoot, "config", "global-npmrc"), "");
}

function installedStarterFindings(root: string, request: StarterRequest, invokedPath: string | undefined): StarterFinding[] {
  let manifest: unknown; let lock: unknown;
  try { manifest = readJsonFile(resolve(root, "package.json")); lock = readJsonFile(resolve(root, NPM_CI_IGNORE_SCRIPTS.lockPath)); } catch (cause) { return [finding("starter-install", cause instanceof Error ? cause.message : String(cause))]; }
  const findings = validateNpmIdentity(manifest, lock, request.starter).map((message) => finding("starter-install", message));
  if (findings.length > 0 || invokedPath === undefined) return findings;
  try {
    if (realpathSync(resolve(invokedPath)) !== resolveInstalledBin(root, request.starter)) return [finding("starter-invocation", "the head-install executable is not the protected base's exact installed Starter bin")];
  } catch (cause) { return [finding("starter-invocation", cause instanceof Error ? cause.message : String(cause))]; }
  return [];
}

/**
 * Prove the pull-request head's own npm install in the trusted base job
 * (issue #1474) without executing any pull-request code: read the head's
 * request, manifest, and lockfile as bounded data from a trusted checkout of
 * the authenticated head commit, refuse non-registry sources, stage only the
 * dependency manifest and lockfile, run the fixed `npm ci --ignore-scripts`
 * under a literal hardened environment, and check the head request's exact
 * identities by reading installed manifests. Nothing installed is executed.
 */
export function proveHeadInstall(requestPath: string, headRoot: string, trustedEventPath: string, stagingRoot: string, reportPath?: string, options: HeadInstallOptions = {}): HeadInstallReport {
  const registry = options.registry ?? PUBLIC_NPM_REGISTRY;
  const inputFindings: StarterFinding[] = []; const sourceViolations: StarterFinding[] = [];
  let request: unknown; let trustedEvent: unknown;
  try { request = readJsonFile(requestPath); trustedEvent = readJsonFile(trustedEventPath); } catch (cause) { inputFindings.push(finding("input", cause instanceof Error ? cause.message : String(cause))); }
  let headRequest: unknown;
  if (!isNormalizedRelativePath(requestPath)) inputFindings.push(finding("head-request-path", "the request path must be a normalized relative path so the head copy is read at the same place."));
  else headRequest = readHeadJson(headRoot, requestPath, MAX_FILE_BYTES, inputFindings, "head-request").value;
  let headCommit: string | null = null;
  try { headCommit = readContainedRegularFile(headRoot, HEAD_COMMIT_PATH, 1_024).toString("utf8").trim(); } catch (cause) { inputFindings.push(finding("head-commit", cause instanceof Error ? cause.message : String(cause))); }
  const manifest = readHeadJson(headRoot, NPM_CI_IGNORE_SCRIPTS.manifestPath, MAX_FILE_BYTES, inputFindings, "head-manifest").value;
  const lock = readHeadJson(headRoot, NPM_CI_IGNORE_SCRIPTS.lockPath, HEAD_LOCKFILE_MAX_BYTES, inputFindings, "head-lockfile");
  const staged = stagedNpmManifest(manifest);
  if (manifest !== undefined) inputFindings.push(...staged.unsupported.map((message) => finding("head-manifest-unsupported", message)));
  const manifestSources = validateNpmManifestSources(staged.manifest);
  sourceViolations.push(...manifestSources.violations.map((message) => finding("head-manifest-source", message)));
  if (lock.bytes !== null) {
    const sources = validateNpmLockfileSources(lock.value, registry);
    inputFindings.push(...sources.unsupported.map((message) => finding("head-lockfile-unsupported", message)));
    sourceViolations.push(...sources.violations.map((message) => finding("head-lockfile-source", message)));
  }
  inputFindings.push(...credentialFindings());
  const parsedRequest = validateStarterRequest(request);
  if (parsedRequest.request) inputFindings.push(...installedStarterFindings(options.baseRoot ?? process.cwd(), parsedRequest.request, options.invokedPath));
  const done = (report: HeadInstallReport): HeadInstallReport => { writeHeadReport(reportPath, report); return report; };
  const pre = evaluateHeadInstall({ request, headRequest, trustedEvent, headCommit, inputFindings, sourceViolations });
  if (pre.state !== "indeterminate" || pre.findings.length !== 1 || pre.findings[0]?.rule !== "head-install-not-run") return done(pre);
  try { freshStaging(stagingRoot); } catch (cause) { return done(evaluateHeadInstall({ request, headRequest, trustedEvent, headCommit, inputFindings: [finding("head-staging", cause instanceof Error ? cause.message : String(cause))], sourceViolations })); }
  const project = resolve(stagingRoot, "project");
  writeFileSync(resolve(project, NPM_CI_IGNORE_SCRIPTS.manifestPath), `${JSON.stringify(staged.manifest, null, 2)}\n`);
  writeFileSync(resolve(project, NPM_CI_IGNORE_SCRIPTS.lockPath), lock.bytes as Buffer);
  const child = spawnSync(NPM_CI_IGNORE_SCRIPTS.command, [...NPM_CI_IGNORE_SCRIPTS.args, "--no-audit", "--no-fund"], { cwd: project, encoding: "utf8", maxBuffer: 8_388_608, shell: false, env: headInstallEnvironment(stagingRoot, registry), timeout: options.timeoutMs ?? HEAD_INSTALL_TIMEOUT_MS, killSignal: "SIGKILL" });
  const timedOut = (child.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const install: HeadInstallObservation = { attempted: child.error === undefined || timedOut, exitCode: child.status, timedOut };
  const identityFindings: StarterFinding[] = [];
  const head = validateStarterRequest(headRequest).request as StarterRequest;
  if (install.exitCode === 0 && !timedOut) {
    for (const expected of [head.starter, ...(head.advisor === undefined ? [] : [head.advisor]), head.target]) {
      identityFindings.push(...validateNpmIdentity(staged.manifest, lock.value, expected).map((message) => finding("head-identity", message)));
      try { resolveInstalledBin(project, expected); } catch (cause) { identityFindings.push(finding("head-installed-bin", cause instanceof Error ? cause.message : String(cause))); }
    }
    // npm ci does not install straight from the lockfile when a spec disagrees with it: it re-resolves any
    // edge the lock does not satisfy through pacote before ever comparing to the lockfile. The one record of
    // what actually landed is npm's own hidden lockfile, written after the fact; a source violation caught
    // above stops the job before this point, so this check catches only what pre-install grammar could not.
    let hiddenLock: unknown = null;
    try { hiddenLock = JSON.parse(readContainedRegularFile(project, "node_modules/.package-lock.json", HEAD_LOCKFILE_MAX_BYTES).toString("utf8")); } catch { hiddenLock = null; }
    const hidden = compareHeadHiddenLockfile(lock.value, hiddenLock);
    if (hidden.state === "indeterminate") inputFindings.push(finding("head-hidden-lockfile", "the head install's hidden lockfile node_modules/.package-lock.json could not be read."));
    else identityFindings.push(...hidden.violations.map((message) => finding("head-hidden-lockfile", message)));
  }
  return done(evaluateHeadInstall({ request, headRequest, trustedEvent, headCommit, inputFindings, sourceViolations, install, identityFindings }));
}

function writeHeadReport(path: string | undefined, report: HeadInstallReport): void { if (path !== undefined) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`); }
export function headInstallExitCode(report: HeadInstallReport): number { return exitFor(report.state); }

/** The installed-state ledger path the admission check reads in each checkout. */
const INSTALLED_LEDGER_PATH = "clossys/.state/installed.json";

function readLedgerFile(root: string): { status: "present"; bytes: Uint8Array } | { status: "absent" } | { status: "unreadable" } {
  try { return { status: "present", bytes: readContainedRegularFile(root, INSTALLED_LEDGER_PATH) }; }
  catch (cause) {
    const code = cause instanceof Error && "code" in cause ? (cause as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return { status: "absent" };
    return { status: "unreadable" };
  }
}

function readFrozenInstall(root: string, manager: StarterRequest["packageManager"]): { manifest: unknown; lock: unknown } | null {
  try {
    const manifest = JSON.parse(readContainedRegularFile(root, "package.json").toString("utf8"));
    if (manager === "npm") return { manifest, lock: JSON.parse(readContainedRegularFile(root, NPM_CI_IGNORE_SCRIPTS.lockPath).toString("utf8")) };
    return { manifest, lock: readContainedRegularFile(root, PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS.lockPath).toString("utf8") };
  } catch { return null; }
}

/**
 * Reads the protected base ledger, the pull-request ledger, and the base
 * manifest and lockfile, then compares them with `evaluateAdmission`.
 * The request file selects phase admission and carries no ledger bytes.
 */
export function checkAdmission(requestPath: string, baseRoot: string, headRoot: string, reportPath?: string): AdmissionReport {
  const write = (report: AdmissionReport): AdmissionReport => { if (reportPath !== undefined) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); return report; };
  let request: unknown;
  try { request = readJsonFile(requestPath); } catch (cause) {
    return write({ schemaVersion: 1, kind: "admission", state: "indeterminate", phase: null, findings: [finding("input", cause instanceof Error ? cause.message : String(cause))] });
  }
  const parsed = validateStarterRequest(request);
  const base = readLedgerFile(baseRoot);
  const head = readLedgerFile(headRoot);
  const install = parsed.request?.phase === "admission" ? readFrozenInstall(baseRoot, parsed.request.packageManager) : null;
  return write(evaluateAdmission({
    request,
    baseLedger: base.status === "present" ? base.bytes : null,
    headLedger: head.status === "present" ? head.bytes : null,
    baseUnreadable: base.status === "unreadable",
    headUnreadable: head.status === "unreadable",
    install,
  }));
}
