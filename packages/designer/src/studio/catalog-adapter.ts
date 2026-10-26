import { generateSelection, loadCatalog } from "../catalog-core/index.js";
import type { LibraryData } from "../catalog-core/index.js";
import type { StudioAdapter } from "./types.js";

/** Browse the shipped catalog against an empty, read-only consumer library. */
export const catalogStudioAdapter: StudioAdapter = {
  catalog: loadCatalog(),
  async load() {
    const library: LibraryData = { source: { id: "preview", kind: "consumer", author: "consumer", license: "UNLICENSED" }, fills: [], adoptedAt: new Date().toISOString().slice(0,10) };
    return { library, selection: generateSelection(library) };
  },
  async save() { return { ok: false, reason: "unavailable" }; },
};
