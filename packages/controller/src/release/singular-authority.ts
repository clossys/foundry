/**
 * Read-only convergence checking for package identities that a consumer has
 * declared singular. This is deliberately narrower than a duplicate-package
 * detector: ordinary libraries may legitimately have more than one resolved
 * version. A caller supplies both the authority declarations and a frozen
 * npm or pnpm lock; this module never infers operating authority from a name.
 *
 * pnpm is intentionally a bounded reader, not a YAML implementation. It
 * accepts the dependency-bearing portions of pnpm lockfile v9 that it can
 * prove it understands, and returns an indeterminate report for any other
 * shape. A guessed graph is worse than no graph for a release qualification.
 */

import { isExactSemver } from "../internal/semver.js";

export type SingularAuthorityLockfileFormat = "npm" | "pnpm";
export type SingularAuthorityDispositionKind = "override" | "isolated-non-authoritative-helper";
export type SingularAuthorityStatus =
  | "converged"
  | "compatibility-update-required"
  | "override-proof-required"
  | "isolated-helper-disposed"
  | "unresolved-conflict"
  | "indeterminate";

export interface SingularAuthorityDeclaration {
  /** Package identity found in the lockfile. */
  readonly packageName: string;
  /** Consumer-scoped authority identity. Several package names may share one. */
  readonly authority: string;
}

export interface SingularAuthorityTarget {
  /** The authority being migrated or qualified. */
  readonly authority: string;
  /** Exact candidate version expected in the frozen lock. */
  readonly version: string;
}

/**
 * A caller-retained declared range for one exact parsed edge. pnpm v9
 * snapshots retain the resolved target but not every depender's declared
 * semver range, so target qualification requires this evidence where the lock
 * itself cannot supply it. It may never replace a conflicting lock range.
 */
export interface SingularAuthorityDependencyConstraint {
  readonly from: string;
  readonly dependency: string;
  readonly range: string;
  readonly to?: string;
}

export interface SingularAuthorityDisposition {
  /** Authority named by the matching declaration. */
  readonly authority: string;
  /** Exact lockfile node identifier reported by this checker. */
  readonly node: string;
  /** An override is never compatibility proof; an isolated helper is explicitly non-authoritative. */
  readonly kind: SingularAuthorityDispositionKind;
  /** Retained caller-owned evidence or decision reference. Its contents are not authenticated here. */
  readonly reference: string;
}

export interface SingularAuthorityCheckInput {
  readonly lockfile: { readonly format: SingularAuthorityLockfileFormat; readonly content: string };
  readonly declarations: readonly SingularAuthorityDeclaration[];
  /** Required when this is used to qualify a particular candidate migration. */
  readonly target?: SingularAuthorityTarget;
  readonly dependencyConstraints?: readonly SingularAuthorityDependencyConstraint[];
  readonly dispositions?: readonly SingularAuthorityDisposition[];
}

export interface SingularAuthorityEdge {
  readonly from: string;
  readonly dependency: string;
  /** The depender's declared range when the lockfile carries it. */
  readonly range?: string;
  readonly to: string;
}

export interface SingularAuthorityResolvedVersion {
  readonly node: string;
  readonly packageName: string;
  readonly version: string;
  /** Every resolved edge that introduced this installed copy. */
  readonly introducedBy: readonly SingularAuthorityEdge[];
}

export interface SingularAuthorityFinding {
  readonly code: string;
  readonly message: string;
}

export interface SingularAuthorityResult {
  readonly authority: string;
  readonly status: SingularAuthorityStatus;
  readonly ok: boolean;
  readonly resolved: readonly SingularAuthorityResolvedVersion[];
  readonly findings: readonly SingularAuthorityFinding[];
}

export interface SingularAuthorityReport {
  /** True only for a compatible single version or explicitly isolated helper copies. */
  readonly ok: boolean;
  readonly results: readonly SingularAuthorityResult[];
  readonly findings: readonly SingularAuthorityFinding[];
}

/**
 * Reads the intentionally small manifest declaration. `undefined` means the
 * package makes no singular-authority claim; malformed declarations throw so
 * a caller collecting exact candidate manifests cannot accidentally omit one.
 */
export function singularAuthorityDeclarationFromManifest(manifest: unknown): SingularAuthorityDeclaration | undefined {
  if (!record(manifest) || !text(manifest.name) || !PACKAGE_NAME.test(manifest.name)) {
    throw new TypeError("manifest needs a valid package name");
  }
  if (manifest.foundry === undefined) return undefined;
  if (!record(manifest.foundry) || manifest.foundry.singularAuthority === undefined) return undefined;
  if (!text(manifest.foundry.singularAuthority) || !IDENTIFIER.test(manifest.foundry.singularAuthority)) {
    throw new TypeError("foundry.singularAuthority must be a lowercase authority identifier");
  }
  return { packageName: manifest.name, authority: manifest.foundry.singularAuthority };
}

