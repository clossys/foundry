// Writing the hub inventory from the repositories a founder chose on
// Advisor's repository-choice card (issue #1179), so a founder never
// hand-writes JSON. `launcher --repositories` is the command; this module
// decides what that command may write, and never writes anything itself.
//
// The chosen ids and the document built from them are validated against
// docs/contracts/repository-inventory.json through the shared contract
// checker (./inventory-contract.ts) -- the same check every later read of
// the stored inventory applies, so what this writes, Launcher reads back.
//
// An inventory already on disk that names a different set of repositories
// is never merged into or overwritten silently: the choice is refused, with
// the difference in counts and ids, unless the caller passes an explicit
// replace approval (`--replace-inventory`).

import { inventoryKey, readInventoryDocument, renderInventoryDocument, validateInventoryDocument, validateInventoryValue, type InventoryEntry } from "./inventory-contract.js";
import type { ChosenInventory } from "./types.js";

export type ChosenInventoryResolution =
  | { readonly kind: "resolved"; readonly chosen: ChosenInventory }
  | { readonly kind: "refuse"; readonly message: string };

/** The command a refusal names for an explicit replace approval. */
export const REPLACE_INVENTORY_FLAG = "--replace-inventory";

function repositories(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

function listIds(ids: readonly string[]): string {
  return ids.length === 0 ? "" : ` (${ids.join(", ")})`;
}

/**
 * Decides what `launcher --repositories` writes into a hub whose stored
 * inventory is `onDisk` -- the file's exact bytes, or `null` when there is
 * none.
 *
 * Every comparison uses `inventoryKey(id, hubOwner)`: a bare id names a
 * repository of the hub's own owner, and letter case is ignored.
 *
 * - The chosen ids must form a valid inventory on their own: at least one
 *   id, each one satisfying the contract's repository id rule, and no two
 *   naming the same repository. A refusal names positions only.
 * - The stored inventory is read by the same strict reader, with the same
 *   owner: one that fails its contract, including one listing a repository
 *   twice (for example `app` and `<hubOwner>/app`), is replaced only with
 *   `replace`, and then with the chosen ids alone. It is never merged.
 * - No inventory, or an empty one: the chosen repositories are written.
 * - An inventory naming exactly the same repositories: nothing is written.
 * - An inventory naming a different set: refused, reporting how many
 *   repositories each side has and which ids would be added and removed,
 *   unless `replace` is true. A replacement keeps each kept repository's
 *   existing entry as it was (its `packages` included).
 *
 * The document to write is checked again by the same reader every later
 * read uses, before it is returned.
 */
export function resolveChosenInventory(
  onDisk: Uint8Array | string | null,
  chosenIds: readonly string[],
  hubOwner: string,
  replace: boolean,
): ChosenInventoryResolution {
  if (chosenIds.length === 0) {
    return { kind: "refuse", message: "--repositories must name at least one repository" };
  }
  const chosenCheck = validateInventoryValue({ schemaVersion: 1, repositories: chosenIds.map((id) => ({ id })) }, { hubOwner });
  if (!chosenCheck.valid) return { kind: "refuse", message: `--repositories is not a valid inventory: ${chosenCheck.reason}` };

  let entries: InventoryEntry[];
  let added: readonly string[] = chosenIds;
  let removed: readonly string[] = [];
  let replaced: Extract<ChosenInventory, { kind: "write" }>["replaced"] = "nothing";
  let previousCount = 0;
  if (onDisk === null) {
    entries = chosenIds.map((id) => ({ id }));
  } else {
    const stored = readInventoryDocument(onDisk, { hubOwner });
    if (!stored.valid) {
      if (!replace) {
        return {
          kind: "refuse",
          message: `the hub inventory ${stored.reason}; to replace it with the ${repositories(chosenIds.length)} chosen, run again with ${REPLACE_INVENTORY_FLAG}`,
        };
      }
      entries = chosenIds.map((id) => ({ id }));
      replaced = "invalid";
    } else {
      previousCount = stored.ids.length;
      // Keys are unique on both sides: the reader and the chosen-id check above both refuse two ids with one key.
      const storedByKey = new Map(stored.entries.map((entry) => [inventoryKey(entry.id, hubOwner), entry] as const));
      const chosenKeys = new Set(chosenIds.map((id) => inventoryKey(id, hubOwner)));
      added = chosenIds.filter((id) => !storedByKey.has(inventoryKey(id, hubOwner)));
      removed = stored.ids.filter((id) => !chosenKeys.has(inventoryKey(id, hubOwner)));
      if (stored.ids.length > 0 && added.length === 0 && removed.length === 0) {
        return { kind: "resolved", chosen: { kind: "unchanged", count: stored.ids.length } };
      }
      if (stored.ids.length > 0) {
        if (!replace) {
          return {
            kind: "refuse",
            message:
              `the hub inventory already lists ${repositories(stored.ids.length)} and the choice has ${chosenIds.length}: ` +
              `${added.length} to add${listIds(added)}, ${removed.length} to remove${listIds(removed)}. ` +
              `Launcher never merges or overwrites an inventory silently; to replace it with the choice, run again with ${REPLACE_INVENTORY_FLAG}`,
          };
        }
        replaced = "differing";
      }
      entries = chosenIds.map((id) => storedByKey.get(inventoryKey(id, hubOwner)) ?? { id });
    }
  }

  const document = renderInventoryDocument(entries);
  const written = validateInventoryDocument(document, { hubOwner });
  if (!written.valid) return { kind: "refuse", message: `the inventory to write ${written.reason}` };
  return {
    kind: "resolved",
    chosen: { kind: "write", document, count: written.ids.length, previousCount, added, removed, replaced },
  };
}

/** One line for the apply message saying what happened to the inventory. */
export function describeChosenInventory(chosen: ChosenInventory): string {
  if (chosen.kind === "unchanged") {
    return `inventory: unchanged -- it already lists the ${repositories(chosen.count)} you chose`;
  }
  const count = repositories(chosen.count);
  if (chosen.replaced === "invalid") return `inventory: replaced one that failed its contract with the ${count} you chose`;
  if (chosen.replaced === "differing") {
    return `inventory: replaced ${chosen.previousCount} with the ${count} you chose -- ${chosen.added.length} added${listIds(chosen.added)}, ${chosen.removed.length} removed${listIds(chosen.removed)}`;
  }
  return `inventory: wrote the ${count} you chose`;
}
