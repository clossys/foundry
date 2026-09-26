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

/** Every distinct `name@version` in `entries`, as `entryKey` strings. */
function entryKeySet(entries: readonly LockfileEntry[]): Set<string> {
  return new Set(entries.map((entry) => entryKey(entry.name, entry.version)));
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

/** I1: every input package resolves in the regenerated root exactly, under its own placement and no other. */
function checkI1(input: LockfileInvariantInput, regenerated: LockfileView): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  for (const pkg of input.packages) {
    const sameName = regenerated.root.filter((dep) => dep.name === pkg.name);
    const exact = sameName.find((dep) => dep.placement === pkg.placement);
    const exactMismatch =
      !exact || exact.specifier !== pkg.version || exact.version !== pkg.version || exact.integrity !== pkg.integrity || exact.link;
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

/** I3: no `name@version` present in both entry lists changes its set of integrity strings. */
function checkI3(base: LockfileView, regenerated: LockfileView): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  const baseByName = new Map<string, Map<string, Set<string | null>>>();
  for (const entry of base.entries) {
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

/** I5: every regenerated entry newly resolving a scoped package name comes from the publishing registry. */
function checkI5(
  input: LockfileInvariantInput,
  base: LockfileView,
  regenerated: LockfileView,
  publishing: { readonly scope: string; readonly registry: string },
): LockfileInvariantViolation[] {
  const violations: LockfileInvariantViolation[] = [];
  const baseKeys = entryKeySet(base.entries);
  const scopePrefix = `${publishing.scope}/`;
  let registryOrigin: string;
  try {
    registryOrigin = new URL(publishing.registry).origin;
  } catch {
    return violations;
  }
  for (const entry of regenerated.entries) {
    if (!entry.name.startsWith(scopePrefix)) continue;
    if (baseKeys.has(entryKey(entry.name, entry.version))) continue;
    if (!resolvesToRegistry(entry, input.format, registryOrigin)) violations.push({ invariant: "I5", name: entry.name });
  }
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
