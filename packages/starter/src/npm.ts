import type { ExactPackage } from "./types.js";

/** The sole npm install command v1 represents. It is data, not caller input. */
export const NPM_CI_IGNORE_SCRIPTS = Object.freeze({
  command: "npm",
  args: ["ci", "--ignore-scripts"],
  manifestPath: "package.json",
  lockPath: "package-lock.json",
});

type UnknownRecord = Record<string, unknown>;
const ROOT_DEPENDENCY_SECTION = "devDependencies";
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function declaredVersion(value: unknown, expected: ExactPackage): boolean {
  if (!record(value)) return false;
  const dependencies = record(value[ROOT_DEPENDENCY_SECTION]) ? value[ROOT_DEPENDENCY_SECTION] : {};
  return dependencies[expected.name] === expected.version;
}

/** Validates npm's root devDependency and lock-v3 package entry without accepting a range or a borrowed section. */
export function validateNpmIdentity(manifest: unknown, lock: unknown, expected: ExactPackage): string[] {
  const findings: string[] = [];
  if (!declaredVersion(manifest, expected)) findings.push(`package.json ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name} at exact ${expected.version}`);
  if (!record(lock) || !record(lock.packages)) return [...findings, "package-lock.json has no packages object"];
  const root = lock.packages[""];
  if (!declaredVersion(root, expected)) findings.push(`package-lock root ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name} at exact ${expected.version}`);
  const entry = lock.packages[`node_modules/${expected.name}`];
  if (!record(entry) || entry.version !== expected.version || entry.integrity !== expected.integrity) {
    findings.push(`package-lock entry for ${expected.name} does not match exact version and integrity`);
  }
  return findings;
}

/** The only registry a head-install proof accepts lockfile tarballs from. */
export const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";
const SINGLE_SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;
/** Manifest keys npm ci needs to check the lockfile; every other key (scripts, workspaces, packageManager, config) is dropped before staging. */
const STAGED_MANIFEST_KEYS = ["name", "version", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "overrides", "bundleDependencies", "bundledDependencies"] as const;

/** A lockfile or manifest refusal. `unsupported` shapes cannot be proved; `violations` are sources the proof forbids. */
export interface NpmHeadSourceFindings {
  readonly violations: readonly string[];
  readonly unsupported: readonly string[];
}

function registryTarball(resolved: string, registry: URL): boolean {
  let url: URL;
  try { url = new URL(resolved); } catch { return false; }
  return url.protocol === registry.protocol && url.host === registry.host && url.username === "" && url.password === "" && url.search === "" && url.hash === "" && url.pathname.startsWith(registry.pathname) && url.pathname.endsWith(".tgz");
}

/**
 * Checks a pull-request head's npm lockfile as data before any install runs.
 * Every installed entry must be a tarball from the one fixed registry with a
 * single SHA-512 integrity: git, file, link, directory, other-host, and
 * SHA-1-only entries are refused. Workspaces are unsupported, not guessed.
 */
export function validateNpmLockfileSources(lock: unknown, registry: string = PUBLIC_NPM_REGISTRY): NpmHeadSourceFindings {
  const violations: string[] = []; const unsupported: string[] = [];
  const origin = new URL(registry);
  if (!record(lock) || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !record(lock.packages)) return { violations, unsupported: ["package-lock.json is not a lockfileVersion 2 or 3 document with a packages object"] };
  const root = lock.packages[""];
  if (!record(root)) unsupported.push("package-lock.json has no root package entry");
  else if (root.workspaces !== undefined) unsupported.push("package-lock.json declares workspaces, which head-install proof does not stage");
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    if (!key.startsWith("node_modules/") || key.split("/").includes("..")) { unsupported.push(`package-lock.json entry "${key}" is not an installed node_modules path`); continue; }
    if (!record(entry)) { violations.push(`package-lock.json entry "${key}" is not an object`); continue; }
    if (entry.link === true) { violations.push(`package-lock.json entry "${key}" is a link, not a registry tarball`); continue; }
    if (entry.inBundle === true && entry.resolved === undefined && entry.integrity === undefined) continue;
    if (typeof entry.resolved !== "string" || !registryTarball(entry.resolved, origin)) violations.push(`package-lock.json entry "${key}" does not resolve to a ${origin.origin} tarball`);
    if (typeof entry.integrity !== "string" || !SINGLE_SHA512_SRI.test(entry.integrity)) violations.push(`package-lock.json entry "${key}" lacks one SHA-512 integrity`);
  }
  return { violations, unsupported };
}

/** Returns the dependency-only manifest npm ci is staged with, or null when the head manifest is not an object. */
export function stagedNpmManifest(manifest: unknown): { manifest: Record<string, unknown> | null; unsupported: readonly string[] } {
  if (!record(manifest)) return { manifest: null, unsupported: ["package.json is not a JSON object"] };
  const unsupported = manifest.workspaces === undefined ? [] : ["package.json declares workspaces, which head-install proof does not stage"];
  const staged: Record<string, unknown> = {};
  for (const key of STAGED_MANIFEST_KEYS) if (manifest[key] !== undefined) staged[key] = manifest[key];
  return { manifest: staged, unsupported };
}
