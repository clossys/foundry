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

/**
 * Reads a foundry-shaped inventory document's repository ids. Malformed or
 * missing is null, never []. The file is read as bytes by the shared strict
 * reader, so bytes that are not valid UTF-8, a repeated key, or a byte order
 * mark make it unreadable rather than silently repaired (#1179). Its shape
 * is read leniently on purpose: an external source is not Launcher's own
 * document.
 */
function readForeignIds(host: WorkspaceHost, path: string): readonly string[] | null {
  const raw = host.readBytes(path);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = readContractDocument(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) return null;
  const ids: string[] = [];
  for (const entry of parsed.repositories) {
    if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim() !== "") ids.push(entry.id);
  }
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
      note: `externalInventory at ${declaration.path} declares shape "custom"; launcher has no mapping for a non-foundry inventory shape yet and will not guess one. Reconcile by hand or file the mapping gap.`,
    };
  }
  const externalIds = readForeignIds(host, declaration.path);
  if (externalIds === null) {
    return {
      status: "indeterminate",
      externalOnly: NO_DRIFT,
      launcherOnly: NO_DRIFT,
      agreeing: NO_DRIFT,
      note: `externalInventory at ${declaration.path} could not be read as a populated schemaVersion:1 inventory document.`,
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
        note: `the hub's own inventory ${launcher.reason}, so it cannot be compared with externalInventory at ${declaration.path}.`,
      };
    }
    launcherIds = launcher.ids;
  }
  // One repository identity, as everywhere in Launcher (identity.ts): a bare id is the hub owner's, and case is ignored.
  const agrees = (id: string, others: readonly string[]) => others.some((other) => sameRepository(id, other, hubOwner));
  // Every position below is the id's own index in the array a caller can already read
  // (externalIds from `externalInventory`'s document, launcherIds from the hub's own
  // stored inventory) -- never the id, per InventoryDriftPositions' own doc comment.
  const externalOnly = externalIds.reduce<{ count: number; positions: string[] }>(
    (acc, id, index) => (agrees(id, launcherIds) ? acc : { count: acc.count + 1, positions: [...acc.positions, `externalInventory[${index}]`] }),
    { count: 0, positions: [] },
  );
  const launcherOnly = launcherIds.reduce<{ count: number; positions: string[] }>(
    (acc, id, index) => (agrees(id, externalIds) ? acc : { count: acc.count + 1, positions: [...acc.positions, `repositories[${index}]`] }),
    { count: 0, positions: [] },
  );
  const agreeing = externalIds.reduce<{ count: number; positions: string[] }>(
    (acc, id, index) => (agrees(id, launcherIds) ? { count: acc.count + 1, positions: [...acc.positions, `externalInventory[${index}]`] } : acc),
    { count: 0, positions: [] },
  );
  return { status: "reconciled", externalOnly, launcherOnly, agreeing };
}
