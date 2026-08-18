import type { SecretKey } from "./types.js";

/** An opaque identifier for whoever may resolve a key — a service, a role, a workload identity. Locksmith imposes no shape on it. */
export type Principal = string;

export interface DistributionEntry {
  readonly key: SecretKey;
  readonly principals: readonly Principal[];
}

export interface DistributionManifest {
  readonly version: 1;
  readonly entries: readonly DistributionEntry[];
}

/**
 * Builds a frozen distribution manifest: which principal may resolve which
 * name. This states policy only — it grants nothing by itself and performs
 * no access check against a live resolver. A consumer's own adapter/provider
 * boundary is what actually enforces access; this manifest is the
 * declaration that boundary is checked against.
 */
export function defineDistributionManifest(entries: readonly DistributionEntry[]): DistributionManifest {
  return Object.freeze({
    version: 1,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          key: entry.key,
          principals: Object.freeze([...entry.principals]),
        }),
      ),
    ),
  });
}

/** Whether the manifest declares that `principal` may resolve `key`. */
export function mayResolve(manifest: DistributionManifest, principal: Principal, key: SecretKey): boolean {
  const entry = manifest.entries.find((candidate) => candidate.key === key);
  return entry !== undefined && entry.principals.includes(principal);
}

/** Every principal declared for a key, or an empty list if the key has no distribution entry. */
export function principalsFor(manifest: DistributionManifest, key: SecretKey): readonly Principal[] {
  return manifest.entries.find((entry) => entry.key === key)?.principals ?? [];
}

/** Every key declared for a principal, or an empty list if the principal appears in no entry. */
export function keysFor(manifest: DistributionManifest, principal: Principal): readonly SecretKey[] {
  return manifest.entries.filter((entry) => entry.principals.includes(principal)).map((entry) => entry.key);
}
