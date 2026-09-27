import type { DependencyPlacement } from "./change-set-contract.js";
import { compareCodeUnits } from "./change-set-contract.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import type { LockfileEntry, LockfileFormat, LockfileUnreadableReason, LockfileView, RootDependency } from "./lockfile-readers.js";
import { isUnreadable, readLockfile } from "./lockfile-readers.js";

export type LockfileInvariantId = "I1" | "I2" | "I3" | "I4" | "I5";

/** One approved package the regenerated lockfile must resolve exactly. */
export interface LockfileInvariantPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly placement: DependencyPlacement;
}

export interface LockfileInvariantInput {
  readonly format: LockfileFormat;
  readonly base: string;
  readonly regenerated: string;
  readonly packages: readonly LockfileInvariantPackage[];
  /** Defaults to PACKAGE_SCOPE. */
  readonly publishing?: { readonly scope: string; readonly registry: string };
}

export interface LockfileInvariantViolation {
  readonly invariant: LockfileInvariantId;
  /** The package name this violation is about; "" for I4, whose violation is about the lockfile format as a whole, not one package. */
  readonly name: string;
}

export interface TransitiveCounts {
  /** `name@version` present after and not before. */
  readonly added: number;
  /** `name@version` present before and not after. */
  readonly removed: number;
}

export type LockfileInvariantResult =
  | { readonly verdict: "satisfied"; readonly violations: readonly []; readonly transitive: TransitiveCounts }
  | { readonly verdict: "violated"; readonly violations: readonly LockfileInvariantViolation[]; readonly transitive: TransitiveCounts }
  | { readonly verdict: "indeterminate"; readonly reason: LockfileUnreadableReason; readonly side: "base" | "regenerated" };

const LAST_RESORT: LockfileInvariantResult = { verdict: "indeterminate", reason: "lockfile-unreadable", side: "regenerated" };

function entryKey(name: string, version: string): string {
  return `${name}\u0000${version}`;
}

/**
 * Every distinct `name@version` in `entries`, as `entryKey` strings. A versionless npm link entry (fix 7)
 * is never a `name@version` and is excluded here; I5 inspects link entries separately, by key.
 */
function entryKeySet(entries: readonly LockfileEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) if (entry.version !== null) keys.add(entryKey(entry.name, entry.version));
  return keys;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/** `added`/`removed` distinct `name@version` between the two entry lists. Counted, never refused. */
function computeTransitiveCounts(base: LockfileView, regenerated: LockfileView): TransitiveCounts {
  const baseKeys = entryKeySet(base.entries);
  const regeneratedKeys = entryKeySet(regenerated.entries);
  let added = 0;
  for (const key of regeneratedKeys) if (!baseKeys.has(key)) added += 1;
  let removed = 0;
  for (const key of baseKeys) if (!regeneratedKeys.has(key)) removed += 1;
  return { added, removed };
}

/**
 * I1: every input package resolves in the regenerated root exactly, under its own placement and no other.
 * A pnpm `(patch_hash=...)` group on the raw version is also a mismatch (fix 8): stripping it (as `version`
 * already does, same as any peer-group suffix) would otherwise let a patched install through even though a
 * patch changes the installed content.
 */
function checkI1(input: LockfileInvariantInput, regenerated: LockfileView): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  for (const pkg of input.packages) {
    const sameName = regenerated.root.filter((dep) => dep.name === pkg.name);
    const exact = sameName.find((dep) => dep.placement === pkg.placement);
    const patched = exact?.rawVersion?.includes("patch_hash=") ?? false;
    const exactMismatch =
      !exact || exact.specifier !== pkg.version || exact.version !== pkg.version || exact.integrity !== pkg.integrity || exact.link || patched;
    const otherPlacement = sameName.some((dep) => dep.placement !== pkg.placement);
    if (exactMismatch || otherPlacement) violations.push({ invariant: "I1", name: pkg.name });
  }
  return violations;
}

/** I2: every root dep not among the input package names is unchanged, keyed by (placement, name). */
function checkI2(input: LockfileInvariantInput, base: LockfileView, regenerated: LockfileView): LockfileInvariantViolation[] {
  const inputNames = new Set(input.packages.map((pkg) => pkg.name));
  const rootKey = (dep: RootDependency): string => `${dep.placement}\u0000${dep.name}`;
  const baseRoot = new Map(base.root.filter((dep) => !inputNames.has(dep.name)).map((dep) => [rootKey(dep), dep] as const));
  const regeneratedRoot = new Map(
    regenerated.root.filter((dep) => !inputNames.has(dep.name)).map((dep) => [rootKey(dep), dep] as const),
  );
  const violations: LockfileInvariantViolation[] = [];
  const allKeys = new Set([...baseRoot.keys(), ...regeneratedRoot.keys()]);
  for (const key of allKeys) {
    const beforeDep = baseRoot.get(key);
    const afterDep = regeneratedRoot.get(key);
    const name = (beforeDep ?? afterDep)!.name;
    if (!beforeDep || !afterDep) {
      violations.push({ invariant: "I2", name });
      continue;
    }
    if (beforeDep.specifier !== afterDep.specifier || beforeDep.version !== afterDep.version || beforeDep.integrity !== afterDep.integrity) {
      violations.push({ invariant: "I2", name });
    }
  }
  return violations;
}

