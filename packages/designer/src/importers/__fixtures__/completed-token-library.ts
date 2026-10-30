import type { CatalogData, LibraryData, Source } from '../../catalog-core/types.js';
import { applyLibraryChange, libraryHash } from '../../catalog-core/api.js';

/** A signed-default test fixture, not a runtime seeder or chooser. Identity and date are caller supplied. */
export function completedTokenLibrary(catalog: CatalogData, source: Source, adoptedAt: string): LibraryData {
  let library: LibraryData = { source, adoptedAt, fills: [], complete: true };
  const adoptSource = (id: string) => {
    for (const fill of catalog.fills.filter(fill => fill.$extensions['com.clossys.fill'].source === id && fill.$extensions['com.clossys.fill'].slot.startsWith('tokens.'))) {
      library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: 'adopt', slot: fill.$extensions['com.clossys.fill'].slot, source: id }] });
    }
  };
  adoptSource('foundry'); adoptSource('foundry-baseline'); adoptSource('tailwind-default');
  for (const [slot, id] of [['tokens.status-color', 'radix-colors'], ['tokens.categorical-color', 'carbon-colors'], ['tokens.icon-stroke', 'lucide']]) library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: 'adopt', slot: slot!, source: id! }] });
  return applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: 'derive', slot: 'tokens.diverging-color', rule: 'token-diverging-neutral@1', inputs: ['tokens.border-color.base'] }] });
}
