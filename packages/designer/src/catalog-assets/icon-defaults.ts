import type { CatalogData, LibraryData } from '../catalog-core/types.js';
import type { LibraryOperation } from '../catalog-core/api.js';
import { applyLibraryChange } from '../catalog-core/library.js';
import { libraryHash, resolve } from '../catalog-core/resolve.js';
import { flatten } from '../catalog-core/model.js';
import type { IconNode } from '../icons/types.js';

/** Default policy for unfilled glyph seats. Consumer selections always take precedence. */
export const DEFAULT_ICON_PREFERENCE: readonly string[] = ['lucide', 'phosphor'];

export interface IconDefaultsInput {
  catalog: CatalogData;
  library: LibraryData;
  slots?: readonly string[];
  preference?: readonly string[];
  /** Exclusive source choices for unfilled seats; absence never falls back to another source. */
  choices?: Readonly<Record<string, string>>;
}

export interface IconDefaultsPlan {
  changes: readonly LibraryOperation[];
  preserved: readonly string[];
  unavailable: readonly string[];
}

/** Propose native adoptions only. No selection writes or renderer/vendor coupling. */
export function planIconDefaults(input: IconDefaultsInput): IconDefaultsPlan {
  const slots = input.catalog.slots.filter(slot => slot.layer === 'assets'
    && slot.contract.kind === 'asset' && slot.contract.valueKind === 'glyph'
    && slot.contract.members.mode === 'closed' && slot.contract.members.names.includes('default')
    && (!input.slots || input.slots.includes(slot.id)));
  const changes: LibraryOperation[] = [], preserved: string[] = [], unavailable: string[] = [];
  for (const { id } of slots) {
    if (input.library.fills.some(fill => fill.$extensions['com.clossys.fill'].slot === id)) {
      preserved.push(id);
      continue;
    }
    const choice = input.choices?.[id];
    const order = choice === undefined ? input.preference ?? DEFAULT_ICON_PREFERENCE : [choice];
    const candidate = order.flatMap(source => input.catalog.fills.filter(fill => {
      const meta = fill.$extensions['com.clossys.fill'];
      return meta.slot === id && meta.source === source && meta.mode === 'implementation'
        && Object.values(flatten(fill)).length > 0
        && Object.values(flatten(fill)).every(token => token.$type === 'glyph');
    }))[0];
    if (candidate) changes.push({ op: 'adopt', slot: id, source: candidate.$extensions['com.clossys.fill'].source });
    else unavailable.push(id);
  }
  return { changes, preserved, unavailable };
}

/** Runtime host adapter: native adoption and resolution retain item provenance in memory.
 * The host owns its library and adoption date; this function never persists it.
 */
export function resolveIconAssets(input: IconDefaultsInput): {
  library: LibraryData; glyphs: Readonly<Record<string, IconNode>>; plan: IconDefaultsPlan;
} {
  const plan = planIconDefaults(input);
  const library = plan.changes.length ? applyLibraryChange(input.catalog, input.library,
    { baseHash: libraryHash(input.library), changes: plan.changes }) : input.library;
  const profile = resolve({ catalog: input.catalog, library });
  const glyphs: Record<string, IconNode> = {};
  for (const [id, member] of Object.entries(profile.members)) {
    if (member.$type === 'glyph' && id.endsWith('.default')
      && (!input.slots || input.slots.includes(member.slot))) glyphs[member.slot] = member.value.light as IconNode;
  }
  return { library, glyphs, plan };
}
