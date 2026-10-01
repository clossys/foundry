// Provenance gate for a change set (RFC apply-approved-plan: V9, D20, D23, T12).
//
// Every package version a set installs or pins must have registry provenance
// that Integrator verifies. The hub pins `@clossys/integrator` (D23), so this
// runs the hub's own `integrator-provenance-check` bin against the
// materialized tree, reads its JSON report strictly, and turns it into one V9
// verdict for the set. The bin is found only inside the hub's own
// node_modules, never through npx or PATH, and runs under the same literal
// environment allow-list the lockfile step uses (lockfile-tool-env.ts): no
// parent credential, proxy, CA-trust or NODE_OPTIONS value reaches it.
//
// Every ambiguity refuses. A report that does not parse to exactly the shape
// the bin prints, or that disagrees with its own exit code, is indeterminate,
// never trusted as far as it goes. A package version the bin does not verify is
// never passed by any exception: it stays violated or indeterminate exactly as
// Integrator reports it.
//
// D20's first-identity-publication exception is deliberately not implemented.
// It needs evidence that a version is a package's first publication, and the
// registry snapshot cannot give it: a snapshot taken to resolve a plan records
// only the one version `latest` names, whatever else the package has published,
// and Integrator reports "attestation failed" (violated) the same way as "no
// attestation". Any condition built on the snapshot would therefore also pass a
// package with earlier releases whose latest release fails verification. Until
// the snapshot contract records evidence of a first publication, an unattested
// first publication blocks the apply: fail closed. Nothing here fetches,
// repairs or retries.
//
// The RFC and the snapshot contract are in the public repository, not shipped
// in this package: docs/rfcs/apply-approved-plan.md and
// docs/contracts/registry-snapshot.json.

