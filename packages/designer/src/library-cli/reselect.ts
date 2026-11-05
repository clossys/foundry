import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { applyLibraryChange, check, libraryHash, type ChangeSet, type LibraryOperation } from "../catalog-core/api.js";
import type { CompositeCatalogData, CompositeChangeSet, CompositeEngineInput, CompositeLibraryData, LibraryData } from "../catalog-core/types.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import { LibraryInputError, readLibrary, writeCompositeLibrary, writeLibrary } from "./fs-library.js";
import type { DesignerWriteStamp } from "./write-receipt.js";

export interface AgentChangeInput {
  root: string; catalog: CompositeCatalogData; leaf: string; write: boolean;
  componentOptions?: CompositeEngineInput["componentOptions"]; surfaceOptions?: SurfaceResolutionOptions;
}
export async function readAgentLibrary(input: AgentChangeInput): Promise<LibraryData | CompositeLibraryData> {
  const handle = await open(join(input.root, "metadata.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  let metadata: { format?: string };
  try {
    if (!(await handle.stat()).isFile()) throw new LibraryInputError("Library metadata must be a regular file");
    metadata = JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
  return metadata.format === "composite-v1" ? readLibrary(input.root, input.catalog) : readLibrary(input.root, input.catalog.values);
}
/** Dry runs use the same engine and verdict as the protected writer, without disk mutation. */
export async function applyAgentChange(input: AgentChangeInput, library: LibraryData | CompositeLibraryData, operation: LibraryOperation, stamp: DesignerWriteStamp) {
  if ("values" in library) {
    const portion = input.catalog.values.slots.some(slot => slot.id === input.leaf) ? "values"
      : input.catalog.components.slots.some(slot => slot.id === input.leaf) ? "components"
      : input.catalog.surfaces?.slots.some(slot => slot.id === input.leaf) ? "surfaces" : undefined;
    if (!portion) throw new LibraryInputError(`Unknown leaf ${input.leaf}`);
    const changeset = { baseHash: libraryHash(library), changes: [{ portion, change: operation }] } as CompositeChangeSet;
    const next = input.write ? await writeCompositeLibrary(input.root, input.catalog, changeset, input.componentOptions, input.surfaceOptions, stamp)
      : applyLibraryChange(input.catalog, library, changeset, input.surfaceOptions ? { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions } : undefined);
    return { changeset, verdict: check({ catalog: input.catalog, library: next, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions }) };
  }
  if (!input.catalog.values.slots.some(slot => slot.id === input.leaf)) throw new LibraryInputError(`Unknown leaf ${input.leaf}`);
  const changeset: ChangeSet = { baseHash: libraryHash(library), changes: [operation] };
  const next = input.write ? await writeLibrary(input.root, input.catalog.values, changeset, stamp) : applyLibraryChange(input.catalog.values, library, changeset);
  return { changeset, verdict: check({ catalog: input.catalog.values, library: next }) };
}
/** Leaf IDs, never placement paths, identify both the operation and its stamp. */
export async function reselect(input: AgentChangeInput & { source: string }) {
  const library = await readAgentLibrary(input);
  return applyAgentChange(input, library, { op: "adopt", slot: input.leaf, source: input.source }, { command: "designer-library reselect", inputs: { leaf: input.leaf, source: input.source } });
}
