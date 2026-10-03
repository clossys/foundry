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
function declaredVersion(value: unknown, expected: ExactPackage, section: "dependencies" | "devDependencies" = ROOT_DEPENDENCY_SECTION, declaration = expected.version): boolean {
  if (!record(value)) return false;
  const dependencies = record(value[section]) ? value[section] : {};
  return dependencies[expected.name] === declaration;
}

/** Validates npm's root dependency entry and lock-v3 package entry without accepting a range or a borrowed section. */
export function validateNpmIdentity(manifest: unknown, lock: unknown, expected: ExactPackage, placement: "dependencies" | "devDependencies" = ROOT_DEPENDENCY_SECTION, declaration = expected.version): string[] {
  const findings: string[] = [];
  if (!declaredVersion(manifest, expected, placement, declaration)) findings.push(`package.json ${placement} does not declare ${expected.name} at exact ${expected.version}`);
  if (!record(lock) || !record(lock.packages)) return [...findings, "package-lock.json has no packages object"];
  const root = lock.packages[""];
  if (!declaredVersion(root, expected, placement, declaration)) findings.push(`package-lock root ${placement} does not declare ${expected.name} at exact ${expected.version}`);
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
/** The manifest and lock-entry sections that hold dependency specs the registry-spec grammar governs. */
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** A lockfile or manifest refusal. `unsupported` shapes cannot be proved; `violations` are sources the proof forbids. */
export interface NpmHeadSourceFindings {
  readonly violations: readonly string[];
  readonly unsupported: readonly string[];
}

// ---------------------------------------------------------------------------
// Registry-spec grammar (closed, not a deny-list): a dependency spec, an
// overrides value, or an overrides key's suffix is accepted only when it
// matches one of these positive forms. Anything else -- every spelling of a
// git spec, an http(s) URL, file:/link:/workspace:/portal:, a path starting
// with '.', '/' or '~', and an npm: alias whose target is any of those -- is
// refused because it fails to match, never because it is named on a list.
// ---------------------------------------------------------------------------

const PACKAGE_NAME_BODY = "[a-z0-9][a-z0-9._-]*";
const PACKAGE_NAME = `(?:@${PACKAGE_NAME_BODY}\\/${PACKAGE_NAME_BODY}|${PACKAGE_NAME_BODY})`;
const PACKAGE_NAME_RE = new RegExp(`^${PACKAGE_NAME}$`);

const NR = "(?:0|[1-9]\\d*)";
const XR = `(?:x|X|\\*|${NR})`;
const PART = "[-0-9A-Za-z]+";
const PARTS = `${PART}(?:\\.${PART})*`;
const QUALIFIER = `(?:-${PARTS})?(?:\\+${PARTS})?`;
const PARTIAL = `${XR}(?:\\.${XR}(?:\\.${XR}${QUALIFIER})?)?`;
const HYPHEN_RANGE = `${PARTIAL}\\s+-\\s+${PARTIAL}`;
const PRIMITIVE = `(?:<=|>=|<|>|=)\\s*${PARTIAL}`;
const TILDE = `~\\s*${PARTIAL}`;
const CARET = `\\^\\s*${PARTIAL}`;
const SIMPLE = `(?:${PRIMITIVE}|${TILDE}|${CARET}|${PARTIAL})`;
const SIMPLE_SET = `${SIMPLE}(?:\\s+${SIMPLE})*`;
const ONE_RANGE = `(?:${HYPHEN_RANGE}|${SIMPLE_SET})`;
/** A semver version or range: node-semver's range-set grammar (hyphen ranges, comparator sets, and `||`-joined alternatives). */
const RANGE_SET_RE = new RegExp(`^\\s*${ONE_RANGE}(?:\\s*\\|\\|\\s*${ONE_RANGE})*\\s*$`);
/** A dist-tag: a lowercase identifier. It can never start with a digit, `x`/`X`, or `*`, so it never overlaps a version or range. */
const DIST_TAG_RE = /^[a-z][a-z0-9._-]*$/;
const DOLLAR_REFERENCE_RE = new RegExp(`^\\$${PACKAGE_NAME}$`);

const TARBALL_FILENAME_SUFFIX_RE = /\.(?:tgz|tar\.gz|tar)$/i;

function isRegistryVersionSpec(spec: string): boolean {
  if (TARBALL_FILENAME_SUFFIX_RE.test(spec.trim())) return false;
  return RANGE_SET_RE.test(spec) || DIST_TAG_RE.test(spec);
}

/**
 * Splits `name@spec` at the '@' that follows a scope's '/', never the
 * scope's own leading '@'. With no separating '@', the whole value is the
 * name and there is no spec.
 */
function splitNameAndSpec(value: string): { name: string; spec: string | undefined } {
  const searchFrom = value.startsWith("@") ? value.indexOf("/") + 1 : 0;
  if (searchFrom === 0 && value.startsWith("@")) return { name: value, spec: undefined };
  const at = value.indexOf("@", searchFrom);
  return at === -1 ? { name: value, spec: undefined } : { name: value.slice(0, at), spec: value.slice(at + 1) };
}

/**
 * A registry spec: a semver version or range, a dist-tag, or an `npm:` alias
 * naming a valid package name optionally followed by `@<version, range or
 * tag>`. This is the whole grammar the head-install proof accepts; every
 * other spelling -- git, URL, file, link, workspace, portal, and path specs,
 * and an alias whose target is any of those -- fails to match and is refused.
 */
export function isRegistrySpec(spec: string): boolean {
  if (isRegistryVersionSpec(spec)) return true;
  if (!spec.startsWith("npm:")) return false;
  const { name, spec: version } = splitNameAndSpec(spec.slice("npm:".length));
  if (TARBALL_FILENAME_SUFFIX_RE.test(name)) return false;
  return PACKAGE_NAME_RE.test(name) && (version === undefined || isRegistryVersionSpec(version));
}

function isDollarReference(value: string): boolean { return DOLLAR_REFERENCE_RE.test(value); }

/** An `overrides` object key: `.`, a package name, or `<package name>@<registry spec>`. */
function isOverrideKey(key: string): boolean {
  if (key === ".") return true;
  if (PACKAGE_NAME_RE.test(key)) return true;
  const { name, spec } = splitNameAndSpec(key);
  return spec !== undefined && PACKAGE_NAME_RE.test(name) && isRegistrySpec(spec);
}

/** Ordinal-only position label: never a key, a name, or any other head-supplied value. */
function ordinalPosition(indices: readonly number[]): string {
  return indices.length === 0 ? "root" : `entry ${indices.map((index) => `#${index + 1}`).join("/")}`;
}

function overridesViolations(node: unknown, indices: readonly number[], out: string[]): void {
  if (typeof node === "string") {
    if (!isRegistrySpec(node) && !isDollarReference(node)) out.push(`package.json overrides ${ordinalPosition(indices)} value is not a registry spec or a $name reference`);
    return;
  }
  if (!record(node)) { out.push(`package.json overrides ${ordinalPosition(indices)} is neither an object nor a spec string`); return; }
  Object.keys(node).forEach((key, index) => {
    const at = [...indices, index];
    if (!isOverrideKey(key)) out.push(`package.json overrides ${ordinalPosition(at)} key is not ".", a package name, or a name@registry-spec`);
    overridesViolations(node[key], at, out);
  });
}

function dependencySectionViolations(section: unknown, label: string, out: string[]): void {
  if (!record(section)) return;
  Object.values(section).forEach((spec, index) => {
    if (typeof spec !== "string" || !isRegistrySpec(spec)) out.push(`${label} entry #${index + 1} is not a registry dependency spec`);
  });
}

/**
 * Refuses any staged manifest dependency spec, or `overrides` entry, that is
 * not a registry-spec grammar form. Every finding names only its section and
 * ordinal position, never the head-supplied name or spec text.
 */
export function validateNpmManifestSources(manifest: Record<string, unknown> | null): NpmHeadSourceFindings {
  const violations: string[] = [];
  if (manifest !== null) {
    for (const section of DEPENDENCY_SECTIONS) dependencySectionViolations(manifest[section], `package.json ${section}`, violations);
    if (manifest.overrides !== undefined) overridesViolations(manifest.overrides, [], violations);
  }
  return { violations, unsupported: [] };
}

/** The package name a lock entry names: its own `name` field (an alias) when present, else the path segment after the key's last `node_modules/`. */
function entryPackageName(key: string, entry: UnknownRecord): string {
  if (typeof entry.name === "string") return entry.name;
  const marker = "node_modules/";
  return key.slice(key.lastIndexOf(marker) + marker.length);
}

/** Requires the resolved tarball's pathname to be exactly the registry's own path for this entry's name and version -- never merely the right host. */
function registryTarball(resolved: string, registry: URL, name: string, version: string): boolean {
  let url: URL;
  try { url = new URL(resolved); } catch { return false; }
  if (url.protocol !== registry.protocol || url.host !== registry.host || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
  const unscoped = name.slice(name.lastIndexOf("/") + 1);
  return url.pathname === `${registry.pathname}${name}/-/${unscoped}-${version}.tgz`;
}

/**
 * Checks a pull-request head's npm lockfile as data before any install runs.
 * Every installed entry must be a tarball from the one fixed registry, named
 * for its own entry, with a single SHA-512 integrity: git, file, link,
 * directory, other-host, and SHA-1-only entries are refused. Every entry's
 * own dependency maps (and the root entry's devDependencies) must hold only
 * registry specs. Workspaces are unsupported, not guessed. Every finding
 * names its entry only by ordinal position, never by its key.
 */
export function validateNpmLockfileSources(lock: unknown, registry: string = PUBLIC_NPM_REGISTRY): NpmHeadSourceFindings {
  const violations: string[] = []; const unsupported: string[] = [];
  const origin = new URL(registry);
  if (!record(lock) || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !record(lock.packages)) return { violations, unsupported: ["package-lock.json is not a lockfileVersion 2 or 3 document with a packages object"] };
  Object.entries(lock.packages).forEach(([key, entry], index) => {
    const position = `package-lock.json packages entry #${index + 1}`;
    if (key === "") {
      if (!record(entry)) { unsupported.push(`${position} is not an object`); return; }
      if (entry.workspaces !== undefined) unsupported.push("package-lock.json declares workspaces, which head-install proof does not stage");
      dependencySectionViolations(entry.devDependencies, `${position} devDependencies`, violations);
      return;
    }
    if (!key.startsWith("node_modules/") || key.split("/").includes("..")) { unsupported.push(`${position} is not an installed node_modules path`); return; }
    if (!record(entry)) { violations.push(`${position} is not an object`); return; }
    if (entry.link === true) { violations.push(`${position} is a link, not a registry tarball`); return; }
    if (!(entry.inBundle === true && entry.resolved === undefined && entry.integrity === undefined)) {
      const name = entryPackageName(key, entry);
      if (typeof entry.version !== "string" || typeof entry.resolved !== "string" || !registryTarball(entry.resolved, origin, name, entry.version)) violations.push(`${position} does not resolve to a ${origin.origin} tarball named for its own entry`);
      if (typeof entry.integrity !== "string" || !SINGLE_SHA512_SRI.test(entry.integrity)) violations.push(`${position} lacks one SHA-512 integrity`);
    }
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"] as const) dependencySectionViolations(entry[section], `${position} ${section}`, violations);
  });
  if (!Object.hasOwn(lock.packages, "")) unsupported.push("package-lock.json has no root package entry");
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

/** One reason the post-install hidden lockfile does not attest to the head lockfile's own choices. */
export interface HiddenLockfileComparison {
  readonly state: "satisfied" | "violated" | "indeterminate";
  readonly violations: readonly string[];
}

/**
 * Compares npm's own hidden lockfile, `node_modules/.package-lock.json`,
 * written after a real `npm ci`, against the head's `package-lock.json`.
 * Every hidden entry must exist in the head lockfile with an identical
 * version, resolved, and integrity; an extra or differing entry is
 * `violated`. A head entry npm skipped (an optional dependency for another
 * platform) is allowed. A missing or unreadable hidden lockfile is
 * `indeterminate`, never `satisfied`: this proof never treats "could not
 * compare" as "matched".
 */
export function compareHeadHiddenLockfile(headLock: unknown, hiddenLock: unknown): HiddenLockfileComparison {
  if (hiddenLock === null || hiddenLock === undefined) return { state: "indeterminate", violations: [] };
  if (!record(headLock) || !record(headLock.packages) || !record(hiddenLock) || !record(hiddenLock.packages)) return { state: "indeterminate", violations: [] };
  const headEntries = headLock.packages; const hiddenEntries = hiddenLock.packages;
  const violations: string[] = [];
  Object.entries(hiddenEntries).forEach(([key, hiddenEntry], index) => {
    const position = `node_modules/.package-lock.json packages entry #${index + 1}`;
    const headEntry = headEntries[key];
    if (headEntry === undefined) { violations.push(`${position} has no matching head package-lock.json entry`); return; }
    if (!record(headEntry) || !record(hiddenEntry)) { violations.push(`${position} is not an object`); return; }
    if (headEntry.version !== hiddenEntry.version || headEntry.resolved !== hiddenEntry.resolved || headEntry.integrity !== hiddenEntry.integrity) {
      violations.push(`${position} does not match the head lockfile's version, resolved, and integrity`);
    }
  });
  return { state: violations.length > 0 ? "violated" : "satisfied", violations };
}

/** Internal admission comparison: preserve every root identity outside approved declaration writes. */
export function validateNpmCollateralRoots(baseManifest: unknown, baseLock: unknown, headManifest: unknown, headLock: unknown, changed: readonly string[]): boolean {
  if (!record(baseManifest) || !record(headManifest) || !record(baseLock) || !record(baseLock.packages)) return false;
  for (const placement of ["dependencies", "devDependencies"] as const) {
    const declarations=baseManifest[placement];
    if (!record(declarations)) continue;
    for (const [name,literal] of Object.entries(declarations)) {
      if (changed.includes(name)) continue;
      const entry=baseLock.packages[`node_modules/${name}`];
      if (typeof literal !== "string" || !record(entry) || typeof entry.version !== "string" || typeof entry.integrity !== "string") return false;
      if (validateNpmIdentity(headManifest,headLock,{name,version:entry.version,integrity:entry.integrity},placement,literal).length !== 0) return false;
    }
  }
  return true;
}
