import { stableStringify } from "@clossys/designer/catalog";
import type { StudioSelectionProjection } from "./selection.js";

/** Retain exactly the checked profile, selected documents and emitted runtime source. */
export function studioProjectionFiles(projection: StudioSelectionProjection): Map<string, string> {
  const files = new Map(projection.files);
  for (const index of ["component-index.ts", "surface-index.ts"]) {
    if (!files.has(index)) throw new Error(`Studio projection is incomplete: ${index}`);
  }
  const library = projection.input.library;
  const documents = [...library.values.fills, ...library.components.fills, ...(library.surfaces?.fills ?? [])];
  const selected = new Set<string>();
  for (const document of documents) {
    const slot = document.$extensions["com.clossys.fill"].slot;
    if (!/^(themes|assets|components|sections|frames)\.[a-z][a-z0-9-]*$/.test(slot) || selected.has(slot)) throw new Error("Studio projection has an invalid or duplicate selected document");
    selected.add(slot);
    files.set(`fills/${slot}.json`, stableStringify(document));
  }
  files.set("resolved.json", stableStringify(projection.profile));
  files.set("runtime.js", projection.runtime);
  files.set("theme.css", projection.css);
  return files;
}
