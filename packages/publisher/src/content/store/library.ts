import { libraryHash, resolve, type CompositeCatalogData } from "@clossys/designer/catalog";
import { readLibrary } from "@clossys/designer/catalog/node";
import type { ConsumerLibrarySnapshot } from "../library.js";

/** Project consumer-owned Designer registrations for Publisher reference checks. */
export async function readConsumerLibrarySnapshot(root: string, catalog: CompositeCatalogData): Promise<ConsumerLibrarySnapshot> {
  const library = await readLibrary(root, catalog);
  const values = resolve({
    catalog: catalog.values,
    library: { ...library.values, source: library.source, ...(library.adoptedAt === undefined ? {} : { adoptedAt: library.adoptedAt }) },
  });
  const frames: ConsumerLibrarySnapshot["frames"][number][] = [];
  const sections: ConsumerLibrarySnapshot["sections"][number][] = [];
  for (const document of library.surfaces?.fills ?? []) {
    for (const entry of Object.values(document.frames ?? {})) {
      // Designer frames have no config registry; Publisher names their sole configuration.
      frames.push({ id: entry.slot, configIds: ["default"] });
    }
    for (const entry of Object.values(document.sections ?? {})) {
      sections.push({ id: entry.slot, configIds: Object.keys(entry.configs).sort() });
    }
  }
  return {
    consumerId: library.source.id,
    version: libraryHash(library),
    frames: frames.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    sections: sections.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    assetIds: Object.keys(values.members).filter(id => id.startsWith("assets.")).sort(),
  };
}
