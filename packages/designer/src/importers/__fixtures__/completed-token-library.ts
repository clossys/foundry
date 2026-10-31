import type { CatalogData, LibraryData, Source } from '../../catalog-core/types.js';
import { applyLibraryChange, libraryHash } from '../../catalog-core/api.js';

/** A signed-default test fixture, not a runtime seeder or chooser. Identity and date are caller supplied. */
export function completedTokenLibrary(catalog: CatalogData, source: Source, adoptedAt: string): LibraryData {
  let library: LibraryData = { source, adoptedAt, fills: [], complete: true };
  const adoptSource = (id: string) => {
    for (const fill of catalog.fills.filter(fill => fill.$extensions['com.clossys.fill'].source === id && fill.$extensions['com.clossys.fill'].slot.startsWith('themes.'))) {
      library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: 'adopt', slot: fill.$extensions['com.clossys.fill'].slot, source: id }] });
    }
  };
  adoptSource('shadcn@aria'); adoptSource('tailwind-default'); adoptSource('foundry');
  return library;
}