interface Node {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  /** Exact pnpm resolved value, including a validated peer-context suffix. */
  readonly resolved: string;
  readonly dependencies: ReadonlyMap<string, string | undefined>;
}

interface Graph {
  readonly nodes: readonly Node[];
  readonly edges: readonly SingularAuthorityEdge[];
  /** Dependencies that the bounded lock reader could not bind to exactly one node. */
  readonly unresolved: readonly (SingularAuthorityEdge & { readonly detail: string })[];
}

const IDENTIFIER = /^[a-z][a-z0-9-]{0,127}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string { return typeof value === "string" && value.trim() === value && value.length > 0; }

function packageNameForNpmPath(path: string): string | undefined {
  const marker = "/node_modules/";
  const start = path.lastIndexOf(marker);
  const tail = start === -1 ? (path.startsWith("node_modules/") ? path.slice("node_modules/".length) : "") : path.slice(start + marker.length);
  if (!tail) return undefined;
  const pieces = tail.split("/");
  return pieces[0]?.startsWith("@") ? pieces.slice(0, 2).join("/") : pieces[0];
}

function npmTarget(parent: string, dependency: string, nodes: ReadonlyMap<string, Node>): string | undefined {
  let current = parent === "root" ? "" : parent;
  for (;;) {
    const candidate = `${current ? `${current}/` : ""}node_modules/${dependency}`;
    if (nodes.has(candidate)) return candidate;
    const up = current.lastIndexOf("/node_modules/");
    if (up === -1) {
      if (current.startsWith("node_modules/")) { current = ""; continue; }
      return undefined;
    }
    current = current.slice(0, up);
  }
}

const NPM_DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

function npmDependencies(
  raw: Record<string, unknown>,
  path: string,
  sections: readonly string[],
  findings: SingularAuthorityFinding[],
): Map<string, string | undefined> {
  const dependencies = new Map<string, string | undefined>();
  for (const section of sections) {
    if (raw[section] === undefined) continue;
    if (!record(raw[section])) { findings.push({ code: "lockfile-unsupported", message: `npm ${path} ${section} must be an object` }); continue; }
    for (const [name, range] of Object.entries(raw[section])) {
      if (!text(range)) { findings.push({ code: "lockfile-unsupported", message: `npm ${path} ${section} dependency ${name} has no string range` }); continue; }
      const previous = dependencies.get(name);
      if (previous !== undefined && previous !== range) {
        findings.push({ code: "lockfile-unsupported", message: `npm ${path} declares ${name} inconsistently in dependency sections (${previous} and ${range})` });
        continue;
      }
      dependencies.set(name, range);
    }
  }
  return dependencies;
}

/** Merge all root dependency sections: a development-only consumer still introduces an authority copy. */
function npmRootDependencies(raw: Record<string, unknown>, findings: SingularAuthorityFinding[]): Map<string, string | undefined> {
  return npmDependencies(raw, "root", NPM_DEPENDENCY_SECTIONS, findings);
}

/** Optional and peer dependencies on an installed npm package can introduce the same authority too. */
function npmPackageDependencies(raw: Record<string, unknown>, path: string, findings: SingularAuthorityFinding[]): Map<string, string | undefined> {
  return npmDependencies(raw, path, ["dependencies", "optionalDependencies", "peerDependencies"], findings);
}

function parseNpm(content: string): Graph | SingularAuthorityFinding[] {
  let lock: unknown;
  try { lock = JSON.parse(content); } catch (error) { return [{ code: "lockfile-invalid", message: `npm lockfile is not valid JSON: ${String(error)}` }]; }
  if (!record(lock) || !record(lock.packages)) return [{ code: "lockfile-unsupported", message: "npm lockfile must have a packages object (lockfile v2 or v3)" }];
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) return [{ code: "lockfile-unsupported", message: "npm lockfileVersion must be exactly 2 or 3" }];
  const nodes = new Map<string, Node>();
  const findings: SingularAuthorityFinding[] = [];
  for (const [path, raw] of Object.entries(lock.packages)) {
    if (path === "") continue;
    if (!record(raw)) { findings.push({ code: "lockfile-unsupported", message: `npm package entry ${path} is not an object` }); continue; }
    const packageName = packageNameForNpmPath(path);
    if (!packageName || !text(raw.version) || !isExactSemver(raw.version)) {
      findings.push({ code: "lockfile-unsupported", message: `npm package entry ${path} needs a node_modules package name and exact version` });
      continue;
    }
    const dependencies = npmPackageDependencies(raw, `package entry ${path}`, findings);
    nodes.set(path, { id: path, packageName, version: raw.version, resolved: raw.version, dependencies });
  }
  if (findings.length > 0) return findings;
  const all = new Map(nodes);
  const root = lock.packages[""];
  if (!record(root)) return [{ code: "lockfile-unsupported", message: "npm lockfile must have an object root package entry" }];
  const rootDependencies = npmRootDependencies(root, findings);
  if (findings.length > 0) return findings;
  all.set("root", { id: "root", packageName: "<root>", version: "0.0.0", resolved: "0.0.0", dependencies: rootDependencies });
  const edges: SingularAuthorityEdge[] = [];
  const unresolved: (SingularAuthorityEdge & { detail: string })[] = [];
  for (const node of all.values()) {
    for (const [dependency, range] of node.dependencies) {
      const target = npmTarget(node.id, dependency, all);
      if (!target) { unresolved.push({ from: node.id, dependency, range, to: "", detail: "no matching npm node_modules resolution" }); continue; }
      edges.push({ from: node.id, dependency, range, to: target });
    }
  }
  return { nodes: [...nodes.values()], edges, unresolved };
}

