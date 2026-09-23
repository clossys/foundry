// Adopt an existing repository inventory instead of creating a second one
// (#1216). An account that already keeps a repository inventory in its own
// control plane becomes the source of truth when the hub marker declares
// it. Launcher writes only what that inventory lacks (a later apply step,
// not this module) and reports drift instead of silently merging.

import type { WorkspaceHost } from "./types.js";

export interface ExternalInventoryDeclaration {
  readonly path: string;
  readonly shape: "foundry" | "custom";
}

export interface InventoryDriftReport {
  readonly status: "no-external-source" | "reconciled" | "indeterminate";
  readonly externalOnly: readonly string[];
  readonly launcherOnly: readonly string[];
  readonly agreeing: readonly string[];
  readonly note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a foundry-shaped inventory document's repository ids. Malformed or missing is null, never []. */
function readForeignIds(host: WorkspaceHost, path: string): readonly string[] | null {
  const raw = host.readText(path);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
 * approved apply step (same #1045 pattern as clone-on-approval).
 */
export function reportInventoryDrift(
  host: WorkspaceHost,
  directory: string,
  declaration: ExternalInventoryDeclaration | undefined,
  launcherInventoryRelPath: string,
): InventoryDriftReport {
  if (declaration === undefined) {
    return { status: "no-external-source", externalOnly: [], launcherOnly: [], agreeing: [] };
  }
  if (declaration.shape === "custom") {
    return {
      status: "indeterminate",
      externalOnly: [],
      launcherOnly: [],
      agreeing: [],
      note: `externalInventory at ${declaration.path} declares shape "custom"; launcher has no mapping for a non-foundry inventory shape yet and will not guess one. Reconcile by hand or file the mapping gap.`,
    };
  }
  const externalIds = readForeignIds(host, declaration.path);
  if (externalIds === null) {
    return {
      status: "indeterminate",
      externalOnly: [],
      launcherOnly: [],
      agreeing: [],
      note: `externalInventory at ${declaration.path} could not be read as a populated schemaVersion:1 inventory document.`,
    };
  }
  const launcherIds = readForeignIds(host, `${directory}/${launcherInventoryRelPath}`) ?? [];
  const externalSet = new Set(externalIds);
  const launcherSet = new Set(launcherIds);
  const externalOnly = externalIds.filter((id) => !launcherSet.has(id));
  const launcherOnly = launcherIds.filter((id) => !externalSet.has(id));
  const agreeing = externalIds.filter((id) => launcherSet.has(id));
  return { status: "reconciled", externalOnly, launcherOnly, agreeing };
}
