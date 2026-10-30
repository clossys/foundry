import sourceJson from '../catalog/sources/lucide.json' with { type: 'json' };
import tokenSlots from '../catalog/slots/tokens.json' with { type: 'json' };
import type { FillDoc, Slot, Source } from '../catalog-core/types.js';
import { cells } from './shared.js';

export const LUCIDE_TOKEN_SOURCE = sourceJson as Source;

/** The stroke comes from the pinned icon source and the 24-grid outline shell. */
export function importLucideTokenStroke(source: Source): FillDoc[] {
  if (source.id !== 'lucide' || source.license !== 'ISC' || !source.pin?.sha256) throw new Error('importer: expected a pinned Lucide source');
  return cells({ values: [{ leaf: 'icon-stroke', member: 'default', text: '2' }], slots: tokenSlots as unknown as readonly Slot[], source, sourceAddress: 'src/components/Icon.tsx: default strokeWidth=2; glyph nodes use the outline shell' });
}