function unquote(key: string): string {
  const trimmed = key.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.slice(1, -1);
  return trimmed;
}

function yamlPair(line: string): [string, string] | undefined {
  const colon = line.indexOf(":");
  if (colon < 1) return undefined;
  return [unquote(line.slice(0, colon)), line.slice(colon + 1).trim()];
}

const MAX_PNPM_PEER_SUFFIX_LENGTH = 65_536;

function validPeerAtom(value: string): boolean {
  const separator = value.lastIndexOf("@");
  return separator > 0 && PACKAGE_NAME.test(value.slice(0, separator)) && isExactSemver(value.slice(separator + 1));
}

/** Finds one already-validated context boundary without recursion or backtracking. */
function peerContextEnd(value: string, start: number): number | undefined {
  if (value[start] !== "(" || value.length - start > MAX_PNPM_PEER_SUFFIX_LENGTH) return undefined;
  let cursor = start;
  let depth = 0;
  while (cursor < value.length) {
    if (value[cursor] === "(") {
      depth += 1;
      const atomStart = ++cursor;
      while (cursor < value.length && value[cursor] !== "(" && value[cursor] !== ")") cursor += 1;
      if (!validPeerAtom(value.slice(atomStart, cursor))) return undefined;
      continue;
    }
    if (value[cursor] !== ")" || depth === 0) return undefined;
    depth -= 1;
    cursor += 1;
    if (depth === 0) return cursor;
  }
  return undefined;
}

/**
 * pnpm peer suffixes are a recursive grammar, not arbitrary balanced text.
 * An atom may contain nested peer-context groups; anything after a completed
 * group is another group or invalid, never ignored suffix junk.
 */
function validPeerContextSuffix(value: string): boolean {
  if (!value.startsWith("(") || value.length > MAX_PNPM_PEER_SUFFIX_LENGTH) return false;
  let cursor = 0;
  let depth = 0;
  while (cursor < value.length) {
    if (value[cursor] === "(") {
      depth += 1;
      const atomStart = ++cursor;
      while (cursor < value.length && value[cursor] !== "(" && value[cursor] !== ")") cursor += 1;
      if (!validPeerAtom(value.slice(atomStart, cursor))) return false;
      continue;
    }
    if (value[cursor] !== ")" || depth === 0) return false;
    depth -= 1;
    cursor += 1;
  }
  return depth === 0;
}

type PnpmVersion = { readonly version?: string; readonly resolved?: string; readonly error?: string };

/** Returns exact semver plus a fully valid peer suffix, never a silently stripped suffix. */
function pnpmVersion(value: string): PnpmVersion {
  const candidate = unquote(value);
  const peerStart = candidate.indexOf("(");
  const version = peerStart === -1 ? candidate : candidate.slice(0, peerStart);
  const suffix = peerStart === -1 ? "" : candidate.slice(peerStart);
  if (!isExactSemver(version)) return { error: `invalid exact version ${candidate}` };
  if (suffix && !validPeerContextSuffix(suffix)) return { error: `invalid peer-context suffix ${suffix}` };
  return { version, resolved: candidate };
}

type PnpmIdentity = { readonly packageName: string; readonly version: string; readonly resolved: string };

function pnpmNameVersion(locator: string): { readonly identity?: PnpmIdentity; readonly error?: string } {
  const clean = unquote(locator);
  const peerStart = clean.indexOf("(");
  const base = peerStart === -1 ? clean : clean.slice(0, peerStart);
  const suffix = peerStart === -1 ? "" : clean.slice(peerStart);
  const separator = base.lastIndexOf("@");
  if (separator < 1) {
    return clean.includes("(") || /@\d/.test(clean) ? { error: `unsupported package locator ${clean}` } : {};
  }
  const packageName = base.slice(0, separator);
  const version = base.slice(separator + 1);
  if (!PACKAGE_NAME.test(packageName) || !isExactSemver(version)) return { error: `invalid package locator ${clean}` };
  if (suffix && !validPeerContextSuffix(suffix)) return { error: `invalid peer-context suffix ${suffix}` };
  return { identity: { packageName, version, resolved: `${version}${suffix}` } };
}

