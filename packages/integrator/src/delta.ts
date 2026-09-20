import type { PackageCurrency } from "./currency.js";

/**
 * The shared, launcher-consumable per-repository inventory document, schema
 * version 1, and the pure emitter that serializes a currency delta into it
 * (issue #996).
 *
 * WHY THIS EXISTS. `judgeCurrency` and `upgradeSet` already produce a
 * per-plane delta -- which packages are behind and which version closes the
 * gap, which installed names are not entitled -- but nothing serializes that
 * delta, and the shapes on either side of the fence do not meet: this
 * package's `InstalledPackage` is `{ name, declaredRange, installedVersion }`
 * with no repository id, while a launcher reading an inventory document sees
 * `repositories[{ id }]` whose entries it can only count, because nothing
 * has ever promised what an entry means. Both sides guessing at each other's
 * shape is exactly the silent-drift failure this package exists to remove,
 * so the shape is defined once, here, and both sides read this one. The
 * schema is intentionally small -- a name, an optional version, an optional
 * wiring -- because the contract is the point: a consumer can rely on the
 * envelope and ignore what it does not understand.
 *
 * THE SHAPE IS A DOCUMENT, NOT A JUDGMENT. `InventoryDocument` is the
 * serialization contract -- flat, JSON-shaped, and versioned by a literal
 * `schemaVersion` so a consumer can refuse a document it was not built to
 * read rather than misparse one. It deliberately carries less than
 * `PackageCurrency` does, and that asymmetry is the load-bearing decision:
 * a judgment that could not be made (`indeterminate`, `unreachable`,
 * `unauthenticated`) or that found nothing wrong (`current`,
 * `absent-with-reason`, `absent-without-reason`) serializes to NO entry at
 * all -- never to an entry invented from ground the judgment never covered.
 * That is the same law `currencyVerdict` applies when it refuses to fold an
 * unjudged package into `satisfied`, applied one level down, at the level of
 * "does this document claim a package exists in this state at all".
 *
 * WHAT EACH JUDGED STATE BECOMES:
 *
 *   - `behind`                  -> an entry with the target version and no
 *                                  `wiring`. The judgment knows the version
 *                                  to move to; it records no manifest
 *                                  position, and `wiring` is optional
 *                                  precisely so a caller that knows the
 *                                  position supplies it rather than this
 *                                  emitter guessing one.
 *   - `extra`                   -> an entry with `wiring: "unknown"` and no
 *                                  version. An over-install is a fact about
 *                                  the name, not a version to sync to, and
 *                                  the judged state records no entitlement
 *                                  position to grade a wiring against.
 *   - `opted-out-and-installed` -> the same shape, for the same reason one
 *                                  level sharper: the plane has decided not
 *                                  to hold this package at all, so
 *                                  serializing its installed version as if
 *                                  it were a currency target would misread a
 *                                  recorded contradiction as a plan.
 *   - every other state         -> no entry (see above for why).
 *
 * PURITY. The emitter is a fold over already-graded judgments -- no network,
 * no filesystem, no clock. It trusts its input the way `upgradeSet` and
 * `foldCurrencyDelta` do: `PackageCurrency` values are this package's own
 * judged output, not untrusted external data, so there is nothing here to
 * validate and nothing to throw. The caller owns everything this module
 * must never learn: the repository ids (the blindness rule -- this package
 * supplies the mechanism, never the list of which planes exist), and what
 * happens to the document afterward -- writing it, sending it, folding it
 * together with other planes' documents -- none of which is this module's
 * business. The returned document is deeply frozen; the shared v1 shape is a
 * contract, and a contract a caller can quietly mutate is not one.
 */

/** Where a serialized package is wired into its plane's manifest, when that is known. `"unknown"` means the emitter had no judgment that records one. */
export type InventoryPackageWiring = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "unknown";

export interface InventoryPackageEntry {
  readonly name: string;
  /** The version the plane should hold -- present only where a judgment named one (`behind`'s target). Deliberately absent elsewhere: an entry without a version reports presence and wiring, never a version to sync to. */
  readonly version?: string;
  /** The manifest position the package is wired into, when a judgment records one. Absent rather than guessed: only a caller that knows the position should claim it. */
  readonly wiring?: InventoryPackageWiring;
}

export interface InventoryRepositoryEntry {
  /** Caller-supplied identity of the repository this entry describes. This package never learns more about the plane than this string. */
  readonly id: string;
  readonly packages: readonly InventoryPackageEntry[];
}

export interface InventoryDocument {
  /** Literal `1`. A consumer must refuse a document whose schema version it was not built to read, exactly as `loadEntitlementDeclaration` refuses a declaration whose `version` is not `1`. */
  readonly schemaVersion: 1;
  readonly repositories: readonly InventoryRepositoryEntry[];
}

/** One caller-supplied pairing of a repository's identity with its own `judgeCurrency` output. */
export interface CurrencyDeltaRepositoryInput {
  readonly id: string;
  readonly statuses: readonly PackageCurrency[];
}

export interface EmitCurrencyDeltaInput {
  /** One entry per repository, in the order the caller supplies -- the emitter reorders nothing, so a document reads in the caller's own canonical order. */
  readonly repositories: readonly CurrencyDeltaRepositoryInput[];
}

/**
 * Serialize the currency delta of one or more repositories into the shared
 * inventory document, schema version 1. Pure and offline: a fold over
 * `PackageCurrency` values a caller already computed, per the mapping in this
 * module's doc comment. Never throws, and never invents an entry for a state
 * that was not judged -- see the doc comment for why the absence of an entry
 * is itself part of the contract.
 */
export function emitCurrencyDelta(input: EmitCurrencyDeltaInput): InventoryDocument {
  return Object.freeze({
    schemaVersion: 1,
    repositories: Object.freeze(
      input.repositories.map((repository) =>
        Object.freeze({
          id: repository.id,
          packages: Object.freeze(deltaPackages(repository.statuses)),
        }),
      ),
    ),
  });
}

function deltaPackages(statuses: readonly PackageCurrency[]): readonly InventoryPackageEntry[] {
  const entries: InventoryPackageEntry[] = [];
  for (const status of statuses) {
    if (status.state === "behind") {
      entries.push({ name: status.name, version: status.latestVersion });
    } else if (status.state === "extra" || status.state === "opted-out-and-installed") {
      entries.push({ name: status.name, wiring: "unknown" });
    }
    // Every other state serializes to nothing: an unjudged or judged-clean
    // package must not appear in the document at all, never as an entry
    // fabricated from ground the judgment never covered.
  }
  return entries;
}