import { lstat, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { compareCodeUnits } from "./change-set-contract.js";
import type { ApplyCheck, ChangeSetItem } from "./change-set-contract.js";
import { readContractDocument } from "./generated/contract-schema.generated.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { spawnLockfileTool } from "./lockfile-regen.js";
import type { LockfileSpawn, LockfileSpawnResult } from "./lockfile-regen.js";
import { lockfileToolEnv, prepareLockfileScratch } from "./lockfile-tool-env.js";
import type { LockfileScratch } from "./lockfile-tool-env.js";
import { canonicalDigest } from "./plan-digest.js";
import { canonicalRegistrySnapshot, registrySnapshotViolations } from "./registry-snapshot.js";
import type { RegistrySnapshot } from "./registry-snapshot.js";

/** The bin Integrator installs, found under the hub's node_modules/.bin. */
export const PROVENANCE_CHECK_BIN = "integrator-provenance-check";
/** How long one run of the bin may take. */
export const PROVENANCE_CHECK_TIMEOUT_MS = 120_000;
/** Bytes kept of the bin's stdout; a report at or past this is treated as truncated. */
export const PROVENANCE_CHECK_MAX_BUFFER = 1_000_000;

export interface ProvenanceGateInput {
  /** Absolute, real (realpath-equal) directory holding the set's materialized tree. */
  readonly tree: string;
  /** Absolute, real (realpath-equal) hub root, whose node_modules holds Integrator. */
  readonly hubRoot: string;
  /** The change set's items. */
  readonly items: readonly ChangeSetItem[];
}

/** Ports. Not reachable from a CLI. */
export interface ProvenanceGatePorts {
  readonly spawn?: LockfileSpawn;
}

// ---------------------------------------------------------------------------
// The snapshot digest
// ---------------------------------------------------------------------------

/**
 * The snapshot's digest, as docs/contracts/registry-snapshot.json defines it
 * (in the public repository, not shipped in this package): `sha256:` and the
 * SHA-256 of the canonical JSON of `{registry, packages}`, packages sorted by
 * name, each reduced to name, status, latest and versions, versions sorted by
 * version and kept whole. fetchedAt, fetchedBy, responseSha256, schemaVersion
 * and kind are left out. Throws TypeError for a snapshot that does not validate
 * against the contract: an invalid snapshot has no digest. The gate itself
 * does not read a snapshot; this is exported for the plan binding that a later
 * change wires in.
 */
export function registrySnapshotDigest(snapshot: RegistrySnapshot): string {
  if (registrySnapshotViolations(snapshot).length > 0) throw new TypeError("a snapshot that does not validate against the registry snapshot contract has no digest");
  const canonical = canonicalRegistrySnapshot(snapshot);
  return canonicalDigest({
    registry: canonical.registry,
    packages: canonical.packages.map((entry) => ({ name: entry.name, status: entry.status, latest: entry.latest, versions: entry.versions })),
  });
}

// ---------------------------------------------------------------------------
// Verdict plumbing
// ---------------------------------------------------------------------------

const indeterminate = (rule: string): ApplyCheck => ({ check: "V9", verdict: "indeterminate", rule });
const violated = (rule: string): ApplyCheck => ({ check: "V9", verdict: "violated", rule });

/** The rules behind a failed V9, one entry per distinct rule, in code-unit order. */
function distinctRules(verdict: "indeterminate" | "violated", rules: ReadonlySet<string>): ApplyCheck[] {
  return [...rules].sort(compareCodeUnits).map((rule) => (verdict === "indeterminate" ? indeterminate(rule) : violated(rule)));
}

// ---------------------------------------------------------------------------
// The gated set
// ---------------------------------------------------------------------------

interface GatedPackage {
  readonly name: string;
  readonly version: string;
}

/**
 * The packages this set installs or pins that its base does not already hold,
 * by exact name, each once. Only a `satisfiedInBase` of exactly `true` skips an
 * item: a value other than `true` (`false`, missing, `null`, a string or a
 * number) is gated. Undefined when one name is gated at two versions: the set
 * then asks for something no single report can answer.
 */
function gatedPackages(items: readonly ChangeSetItem[]): GatedPackage[] | undefined {
  const versions = new Map<string, string>();
  for (const item of items) {
    if ((item.act !== "install" && item.act !== "pin-starter") || item.satisfiedInBase === true) continue;
    const earlier = versions.get(item.package.name);
    if (earlier !== undefined && earlier !== item.package.version) return undefined;
    versions.set(item.package.name, item.package.version);
  }
  return [...versions].map(([name, version]) => ({ name, version }));
}

// ---------------------------------------------------------------------------
// Roots and the bin
// ---------------------------------------------------------------------------

/** An absolute path that is its own realpath and names a directory. */
async function isCanonicalDirectory(path: string): Promise<boolean> {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  try {
    if ((await realpath(path)) !== path) return false;
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `child` lies strictly inside `parent`; both are already real paths. */
function isStrictlyInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/**
 * The verified real path of the hub's Integrator bin, or undefined. The
 * `.bin` entry must resolve to a regular file strictly inside the real path of
 * `node_modules/@clossys/integrator`, and that directory's real path must
 * itself lie strictly inside `<hubRoot>/node_modules`, so a link that leaves
 * the hub, leaves node_modules, or points at some other package's file is
 * refused. `hubRoot` is already its own realpath.
 *
 * The caller spawns the returned real path, not the `.bin` entry: the launch
 * then goes to the very file that was checked, and a link swapped in after the
 * check cannot redirect it.
 */
async function verifiedBin(hubRoot: string): Promise<string | undefined> {
  const nodeModules = join(hubRoot, "node_modules");
  try {
    const realBin = await realpath(join(nodeModules, ".bin", PROVENANCE_CHECK_BIN));
    const realIntegrator = await realpath(join(nodeModules, "@clossys", "integrator"));
    if (!(await lstat(realBin)).isFile() || !(await lstat(realIntegrator)).isDirectory()) return undefined;
    if (!isStrictlyInside(nodeModules, realIntegrator) || !isStrictlyInside(realIntegrator, realBin)) return undefined;
    return realBin;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

type PackageState = "verified" | "violated" | "indeterminate";

interface ReportedPackage {
  readonly name: string;
  readonly installedVersion: string;
  readonly state: PackageState;
}

interface ProvenanceReport {
  readonly state: PackageState;
  readonly packages: readonly ReportedPackage[];
}

const REPORT_KEYS: ReadonlySet<string> = new Set(["state", "registryBaseUrl", "packages"]);
const PACKAGE_KEYS: ReadonlySet<string> = new Set(["name", "installedVersion", "latestVersion", "currencyDistance", "state", "reasons"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};
const isState = (value: unknown): value is PackageState => value === "verified" || value === "violated" || value === "indeterminate";
const isString = (value: unknown): value is string => typeof value === "string";

/** Whether `value` is an own-keyed plain object whose keys all come from `allowed`. */
function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key) && Object.hasOwn(value, key));
}

/**
 * Reads the bin's stdout as the closed report it prints, or undefined. Output
 * at or past the capture limit is refused as truncated. The text is read with
 * the same strict reader the contracts use, so a repeated key or a byte order
 * mark is refused as well as anything JSON.parse refuses; no key outside the
 * closed sets is accepted, and each field must have the type the bin gives it.
 * The report's reasons are checked for shape and never used.
 */
function readReport(stdout: string): ProvenanceReport | undefined {
  if (Buffer.byteLength(stdout, "utf8") >= PROVENANCE_CHECK_MAX_BUFFER) return undefined;
  let value: unknown;
  try {
    value = readContractDocument(Buffer.from(stdout, "utf8"));
  } catch {
    return undefined;
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, REPORT_KEYS) || Object.keys(value).length !== REPORT_KEYS.size) return undefined;
  const { state, registryBaseUrl, packages } = value;
  if (!isState(state) || registryBaseUrl !== PACKAGE_SCOPE.registry || !Array.isArray(packages)) return undefined;
  const reported: ReportedPackage[] = [];
  for (const entry of packages as unknown[]) {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, PACKAGE_KEYS)) return undefined;
    const { name, installedVersion, latestVersion, currencyDistance, state: packageState, reasons } = entry;
    if (!isString(name) || !isString(installedVersion) || !isState(packageState)) return undefined;
    if (!Array.isArray(reasons) || !(reasons as unknown[]).every(isString)) return undefined;
    if (Object.hasOwn(entry, "latestVersion") && !isString(latestVersion)) return undefined;
    if (Object.hasOwn(entry, "currencyDistance") && !isString(currencyDistance)) return undefined;
    reported.push({ name, installedVersion, state: packageState });
  }
  return { state, packages: reported };
}