/** Exact peer targets carried by one validated pnpm snapshot peer suffix. */
function peerContextBindings(suffix: string): ReadonlyMap<string, string> | undefined {
  if (!suffix) return new Map();
  if (!validPeerContextSuffix(suffix)) return undefined;
  const bindings = new Map<string, string>();
  let cursor = 0;
  while (cursor < suffix.length) {
    const contextStart = cursor;
    const atomStart = cursor + 1;
    cursor = atomStart;
    while (cursor < suffix.length && suffix[cursor] !== "(" && suffix[cursor] !== ")") cursor += 1;
    const atom = suffix.slice(atomStart, cursor);
    const nestedStart = cursor;
    while (suffix[cursor] === "(") {
      const nested = peerContextEnd(suffix, cursor);
      if (nested === undefined) return undefined;
      cursor = nested;
    }
    if (suffix[cursor] !== ")") return undefined;
    const identity = pnpmNameVersion(`${atom}${suffix.slice(nestedStart, cursor)}`);
    if (!identity.identity || identity.error || bindings.has(identity.identity.packageName)) return undefined;
    bindings.set(identity.identity.packageName, identity.identity.resolved);
    const end = peerContextEnd(suffix, contextStart);
    if (end === undefined) return undefined;
    cursor = end;
  }
  return bindings;
}