/**
 * I3: no `name@version` present in both entry lists changes its set of integrity strings. A versionless
 * npm link entry (fix 7) never participates: it is not a `name@version`.
 */
function checkI3(base: LockfileView, regenerated: LockfileView): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  const baseByName = new Map<string, Map<string, Set<string | null>>>();
  for (const entry of base.entries) {
    if (entry.version === null) continue;
    let versions = baseByName.get(entry.name);
    if (!versions) {
      versions = new Map();
      baseByName.set(entry.name, versions);
    }
    let integrities = versions.get(entry.version);
    if (!integrities) {
      integrities = new Set();
      versions.set(entry.version, integrities);
    }
    integrities.add(entry.integrity);
  }
  const regeneratedByName = new Map<string, Map<string, Set<string | null>>>();
  for (const entry of regenerated.entries) {
    if (entry.version === null) continue;
    let versions = regeneratedByName.get(entry.name);
    if (!versions) {
      versions = new Map();
      regeneratedByName.set(entry.name, versions);
    }
    let integrities = versions.get(entry.version);
    if (!integrities) {
      integrities = new Set();
      versions.set(entry.version, integrities);
    }
    integrities.add(entry.integrity);
  }
  for (const [name, regeneratedVersions] of regeneratedByName) {
    const baseVersions = baseByName.get(name);
    if (!baseVersions) continue;
    for (const [version, regeneratedIntegrities] of regeneratedVersions) {
      const baseIntegrities = baseVersions.get(version);
      if (!baseIntegrities) continue;
      if (!setsEqual(baseIntegrities, regeneratedIntegrities)) violations.push({ invariant: "I3", name });
    }
  }
  return violations;
}

/** Whether one newly-appearing scoped entry resolves to the publishing registry, per format. */
function resolvesToRegistry(entry: LockfileEntry, format: LockfileFormat, registryOrigin: string): boolean {
  if (entry.integrity === null || !entry.integrity.startsWith("sha512-")) return false;
  if (format === "npm") {
    if (entry.link || entry.tarball === null) return false;
    try {
      const url = new URL(entry.tarball);
      return url.origin === registryOrigin && url.pathname.startsWith(`/${entry.name}/-/`);
    } catch {
      return false;
    }
  }
  if (entry.otherResolutionKeys.length > 0) return false;
  if (entry.tarball === null) return true;
  try {
    return new URL(entry.tarball).origin === registryOrigin;
  } catch {
    return false;
  }
}

/** Strips a trailing `(...)` peer-group (or patch-hash) suffix from a pnpm dependency-map value, the same way the reader strips a root dependency's `version`. */
function stripParenSuffix(value: string): string {
  const parenIndex = value.indexOf("(");
  return parenIndex === -1 ? value : value.slice(0, parenIndex);
}

/**
 * Whether a pnpm dependency-map value (after stripping any peer-group/patch-hash suffix) is an alias, a
 * link, or a file reference (fix 6) rather than a plain resolved version. A plain version never contains
 * `@`; an alias is exactly `<name>@<version>`, and even a scoped alias name's own leading `@` still leaves
 * a second `@` as the name/version separator, so a bare `includes("@")` check is enough.
 */
function isSuspiciousPnpmDependencyValue(core: string): boolean {
  return core.startsWith("link:") || core.startsWith("file:") || core.includes("@");
}

/** Whether a versioned entry is already represented in the base (npm alias entries need key-level equality, fix round 3). */
function isUnchangedVersionedEntry(
  entry: LockfileEntry,
  baseVersionedKeys: ReadonlySet<string>,
  baseEntriesByKey: ReadonlyMap<string, LockfileEntry>,
): boolean {
  if (entry.version === null) return false;
  if (entry.installedName !== entry.name) {
    const baseEntry = baseEntriesByKey.get(entry.key);
    if (baseEntry === undefined) return false;
    return (
      baseEntry.name === entry.name &&
      baseEntry.installedName === entry.installedName &&
      baseEntry.version === entry.version &&
      baseEntry.integrity === entry.integrity &&
      baseEntry.tarball === entry.tarball
    );
  }
  return baseVersionedKeys.has(entryKey(entry.name, entry.version));
}

/**
 * I5: every regenerated entry newly resolving a scoped package name comes from the publishing registry.
 *
 * Checks both the installed (alias) name and the declared name (fix 6): an entry that is new and scoped
 * under either name must have the two agree, since an alias into or out of the scope is itself a
 * violation, in addition to resolving to the publishing registry as before. A link entry under the scope
 * (fix 7) is its own violation unless the base already holds an identical link at the same key. For pnpm,
 * every importer's and snapshot's dependency-map value naming a scoped package is also checked directly
 * (fix 6): a value that is an alias, a `link:` or a `file:` reference is a violation unless the base holds
 * the identical name and value at the same place -- this catches an alias hidden inside a snapshot's
 * dependency map, which never appears as its own `packages` entry under the scope.
 *
 * Fails closed when the publishing registry does not parse as a URL (fix 10): every new scoped entry is a
 * violation, or, when there is none at all, a single violation named `""`.
 */