/** Whether the report says what its exit code says: exit 0 all verified, exit 1 a violation and nothing indeterminate. */
function agreesWithExit(status: 0 | 1, report: ProvenanceReport): boolean {
  if (status === 0) return report.state === "verified" && report.packages.length > 0 && report.packages.every((entry) => entry.state === "verified");
  return report.state === "violated" && report.packages.some((entry) => entry.state === "violated") && report.packages.every((entry) => entry.state !== "indeterminate");
}

/** The rule an unsuccessful launch maps to, or undefined when the bin ran to exit 0 or 1 with no failure flag. */
function launchFailure(result: LockfileSpawnResult): string | undefined {
  if (result.failure === "not-found") return "engine-missing-bin";
  if (result.failure === "timeout") return "engine-timeout";
  if (result.failure !== undefined) return "engine-failed";
  if (result.status === 2) return "engine-indeterminate";
  if (result.status !== 0 && result.status !== 1) return "engine-failed";
  return undefined;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * V9 for one change set. Satisfied without touching anything when the set
 * installs or pins nothing its base lacks. Otherwise runs the hub's
 * `integrator-provenance-check` against `tree` and judges each gated package
 * by exact name and exact version: satisfied only when every one is verified
 * at that version, with no exception for an unverified one. Other `@clossys`
 * packages in the report never gate: an unrelated violated legacy pin passes
 * when every gated package is verified. Indeterminate wins over violated; the
 * result lists each distinct rule once, in code-unit order, and never mixes a
 * satisfied entry with a refusal. Never throws for a bad input; everything it
 * cannot rely on is an indeterminate entry. The input carries no ledger or
 * snapshot: nothing here reads one.
 */
export async function checkSetProvenance(input: ProvenanceGateInput, ports: ProvenanceGatePorts = {}): Promise<readonly ApplyCheck[]> {
  // 1. The gated set.
  const gated = gatedPackages(input.items);
  if (gated === undefined) return [indeterminate("gated-package-conflict")];
  if (gated.length === 0) return [{ check: "V9", verdict: "satisfied" }];

  // 2 and 3. Roots, then the bin.
  if (!(await isCanonicalDirectory(input.tree)) || !(await isCanonicalDirectory(input.hubRoot))) return [indeterminate("root-not-canonical")];
  const command = await verifiedBin(input.hubRoot);
  if (command === undefined) return [indeterminate("engine-missing-bin")];

  // 4. Launch, in a scratch working directory, under the allow-list environment.
  const run = ports.spawn ?? spawnLockfileTool;
  let scratch: LockfileScratch;
  try {
    scratch = await prepareLockfileScratch();
  } catch {
    return [indeterminate("engine-failed")];
  }
  let result: LockfileSpawnResult | undefined;
  try {
    const env = lockfileToolEnv({ tool: "npm", scratch: scratch.path, registry: PACKAGE_SCOPE.registry, corepack: false, parent: process.env });
    // The bin's `#!/usr/bin/env node` must find the node that is running this code.
    env.PATH = `${dirname(process.execPath)}${delimiter}${env.PATH ?? ""}`;
    result = await run({
      command,
      args: ["--cwd", input.tree, "--registry", PACKAGE_SCOPE.registry],
      cwd: scratch.path,
      env,
      timeoutMs: PROVENANCE_CHECK_TIMEOUT_MS,
      maxBuffer: PROVENANCE_CHECK_MAX_BUFFER,
    });
  } catch {
    result = undefined;
  } finally {
    try {
      await scratch.remove();
    } catch {
      // The verdict does not depend on the scratch's removal, and it is under the OS temp root.
    }
  }
  if (result === undefined) return [indeterminate("engine-failed")];
  const failure = launchFailure(result);
  if (failure !== undefined) return [indeterminate(failure)];

  // 5 and 6. The report, and whether it agrees with its exit code.
  const report = typeof result.stdout === "string" ? readReport(result.stdout) : undefined;
  if (report === undefined) return [indeterminate("report-unreadable")];
  if (!agreesWithExit(result.status as 0 | 1, report)) return [indeterminate("report-contradicts-exit")];

  // 7 and 8. Each gated package, by exact name and exact version.
  const indeterminateRules = new Set<string>();
  const violatedRules = new Set<string>();
  for (const pkg of gated) {
    const entries = report.packages.filter((entry) => entry.name === pkg.name);
    if (entries.length === 0) {
      indeterminateRules.add("package-not-in-report");
      continue;
    }
    if (entries.some((entry) => entry.installedVersion !== pkg.version)) {
      violatedRules.add("version-mismatch");
      continue;
    }
    // The report already agrees with its exit code, so no entry is indeterminate; this is the same refusal kept local.
    if (entries.some((entry) => entry.state === "indeterminate")) {
      indeterminateRules.add("package-indeterminate");
      continue;
    }
    if (entries.every((entry) => entry.state === "verified")) continue;
    // Unverified at the act's own version: violated, with no exception.
    violatedRules.add("provenance-unverified");
  }

  // 9. Indeterminate wins over violated; a satisfied entry never sits beside a refusal.
  if (indeterminateRules.size > 0) return distinctRules("indeterminate", indeterminateRules);
  if (violatedRules.size > 0) return distinctRules("violated", violatedRules);
  return [{ check: "V9", verdict: "satisfied" }];
}