/** Reads only pnpm v9's importers/packages/snapshots dependency maps. */
function parsePnpm(content: string): Graph | SingularAuthorityFinding[] {
  const lines = content.split(/\r?\n/);
  const versionLine = lines.find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const versionPair = versionLine ? yamlPair(versionLine.trim()) : undefined;
  if (!versionPair || versionPair[0] !== "lockfileVersion" || unquote(versionPair[1]) !== "9.0") {
    return [{ code: "lockfile-unsupported", message: "pnpm lockfileVersion must be exactly 9.0" }];
  }
  let section = "";
  let lockfileVersionCount = 0;
  let nodeKey: string | undefined;
  let dependencyKind = "";
  let dependencyName: string | undefined;
  /** Non-dependency metadata has no graph edge. Package peerDependencies are parsed separately. */
  let ignoredMetadataIndent: number | undefined;
  const importers = new Map<string, Map<string, { range?: string; resolved?: string }>>();
  // pnpm v9's packages section is resolution metadata. When snapshots is
  // present, snapshots names installed graph nodes and must not be merged
  // with packages as a second copy of each same base version.
  const packageDependencies = new Map<string, Map<string, string | undefined>>();
  const packagePeerDependencies = new Map<string, Map<string, string>>();
  const snapshotDependencies = new Map<string, Map<string, string | undefined>>();
  const findings: SingularAuthorityFinding[] = [];

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (ignoredMetadataIndent !== undefined) {
      if (indent > ignoredMetadataIndent) continue;
      ignoredMetadataIndent = undefined;
    }
    const pair = yamlPair(raw.trim());
    if (!pair) {
      findings.push({ code: "lockfile-unsupported", message: `pnpm lockfile has unsupported YAML syntax: ${raw.trim()}` });
      continue;
    }
    const [key, value] = pair;
    if (indent === 0) {
      if (key === "lockfileVersion") {
        lockfileVersionCount += 1;
        if (lockfileVersionCount > 1) findings.push({ code: "lockfile-unsupported", message: "pnpm lockfileVersion is declared more than once" });
      }
      section = key; nodeKey = undefined; dependencyKind = ""; dependencyName = undefined; ignoredMetadataIndent = undefined; continue;
    }
    if ((section === "importers" || section === "packages" || section === "snapshots") && indent === 2 && (value === "" || value === "{}")) {
      nodeKey = key; dependencyKind = ""; dependencyName = undefined; ignoredMetadataIndent = undefined;
      if (section === "importers") {
        if (importers.has(key)) findings.push({ code: "lockfile-unsupported", message: `pnpm importer ${key} is declared more than once` });
        else importers.set(key, new Map());
      } else {
        const entries = section === "snapshots" ? snapshotDependencies : packageDependencies;
        if (entries.has(key)) findings.push({ code: "lockfile-unsupported", message: `pnpm ${section} entry ${key} is declared more than once` });
        else {
          entries.set(key, new Map());
          if (section === "packages") packagePeerDependencies.set(key, new Map());
        }
      }
      continue;
    }
    if (!nodeKey) continue;
    if (indent === 4) {
      dependencyName = undefined;
      if (key === "dependencies" || key === "devDependencies" || key === "optionalDependencies" || (section === "packages" && key === "peerDependencies")) {
        dependencyKind = key;
      } else {
        dependencyKind = "";
        ignoredMetadataIndent = indent;
      }
      continue;
    }
    if (!dependencyKind) continue;
    if (indent === 6) {
      dependencyName = key;
      if (section === "importers") {
        const target = importers.get(nodeKey)!;
        if (target.has(key)) findings.push({ code: "lockfile-unsupported", message: `pnpm importer ${nodeKey} dependency ${key} is declared more than once` });
        if (value) {
          const parsedVersion = pnpmVersion(value);
          if (parsedVersion.error) findings.push({ code: "lockfile-unsupported", message: `pnpm importer ${nodeKey} dependency ${key} has ${parsedVersion.error}` });
          target.set(key, { range: value, resolved: parsedVersion.resolved });
        }
        else target.set(key, {});
      } else if (section === "packages" && dependencyKind === "peerDependencies") {
        const range = unquote(value);
        const peers = packagePeerDependencies.get(nodeKey)!;
        if (!text(range)) findings.push({ code: "lockfile-unsupported", message: `pnpm package ${nodeKey} peer dependency ${key} has no string range` });
        else if (peers.has(key)) findings.push({ code: "lockfile-unsupported", message: `pnpm package ${nodeKey} peer dependency ${key} is declared more than once` });
        else peers.set(key, range);
      } else if (value) {
        const parsedVersion = pnpmVersion(value);
        if (parsedVersion.error) findings.push({ code: "lockfile-unsupported", message: `pnpm package ${nodeKey} dependency ${key} has ${parsedVersion.error}` });
        const entries = section === "snapshots" ? snapshotDependencies : packageDependencies;
        if (entries.get(nodeKey)!.has(key)) findings.push({ code: "lockfile-unsupported", message: `pnpm package ${nodeKey} dependency ${key} is declared more than once` });
        entries.get(nodeKey)!.set(key, parsedVersion.resolved);
      }
      continue;
    }
    if (section === "importers" && indent === 8 && dependencyName && (key === "specifier" || key === "version")) {
      const target = importers.get(nodeKey)!.get(dependencyName) ?? {};
      if (key === "specifier") target.range = value;
      else {
        const parsedVersion = pnpmVersion(value);
        if (parsedVersion.error) findings.push({ code: "lockfile-unsupported", message: `pnpm importer ${nodeKey} dependency ${dependencyName} has ${parsedVersion.error}` });
        else target.resolved = parsedVersion.resolved;
      }
      importers.get(nodeKey)!.set(dependencyName, target);
    }
  }
  if (findings.length > 0) return findings;
  const installedEntries = snapshotDependencies.size > 0 ? snapshotDependencies : packageDependencies;
  const nodes: Node[] = [];
  for (const [locator, dependencies] of installedEntries) {
    const parsedIdentity = pnpmNameVersion(locator);
    if (parsedIdentity.error) { findings.push({ code: "lockfile-unsupported", message: `pnpm package entry has ${parsedIdentity.error}` }); continue; }
    if (!parsedIdentity.identity) continue; // package metadata keys such as "file:" are not resolvable package authorities.
    nodes.push({ id: `pnpm:${locator}`, ...parsedIdentity.identity, dependencies });
  }
  if (nodes.length === 0) return [{ code: "lockfile-unsupported", message: "pnpm lockfile has no exact-version package or snapshot entries this checker understands" }];
  const byNameResolved = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = `${node.packageName}\u0000${node.resolved}`;
    byNameResolved.set(key, [...(byNameResolved.get(key) ?? []), node]);
  }
  const targetFor = (name: string, resolved: string | undefined): { readonly node?: Node; readonly detail?: string } => {
    if (!resolved) return { detail: "no exact resolved version" };
    const matches = byNameResolved.get(`${name}\u0000${resolved}`) ?? [];
    if (matches.length === 1) return { node: matches[0] };
    return { detail: matches.length === 0 ? `no snapshot for ${name}@${resolved}` : `ambiguous snapshots for ${name}@${resolved}` };
  };
  const edges: SingularAuthorityEdge[] = [];
  const unresolved: (SingularAuthorityEdge & { detail: string })[] = [];
  for (const [importer, dependencies] of importers) for (const [dependency, detail] of dependencies) {
    const target = targetFor(dependency, detail.resolved);
    if (target.node) edges.push({ from: `pnpm-importer:${importer}`, dependency, range: detail.range, to: target.node.id });
    else unresolved.push({ from: `pnpm-importer:${importer}`, dependency, range: detail.range, to: "", detail: target.detail! });
  }
  for (const node of nodes) for (const [dependency, version] of node.dependencies) {
    const target = targetFor(dependency, version);
    if (target.node) edges.push({ from: node.id, dependency, to: target.node.id });
    else unresolved.push({ from: node.id, dependency, to: "", detail: target.detail! });
  }
  for (const node of nodes) {
    const locator = node.id.slice("pnpm:".length);
    const peerStart = locator.indexOf("(");
    const peers = packagePeerDependencies.get(peerStart === -1 ? locator : locator.slice(0, peerStart));
    const bindings = peerContextBindings(peerStart === -1 ? "" : locator.slice(peerStart));
    for (const [dependency, resolved] of bindings ?? []) if (!peers?.has(dependency)) {
      unresolved.push({ from: node.id, dependency, to: "", detail: `snapshot peer context resolves ${dependency}@${resolved}, but packages metadata declares no matching peer dependency` });
    }
    for (const [dependency, range] of peers ?? []) {
      const resolved = bindings?.get(dependency);
      const target = targetFor(dependency, resolved);
      if (target.node) edges.push({ from: node.id, dependency, range, to: target.node.id });
      else unresolved.push({ from: node.id, dependency, range, to: "", detail: bindings === undefined ? "invalid or ambiguous peer-context binding" : `no exact peer-context binding for ${dependency}: ${target.detail}` });
    }
  }
  return { nodes, edges, unresolved };
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/**
 * Strictly bounded to exact, ^x.y.z and ~x.y.z ranges. Prerelease/build
 * targets intentionally return indeterminate: this checker does not recreate
 * npm's prerelease admission rules from a partial semver implementation.
 */