function checkI5(
  input: LockfileInvariantInput,
  base: LockfileView,
  regenerated: LockfileView,
  publishing: { readonly scope: string; readonly registry: string },
): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  const scopePrefix = `${publishing.scope}/`;
  const baseVersionedKeys = entryKeySet(base.entries);
  const baseEntriesByKey = new Map(base.entries.map((entry) => [entry.key, entry] as const));
  const baseLinksByKey = new Map(base.entries.filter((entry) => entry.version === null).map((entry) => [entry.key, entry] as const));

  let registryOrigin: string | undefined;
  try {
    registryOrigin = new URL(publishing.registry).origin;
  } catch {
    registryOrigin = undefined;
  }

  let anyNewScoped = false;
  for (const entry of regenerated.entries) {
    const scoped = entry.name.startsWith(scopePrefix) || entry.installedName.startsWith(scopePrefix);
    if (!scoped) continue;
    if (entry.version === null) {
      const baseLink = baseLinksByKey.get(entry.key);
      if (baseLink !== undefined && baseLink.tarball === entry.tarball) continue; // the identical link already in base
      anyNewScoped = true;
      violations.push({ invariant: "I5", name: entry.name });
      continue;
    }
    if (isUnchangedVersionedEntry(entry, baseVersionedKeys, baseEntriesByKey)) continue; // not new
    anyNewScoped = true;
    if (registryOrigin === undefined) {
      violations.push({ invariant: "I5", name: entry.name });
      continue;
    }
    if (entry.installedName !== entry.name) {
      violations.push({ invariant: "I5", name: entry.name });
      continue;
    }
    if (!resolvesToRegistry(entry, input.format, registryOrigin)) violations.push({ invariant: "I5", name: entry.name });
  }

  if (input.format === "pnpm") {
    const baseRefs = new Map(base.dependencyRefs.map((ref) => [`${ref.place}\u0000${ref.name}`, ref.value] as const));
    for (const ref of regenerated.dependencyRefs) {
      if (!ref.name.startsWith(scopePrefix)) continue;
      if (!isSuspiciousPnpmDependencyValue(stripParenSuffix(ref.value))) continue;
      if (baseRefs.get(`${ref.place}\u0000${ref.name}`) === ref.value) continue; // identical name and value at the same place as the base
      anyNewScoped = true;
      violations.push({ invariant: "I5", name: ref.name });
    }
  }

  if (registryOrigin === undefined && !anyNewScoped) violations.push({ invariant: "I5", name: "" });
  return violations;
}

function finalizeViolations(violations: readonly LockfileInvariantViolation[]): LockfileInvariantViolation[] {
  const deduped = new Map<string, LockfileInvariantViolation>();
  for (const violation of violations) deduped.set(`${violation.invariant}\u0000${violation.name}`, violation);
  return [...deduped.values()].sort(
    (left, right) => compareCodeUnits(left.invariant, right.invariant) || compareCodeUnits(left.name, right.name),
  );
}

function checkAgainstReadable(input: LockfileInvariantInput, base: LockfileView, regenerated: LockfileView): LockfileInvariantResult {
  const publishing = input.publishing ?? PACKAGE_SCOPE;
  const violations: LockfileInvariantViolation[] = [];
  if (base.lockfileVersion !== regenerated.lockfileVersion) violations.push({ invariant: "I4", name: "" });
  violations.push(...checkI1(input, regenerated));
  violations.push(...checkI2(input, base, regenerated));
  violations.push(...checkI3(base, regenerated));
  violations.push(...checkI5(input, base, regenerated, publishing));
  const transitive = computeTransitiveCounts(base, regenerated);
  const deduped = finalizeViolations(violations);
  return deduped.length === 0
    ? { verdict: "satisfied", violations: [], transitive }
    : { verdict: "violated", violations: deduped, transitive };
}

function checkLockfileInvariantsUnsafe(input: LockfileInvariantInput): LockfileInvariantResult {
  const base = readLockfile(input.format, input.base);
  if (isUnreadable(base)) return { verdict: "indeterminate", reason: base.reason, side: "base" };
  const regenerated = readLockfile(input.format, input.regenerated);
  if (isUnreadable(regenerated)) {
    if (regenerated.reason === "lockfile-format-unsupported") {
      return { verdict: "violated", violations: [{ invariant: "I4", name: "" }], transitive: { added: 0, removed: 0 } };
    }
    return { verdict: "indeterminate", reason: regenerated.reason, side: "regenerated" };
  }
  return checkAgainstReadable(input, base, regenerated);
}

/** Checks I1 to I5 between a base and a regenerated lockfile. Pure; never throws. */
export function checkLockfileInvariants(input: LockfileInvariantInput): LockfileInvariantResult {
  try {
    return checkLockfileInvariantsUnsafe(input);
  } catch {
    return LAST_RESORT;
  }
}
