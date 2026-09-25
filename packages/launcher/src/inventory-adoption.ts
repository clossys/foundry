// Adopt an existing repository inventory instead of creating a second one
// (#1216). An account that already keeps a repository inventory in its own
// control plane becomes the source of truth when the hub marker declares
// it. Launcher writes only what that inventory lacks (a later apply step,
// not this module) and reports drift instead of silently merging.

import { readContractDocument } from "./generated/contract-schema.generated.js";
import { sameRepository } from "./identity.js";
import { validateInventoryDocument } from "./inventory-contract.js";
import type { WorkspaceHost } from "./types.js";

export interface ExternalInventoryDeclaration {
  readonly path: string;
  readonly shape: "foundry" | "custom";
}

/**
 * A count plus each disagreeing or agreeing id's position, never the ids
 * themselves: `externalInventory` at `declaration.path` and Launcher's own
 * stored inventory are both document content a hub declares or writes, and
 * this whole report reaches `formatHubHealth`'s JSON-dumped `health:` line
 * on every resume of a hub that declares `externalInventory`, so an id kept
 * here would still reach that message (#1179). A position names the array
 * it indexes into: `externalInventory[<i>]` for `declaration.path`'s
 * `repositories[<i>].id`, `repositories[<j>]` for the hub's own stored
 * inventory's `repositories[<j>].id`.
 */
export interface InventoryDriftPositions {
  readonly count: number;
  readonly positions: readonly string[];
}

export interface InventoryDriftReport {
  readonly status: "no-external-source" | "reconciled" | "indeterminate";
  readonly externalOnly: InventoryDriftPositions;
  readonly launcherOnly: InventoryDriftPositions;
  readonly agreeing: InventoryDriftPositions;
  readonly note?: string;
}

const NO_DRIFT: InventoryDriftPositions = { count: 0, positions: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `externalInventory` entry with a usable id, paired with its own index in that document's `repositories` array. */
interface ForeignId {
  readonly id: string;
  readonly index: number;
}

/**
 * Reads a foundry-shaped inventory document's repository ids. Malformed or
 * missing is null, never []. The file is read as bytes by the shared strict
 * reader, so bytes that are not valid UTF-8, a repeated key, or a byte order
 * mark make it unreadable rather than silently repaired (#1179). Its shape
 * is read leniently on purpose: an external source is not Launcher's own
 * document -- a non-object entry, or one with a missing, blank or non-string
 * `id`, is skipped rather than refusing the whole document. Skipped entries
 * still occupy a slot in `repositories`, so each kept id is paired with its
 * own original array index, never a count of ids kept so far: the file's
 * fourth entry (index 3) must be reported as `externalInventory[3]` even
 * when it is the second entry actually kept (#1179).
 */
function readForeignIds(host: WorkspaceHost, path: string): readonly ForeignId[] | null {
  const raw = host.readBytes(path);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = readContractDocument(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) return null;
  const ids: ForeignId[] = [];
  parsed.repositories.forEach((entry, index) => {
    if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim() !== "") ids.push({ id: entry.id, index });
  });
  return ids;
}

/**
 * Compares the declared external inventory against the launcher-written
 * inventory at `directory/launcherInventoryRelPath`. Read-only -- callers
 * decide whether and how to write the reconciled set, as an explicit,
 * approved apply step (same #1045 pattern as clone-on-approval). Ids are
 * compared with `sameRepository()` (identity.ts): case-insensitively, and,
 * when `hubOwner` is given, with a bare id read as that owner's repository.
 * The hub's own inventory is read by `validateInventoryDocument()`; when it
 * is present but invalid the report is indeterminate.
 */
export function reportInventoryDrift(
  host: WorkspaceHost,
  directory: string,
  declaration: ExternalInventoryDeclaration | undefined,
  launcherInventoryRelPath: string,
  hubOwner?: string,
): InventoryDriftReport {
  if (declaration === undefined) {
    return { status: "no-external-source", externalOnly: NO_DRIFT, launcherOnly: NO_DRIFT, agreeing: NO_DRIFT };
  }
  if (declaration.shape === "custom") {
    return {
      status: "indeterminate",
      externalOnly: NO_DRIFT,
      launcherOnly: NO_DRIFT,
      agreeing: NO_DRIFT,
      note: `the declared \`externalInventory\` declares a shape launcher has no mapping for yet; launcher will not guess one. Reconcile by hand or file the mapping gap.`,
    };
  }
  const externalEntries = readForeignIds(host, declaration.path);
  if (externalEntries === null) {
    return {
      status: "indeterminate",
      externalOnly: NO_DRIFT,
      launcherOnly: NO_DRIFT,
      agreeing: NO_DRIFT,
      note: `the declared \`externalInventory\` could not be read as a populated schemaVersion:1 inventory document.`,
    };
  }
  // Launcher's own inventory is read by its own strict reader. A missing one
  // lists nothing; one that is present but cannot be read makes the
  // comparison indeterminate, never a comparison against an empty list.
  const launcherPath = `${directory}/${launcherInventoryRelPath}`;
  const launcherBytes = host.readBytes(launcherPath);
  let launcherIds: readonly string[] = [];
  if (launcherBytes !== null) {
    const launcher = validateInventoryDocument(launcherBytes, hubOwner === undefined ? {} : { hubOwner });
    if (!launcher.valid) {
      return {
        status: "indeterminate",
        externalOnly: NO_DRIFT,
        launcherOnly: NO_DRIFT,
        agreeing: NO_DRIFT,
        note: `the hub's own inventory ${launcher.reason}, so it cannot be compared with the declared \`externalInventory\`.`,
      };
    }
    launcherIds = launcher.ids;
  }
  // One repository identity, as everywhere in Launcher (identity.ts): a bare id is the hub owner's, and case is ignored.
  const agrees = (id: string, others: readonly string[]) => others.some((other) => sameRepository(id, other, hubOwner));
  const externalIds = externalEntries.map((entry) => entry.id);
  // Every position below is the id's own index in the array a caller can already read
  // (externalEntries.index is `externalInventory`'s document's own `repositories` index --
  // readForeignIds() pairs it with the id precisely because that array is filtered, so a
  // count of ids kept so far would not match the file (#1179); launcherIds is never
  // filtered, so its own array index already is that position) -- never the id, per
  // InventoryDriftPositions' own doc comment.
  const externalOnly = externalEntries.reduce<{ count: number; positions: string[] }>(
    (acc, entry) => (agrees(entry.id, launcherIds) ? acc : { count: acc.count + 1, positions: [...acc.positions, `externalInventory[${entry.index}]`] }),
    { count: 0, positions: [] },
  );
  const launcherOnly = launcherIds.reduce<{ count: number; positions: string[] }>(
    (acc, id, index) => (agrees(id, externalIds) ? acc : { count: acc.count + 1, positions: [...acc.positions, `repositories[${index}]`] }),
    { count: 0, positions: [] },
  );
  const agreeing = externalEntries.reduce<{ count: number; positions: string[] }>(
    (acc, entry) => (agrees(entry.id, launcherIds) ? { count: acc.count + 1, positions: [...acc.positions, `externalInventory[${entry.index}]`] } : acc),
    { count: 0, positions: [] },
  );
  return { status: "reconciled", externalOnly, launcherOnly, agreeing };
}