function satisfies(version: string, range: string): boolean | undefined {
  const target = parseVersion(version);
  const match = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!target || !match) return undefined;
  const prefix = match[1] ?? "";
  const lower: [number, number, number] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const upper: [number, number, number] = prefix === ""
    ? [lower[0], lower[1], lower[2] + 1]
    : prefix === "~"
      ? [lower[0], lower[1] + 1, 0]
      : lower[0] > 0
        ? [lower[0] + 1, 0, 0]
        : lower[1] > 0
          ? [0, lower[1] + 1, 0]
          : [0, 0, lower[2] + 1];
  const compare = (a: readonly number[], b: readonly number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  return compare(target, lower) >= 0 && compare(target, upper) < 0;
}

function inputFindings(input: SingularAuthorityCheckInput): SingularAuthorityFinding[] {
  const findings: SingularAuthorityFinding[] = [];
  if (!input || typeof input.lockfile?.content !== "string" || input.lockfile.content.trim().length === 0 || (input.lockfile?.format !== "npm" && input.lockfile?.format !== "pnpm")) findings.push({ code: "input-invalid", message: "lockfile needs a supported format and nonempty content" });
  if (!Array.isArray(input?.declarations) || input.declarations.length === 0) findings.push({ code: "input-invalid", message: "at least one singular-authority declaration is required" });
  const declarations: readonly unknown[] = Array.isArray(input?.declarations) ? input.declarations : [];
  const declaredPackages = new Map<string, string>();
  for (const declaration of declarations) {
    if (!record(declaration) || !text(declaration.packageName) || !text(declaration.authority) || !PACKAGE_NAME.test(declaration.packageName) || !IDENTIFIER.test(declaration.authority)) {
      findings.push({ code: "input-invalid", message: "each declaration needs a package name and lowercase authority identifier" });
      continue;
    }
    const previous = declaredPackages.get(declaration.packageName);
    if (previous !== undefined) {
      findings.push({ code: previous === declaration.authority ? "declaration-duplicate" : "declaration-conflict", message: `package ${declaration.packageName} has more than one singular-authority declaration` });
    } else declaredPackages.set(declaration.packageName, declaration.authority);
  }
  if (input?.target !== undefined) {
    if (!record(input.target) || !text(input.target.authority) || !IDENTIFIER.test(input.target.authority) || !text(input.target.version) || !isExactSemver(input.target.version)) {
      findings.push({ code: "input-invalid", message: "target needs a declared authority and exact semver version" });
    } else if (![...declaredPackages.values()].includes(input.target.authority)) {
      findings.push({ code: "target-undeclared", message: `target authority ${input.target.authority} has no singular-authority declaration` });
    }
  }
  const constraints: readonly unknown[] = Array.isArray(input?.dependencyConstraints) ? input.dependencyConstraints : [];
  if (input?.dependencyConstraints !== undefined && !Array.isArray(input.dependencyConstraints)) findings.push({ code: "input-invalid", message: "dependencyConstraints must be an array" });
  const constraintSelectors = new Map<string, string>();
  for (const constraint of constraints) {
    if (!record(constraint) || !text(constraint.from) || !text(constraint.dependency) || !text(constraint.range) || (constraint.to !== undefined && !text(constraint.to))) {
      findings.push({ code: "input-invalid", message: "each dependency constraint needs exact from, dependency, range, and optional to fields" });
      continue;
    }
    const selector = `${constraint.from}\u0000${constraint.dependency}\u0000${constraint.to ?? ""}`;
    const previous = constraintSelectors.get(selector);
    if (previous !== undefined) findings.push({ code: previous === constraint.range ? "constraint-duplicate" : "constraint-conflict", message: `dependency constraint ${constraint.from} -> ${constraint.dependency} is declared more than once` });
    else constraintSelectors.set(selector, constraint.range);
  }
  const dispositions: readonly unknown[] = Array.isArray(input?.dispositions) ? input.dispositions : [];
  if (input?.dispositions !== undefined && !Array.isArray(input.dispositions)) findings.push({ code: "input-invalid", message: "dispositions must be an array" });
  for (const disposition of dispositions) if (!record(disposition) || !text(disposition.authority) || !IDENTIFIER.test(disposition.authority) || !text(disposition.node) || !text(disposition.reference) || (disposition.kind !== "override" && disposition.kind !== "isolated-non-authoritative-helper")) findings.push({ code: "input-invalid", message: "each disposition needs authority, reported node, supported kind, and retained reference" });
  return findings;
}

