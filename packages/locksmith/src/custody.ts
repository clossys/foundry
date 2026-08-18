import type { SecretKey } from "./types.js";

/**
 * Where a key's value physically lives (an Infisical project, an
 * environment-variable surface, a platform secret store, ...). This package
 * never validates the string against a fixed enum: store taxonomy is owned
 * by whichever provider integration a consumer has chosen, not by locksmith.
 */
export type CustodyStore = string;

/**
 * Custody metadata for one declared key: who owns it and where it lives.
 * `owner` is `null`, never an empty string, when nobody has recorded
 * ownership — that state is what {@link unownedKeys} and rotation's
 * `"unowned"` state key off of.
 */
export interface KeyCustodyRecord {
  readonly key: SecretKey;
  readonly owner: string | null;
  readonly store: CustodyStore;
  readonly notes?: string;
}

export interface KeyCustodyManifest {
  readonly version: 1;
  readonly entries: readonly KeyCustodyRecord[];
}

/**
 * Builds a frozen, value-free custody manifest. Every entry is metadata
 * only — a key name, an owner name, and a store label. No entry accepts or
 * derives a secret value.
 */
export function defineKeyCustody(entries: readonly KeyCustodyRecord[]): KeyCustodyManifest {
  return Object.freeze({
    version: 1,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          key: entry.key,
          owner: entry.owner ?? null,
          store: entry.store,
          ...(entry.notes === undefined ? {} : { notes: entry.notes }),
        }),
      ),
    ),
  });
}

/** The custody record for one key, or `undefined` if the key was never declared. */
export function custodyOf(manifest: KeyCustodyManifest, key: SecretKey): KeyCustodyRecord | undefined {
  return manifest.entries.find((entry) => entry.key === key);
}

/** Every declared key with no recorded owner — half of the package metric. */
export function unownedKeys(manifest: KeyCustodyManifest): readonly SecretKey[] {
  return manifest.entries.filter((entry) => entry.owner === null).map((entry) => entry.key);
}
