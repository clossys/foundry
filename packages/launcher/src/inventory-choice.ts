// Writing the hub inventory from the repositories a founder chose on
// Advisor's repository-choice card (issue #1179), so a founder never
// hand-writes JSON. `launcher --repositories` is the command; this module
// decides what that command may write, and never writes anything itself.
//
// The chosen ids and the document built from them are validated against
// docs/contracts/repository-inventory.json (in the public repository;
// that exact path does not ship in this package, but this package's
// build packs and ships its own copy of the contract) through the shared
// contract checker (./inventory-contract.ts) -- the same check every later read of
// the stored inventory applies, so what this writes, Launcher reads back.
//
// An inventory already on disk that names a different set of repositories
// is never merged into or overwritten silently: the choice is refused, with
// the difference in counts and positions, unless the caller passes an
// explicit replace approval (`--replace-inventory`).
//
// Every message this module builds -- the refusal and the success line
// alike -- names a repository only by its position, never by its id: a
// stored inventory file, and the `--repositories` argument, are both
// document-shaped input an agent may relay verbatim, and a repository id is
// exactly the kind of short string a hostile entry could shape as
// prompt-injection text (see ./inventory-contract.ts's own header). The
// caller looks the reported position up in its own copy of the inventory
// file or its own `--repositories` argument to learn which repository it
// names.

import { inventoryKey } from "./identity.js";
import { readInventoryDocument, renderInventoryDocument, validateInventoryDocument, validateInventoryValue, type InventoryEntry } from "./inventory-contract.js";
import type { ChosenInventory } from "./types.js";

export type ChosenInventoryResolution =
  | { readonly kind: "resolved"; readonly chosen: ChosenInventory }
  | { readonly kind: "refuse"; readonly message: string };

/** The command a refusal names for an explicit replace approval. */
export const REPLACE_INVENTORY_FLAG = "--replace-inventory";

function repositories(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

/** Added ids are named by their position in the `--repositories` argument, never by the id itself. */
function listAddedPositions(positions: readonly number[]): string {
  return positions.length === 0 ? "" : ` (${positions.map((index) => `--repositories[${index}]`).join(", ")})`;
}

/** Removed ids are named by their position in the stored inventory's `repositories` array, never by the id itself. */
function listRemovedPositions(positions: readonly number[]): string {
  return positions.length === 0 ? "" : ` (${positions.map((index) => `repositories[${index}] in the stored inventory`).join(", ")})`;
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
 *   repositories each side has and the positions that would be added and
 *   removed (never the ids themselves), unless `replace` is true. A
 *   replacement keeps each kept repository's existing entry as it was (its
 *   `packages` included).
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
  let addedPositions: readonly number[] = chosenIds.map((_, index) => index);
  let removedPositions: readonly number[] = [];
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
      // Positions, not ids: `added` indexes into the --repositories argument the caller passed; `removed` indexes into the stored inventory's own `repositories` array.
      addedPositions = added.map((id) => chosenIds.indexOf(id));
      removedPositions = removed.map((id) => stored.ids.indexOf(id));
      if (stored.ids.length > 0 && added.length === 0 && removed.length === 0) {
        return { kind: "resolved", chosen: { kind: "unchanged", count: stored.ids.length } };
      }
      if (stored.ids.length > 0) {
        if (!replace) {
          return {
            kind: "refuse",
            message:
              `the hub inventory already lists ${repositories(stored.ids.length)} and the choice has ${chosenIds.length}: ` +
              `${added.length} to add${listAddedPositions(addedPositions)}, ${removed.length} to remove${listRemovedPositions(removedPositions)}. ` +
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
    chosen: { kind: "write", document, count: written.ids.length, previousCount, added, removed, addedPositions, removedPositions, replaced },
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
    return (
      `inventory: replaced ${chosen.previousCount} with the ${count} you chose -- ` +
      `${chosen.added.length} added${listAddedPositions(chosen.addedPositions)}, ${chosen.removed.length} removed${listRemovedPositions(chosen.removedPositions)}`
    );
  }
  return `inventory: wrote the ${count} you chose`;
}