function effectiveRanges(
  edges: readonly SingularAuthorityEdge[],
  constraints: readonly SingularAuthorityDependencyConstraint[] | undefined,
): { readonly ranges: ReadonlyMap<SingularAuthorityEdge, string | undefined>; readonly findings: readonly SingularAuthorityFinding[] } {
  const ranges = new Map<SingularAuthorityEdge, string | undefined>(edges.map((edge) => [edge, edge.range]));
  const findings: SingularAuthorityFinding[] = [];
  for (const constraint of constraints ?? []) {
    const matches = edges.filter((edge) => edge.from === constraint.from && edge.dependency === constraint.dependency && (constraint.to === undefined || edge.to === constraint.to));
    if (matches.length !== 1) {
      findings.push({ code: matches.length === 0 ? "constraint-unmatched" : "constraint-ambiguous", message: `constraint ${constraint.from} -> ${constraint.dependency} matched ${matches.length} parsed edges` });
      continue;
    }
    const edge = matches[0]!;
    if (edge.range !== undefined && edge.range !== constraint.range) {
      findings.push({ code: "constraint-lock-conflict", message: `constraint ${constraint.from} -> ${constraint.dependency} (${constraint.range}) conflicts with lock-carried range ${edge.range}` });
      continue;
    }
    const previous = ranges.get(edge);
    if (previous !== undefined && previous !== constraint.range) {
      findings.push({ code: "constraint-conflict", message: `multiple constraints supply conflicting ranges for ${constraint.from} -> ${constraint.dependency}` });
      continue;
    }
    ranges.set(edge, constraint.range);
  }
  return { ranges, findings };
}

function indeterminate(authority: string, finding: SingularAuthorityFinding): SingularAuthorityResult {
  return { authority, status: "indeterminate", ok: false, resolved: [], findings: [finding] };
}

/**
 * Checks a frozen consumer lock graph. It judges only graph convergence and
 * declarations: retained references and claimed helper isolation are not
 * executable compatibility proof, so overrides always remain indeterminate.
 */
