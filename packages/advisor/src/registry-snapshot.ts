import { createHash } from "node:crypto";
import { validateAgainstContract } from "./contract-schema.js";
import type { ContractViolation } from "./contract-schema.js";
import { loadPlanContract } from "./plan-contract.js";
import { canonicalJson } from "./plan-digest.js";

/**
 * The registry snapshot (issue #1178): what the public registry said, at one
 * moment, about the packages a plan asks for. Its one definition is the
 * shared contract `docs/contracts/registry-snapshot.json` (in the public
 * repository, not shipped in this package; its content is packed into this
 * package at build time). This package only reads a snapshot. It never
 * fetches one and makes no network call.
 */

/** One version of a package, as the registry described it. */
export interface RegistrySnapshotVersion {
  readonly version: string;
  /** The integrity value exactly as served, or null when none was served. */
  readonly integrity: string | null;
  readonly tarball: string;
  readonly deprecated: boolean;
  readonly publishedAt: string | null;
  readonly hasAttestations: boolean;
}

/** One package asked for. */
export interface RegistrySnapshotPackage {
  readonly name: string;
  readonly status: "found" | "not-found";
  /** The version the `latest` dist-tag named, or null. */
  readonly latest: string | null;
  readonly versions: readonly RegistrySnapshotVersion[];
  /** Kept for audit; excluded from the snapshot digest. */
  readonly responseSha256: string;
}

export interface RegistrySnapshot {
  readonly schemaVersion: 1;
  readonly kind: "clossys.registry-snapshot";
  readonly registry: string;
  /** Excluded from the snapshot digest. */
  readonly fetchedAt: string;
  /** Excluded from the snapshot digest. */
  readonly fetchedBy: { readonly name: string; readonly version: string };
  readonly packages: readonly RegistrySnapshotPackage[];
}

/** A code rule of the registry snapshot contract. */
export type RegistrySnapshotRuleId = "N1" | "N2" | "N3";

/** One reason a snapshot is refused: `rule` is "schema" for the contract's keywords, else the code rule's id. */
export interface RegistrySnapshotViolation {
  readonly rule: "schema" | RegistrySnapshotRuleId;
  /** The field at fault, like `packages[1].versions[0].integrity`, or "" for the document itself. */
  readonly path: string;
  /** What is wrong, by position only, never quoting a value or an undeclared key. */
  readonly message: string;
}

const UNDECLARED_FIELD = "is not a field the contract declares, and unknown fields are refused";

/**
 * A contract violation with no document text in it. The shared checker names
 * an undeclared key in its path; that key is text from the document, so here
 * the violation is reported at the object that holds it instead.
 */
export function positionOnly(violation: ContractViolation): { path: string; message: string } {
  if (violation.message !== UNDECLARED_FIELD) return { path: violation.path, message: violation.message };
  const { path } = violation;
  // The checker writes an undeclared key as `parent.key` when it looks like an
  // identifier (no `.`, `[` or `"` in it), else as `parent["key"]` with the key
  // JSON-quoted, where a `"` inside the key is always escaped, so `["` opens
  // only that final quoted key.
  const cut = path.endsWith('"]') ? path.lastIndexOf('["') : path.lastIndexOf(".");
  return { path: cut === -1 ? "" : path.slice(0, cut), message: "has a field the contract does not declare, and unknown fields are refused" };
}

function eachRepeat<T>(items: readonly T[], key: (item: T) => string, onRepeat: (index: number, firstIndex: number) => void): void {
  const first = new Map<string, number>();
  items.forEach((item, index) => {
    const value = key(item);
    const earlier = first.get(value);
    if (earlier === undefined) first.set(value, index);
    else onRepeat(index, earlier);
  });
}

/** Every violation of the snapshot contract's code rules N1-N3, for a snapshot that already passed the schema. */
export function registrySnapshotRuleViolations(snapshot: RegistrySnapshot): RegistrySnapshotViolation[] {
  const violations: RegistrySnapshotViolation[] = [];
  eachRepeat(snapshot.packages, (entry) => entry.name, (index, first) =>
    violations.push({ rule: "N1", path: `packages[${index}].name`, message: `repeats packages[${first}].name` }),
  );
  snapshot.packages.forEach((entry, index) => {
    eachRepeat(entry.versions, (version) => version.version, (position, first) =>
      violations.push({ rule: "N2", path: `packages[${index}].versions[${position}].version`, message: `repeats packages[${index}].versions[${first}].version` }),
    );
    if (entry.status === "not-found") {
      if (entry.latest !== null) violations.push({ rule: "N3", path: `packages[${index}].latest`, message: "must be null when the package was not found" });
      if (entry.versions.length > 0) violations.push({ rule: "N3", path: `packages[${index}].versions`, message: "must be empty when the package was not found" });
    }
  });
  return violations;
}

/**
 * Every violation of `value` against the registry snapshot contract, schema
 * first and then, only for a snapshot whose shape is known good, the code
 * rules N1-N3. Never throws; an empty result means the snapshot is valid.
 */
export function validateRegistrySnapshot(value: unknown): RegistrySnapshotViolation[] {
  const schema = validateAgainstContract(loadPlanContract("registry-snapshot.json"), value, loadPlanContract);
  if (schema.length > 0) return schema.map((violation) => ({ rule: "schema", ...positionOnly(violation) }));
  return registrySnapshotRuleViolations(value as RegistrySnapshot);
}

/** Compares strings as sequences of UTF-16 code units, the order RFC 8785 sorts keys in. */
export function byCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The snapshot in its canonical order, as the registry snapshot contract
 * defines it: packages sorted by name, and each package's versions sorted by
 * version, comparing UTF-16 code units. Every other member is kept as it is.
 * For a valid snapshot (N1 and N2 hold) the order is total, so two snapshots
 * that differ only in the order they list packages or versions have the same
 * canonical form. The digest and every resolution position read this form.
 */
export function canonicalSnapshot(snapshot: RegistrySnapshot): RegistrySnapshot {
  return {
    ...snapshot,
    packages: [...snapshot.packages]
      .sort((left, right) => byCodeUnits(left.name, right.name))
      .map((entry) => ({ ...entry, versions: [...entry.versions].sort((left, right) => byCodeUnits(left.version, right.version)) })),
  };
}

/** The subject the snapshot digest hashes: registry, and each package's name, status, latest and versions, in canonical order. */
export function snapshotDigestSubject(snapshot: RegistrySnapshot): unknown {
  const canonical = canonicalSnapshot(snapshot);
  return {
    registry: canonical.registry,
    packages: canonical.packages.map((entry) => ({ name: entry.name, status: entry.status, latest: entry.latest, versions: entry.versions })),
  };
}

/**
 * `sha256:` and the lowercase hex SHA-256 of the canonical JSON of the
 * snapshot's digest subject, as the registry snapshot contract defines it:
 * `fetchedAt`, `fetchedBy` and every `responseSha256` are left out, so
 * fetching the same selection again gives the same digest. Throws when the
 * snapshot does not validate: an invalid snapshot has no digest.
 */
export function snapshotDigest(snapshot: RegistrySnapshot): string {
  const violations = validateRegistrySnapshot(snapshot);
  if (violations.length > 0) throw new TypeError(`an invalid registry snapshot has no digest: ${violations.map((violation) => `snapshot${violation.path === "" ? "" : `.${violation.path}`} ${violation.message}`).join("; ")}`);
  return `sha256:${createHash("sha256").update(canonicalJson(snapshotDigestSubject(snapshot)), "utf8").digest("hex")}`;
}
