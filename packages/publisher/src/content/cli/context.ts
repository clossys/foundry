import type { CompositeCatalogData, SectionSlot } from "@clossys/designer/catalog";
import { loadContentStore } from "../store/index.js";
import type { PublisherContext } from "./types.js";

/** Load ownership through PB4, then attach declared DG-1 metadata for Review. */
export async function loadPublisherContext(root: string, designerRoot: string, catalog: CompositeCatalogData): Promise<PublisherContext> {
  const contracts = new Map<string, SectionSlot["contract"]>();
  const ids = new Set<string>();
  for (const slot of catalog.surfaces?.slots ?? []) {
    if (ids.has(slot.id)) throw new TypeError(`Duplicate Designer surface contract: ${slot.id}`);
    ids.add(slot.id);
    if (slot.layer === "sections") contracts.set(slot.id, slot.contract);
  }
  const loaded = await loadContentStore(root, { designer: { root: designerRoot, catalog } });
  return {
    registry: loaded.registry,
    libraries: loaded.libraries.map(library => ({
      ...library,
      sections: library.sections.map(section => {
        const contract = contracts.get(section.id);
        if (!contract) return section;
        // Catalog rows supply contracts, never registration or config ownership.
        // Missing metadata stays missing so PB3 raises its own Designer Need.
        return {
          ...section,
          ...(contract.passageSchema === undefined ? {} : { passageSchema: contract.passageSchema }),
          ...(contract.copy === undefined ? {} : { copy: structuredClone(contract.copy) }),
          ...(contract.slots === undefined ? {} : { slots: structuredClone(contract.slots) }),
        };
      }),
    })),
  };
}