export function checkSingularAuthority(input: SingularAuthorityCheckInput): SingularAuthorityReport {
  const validation = inputFindings(input);
  if (validation.length > 0) return { ok: false, results: [], findings: validation };
  const parsed = input.lockfile.format === "npm" ? parseNpm(input.lockfile.content) : parsePnpm(input.lockfile.content);
  if (Array.isArray(parsed)) return { ok: false, results: [], findings: parsed };
  const effective = effectiveRanges(parsed.edges, input.dependencyConstraints);
  if (effective.findings.length > 0) return { ok: false, results: [], findings: effective.findings };
  const authorityNames = new Map<string, Set<string>>();
  for (const declaration of input.declarations) authorityNames.set(declaration.authority, new Set([...(authorityNames.get(declaration.authority) ?? []), declaration.packageName]));
  const incoming = new Map<string, SingularAuthorityEdge[]>();
  for (const edge of parsed.edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  const results: SingularAuthorityResult[] = [];
  // A target supplies candidate-range evidence for one authority only. Every
  // declared authority still contributes to the report, so an unrelated
  // undisposed duplicate cannot be hidden by qualifying the selected target.
  const requested = [...authorityNames.keys()].sort();

  for (const authority of requested) {
    const names = authorityNames.get(authority);
    if (!names) { results.push(indeterminate(authority, { code: "target-undeclared", message: `target authority ${authority} has no declaration` })); continue; }
    const copies = parsed.nodes.filter((node) => names.has(node.packageName));
    const unresolved = parsed.unresolved.filter((edge) => names.has(edge.dependency));
    if (unresolved.length > 0) {
      results.push({ authority, status: "indeterminate", ok: false, resolved: copies.map((node) => ({ node: node.id, packageName: node.packageName, version: node.version, introducedBy: incoming.get(node.id) ?? [] })), findings: unresolved.map((edge) => ({ code: "introducing-edge-unresolved", message: `${edge.from} -> ${edge.dependency} could not be bound: ${edge.detail}` })) });
      continue;
    }
    if (copies.length === 0) { results.push(indeterminate(authority, { code: "authority-not-resolved", message: `no declared ${authority} package is resolved in the supplied lockfile` })); continue; }
    const resolved = copies.map((node) => ({ node: node.id, packageName: node.packageName, version: node.version, introducedBy: incoming.get(node.id) ?? [] }));
    const findings: SingularAuthorityFinding[] = [];
    for (const item of resolved) if (item.introducedBy.length === 0) {
      findings.push({ code: "introducing-edge-missing", message: `${item.node} resolves ${item.packageName}@${item.version}, but the supplied lock graph has no introducing edge for it` });
    }
    if (findings.length > 0) { results.push({ authority, status: "indeterminate", ok: false, resolved, findings }); continue; }
    const target = input.target?.authority === authority ? input.target : undefined;
    if (target && !copies.some((node) => node.version === target.version)) {
      results.push({ authority, status: "indeterminate", ok: false, resolved, findings: [{ code: "target-not-resolved", message: `${authority}@${target.version} is not present in the frozen lockfile` }] });
      continue;
    }
    const dispositions = (input.dispositions ?? []).filter((item) => item.authority === authority);
    const helpers = new Set(dispositions.filter((item) => item.kind === "isolated-non-authoritative-helper").map((item) => item.node));
    const overrides = dispositions.filter((item) => item.kind === "override");
    for (const disposition of dispositions) if (!copies.some((node) => node.id === disposition.node)) findings.push({ code: "disposition-node-missing", message: `${disposition.kind} disposition names ${disposition.node}, which is not a resolved ${authority} copy` });
    if (target && copies.some((node) => node.version === target.version && helpers.has(node.id))) findings.push({ code: "target-helper-disposition", message: `the requested ${authority}@${target.version} copy cannot be disposed as a helper` });
    if (findings.length > 0) { results.push({ authority, status: "indeterminate", ok: false, resolved, findings }); continue; }
    const incompatible: SingularAuthorityEdge[] = [];
    if (target) for (const edge of parsed.edges) {
      if (!names.has(edge.dependency) || helpers.has(edge.to)) continue;
      const range = effective.ranges.get(edge);
      if (!range) { findings.push({ code: "range-missing", message: `${edge.from} introduces ${edge.to} through ${edge.dependency}, but target qualification has no declared compatibility range for that edge` }); continue; }
      const compatible = satisfies(target.version, range);
      if (compatible === undefined) findings.push({ code: "range-unsupported", message: `${edge.from} declares ${edge.dependency}@${range}; this bounded checker cannot compare that range` });
      else if (!compatible) incompatible.push(edge);
    }
    if (findings.length > 0) { results.push({ authority, status: "indeterminate", ok: false, resolved, findings }); continue; }
    if (overrides.length > 0) {
      results.push({ authority, status: "override-proof-required", ok: false, resolved, findings: [{ code: "override-proof-required", message: `override disposition(s) for ${authority} retain a reference but require executable compatibility proof before convergence can pass` }, ...incompatible.map((edge) => ({ code: "target-out-of-range", message: `${edge.from} introduces ${edge.to} through ${edge.dependency}@${effective.ranges.get(edge)}, which excludes target ${target?.version}` }))] });
      continue;
    }
    const authoritativeVersions = new Set(copies.filter((node) => !helpers.has(node.id)).map((node) => node.version));
    if (incompatible.length > 0) {
      results.push({ authority, status: "compatibility-update-required", ok: false, resolved, findings: incompatible.map((edge) => ({ code: "target-out-of-range", message: `${edge.from} introduces ${edge.to} through ${edge.dependency}@${effective.ranges.get(edge)}, which excludes target ${target?.version}; update the depender before adoption` })) });
      continue;
    }
    if (authoritativeVersions.size === 1 && helpers.size === 0) {
      results.push({ authority, status: "converged", ok: true, resolved, findings: [] });
    } else if (authoritativeVersions.size === 1 && helpers.size > 0) {
      results.push({ authority, status: "isolated-helper-disposed", ok: true, resolved, findings: [{ code: "isolated-helper-disposed", message: `${helpers.size} explicitly non-authoritative helper copy/copies are disposed by caller-supplied references; this is not an executable isolation proof` }] });
    } else {
      results.push({ authority, status: "unresolved-conflict", ok: false, resolved, findings: [{ code: "duplicate-authority", message: `${authority} resolves to ${[...authoritativeVersions].sort().join(", ")} without a bounded disposition` }] });
    }
  }
  return { ok: results.length > 0 && results.every((result) => result.ok), results, findings: [] };
}
