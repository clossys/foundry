import tokenSlots from '../catalog/slots/tokens.json' with { type: 'json' };
import sourceJson from '../catalog/sources/carbon-colors.json' with { type: 'json' };
import provenance from './vendor/carbon/provenance.json' with { type: 'json' };
import type { FillDoc, Mode, Slot, Source } from '../catalog-core/types.js';
import { contrastRatio } from '../tokens/color.js';
import { cells, sourceSha256 } from './shared.js';

/** Select paired upstream categorical entries; never synthesize or adjust colours. */
export function importCarbonColors(input: { colors: string; palette: string; grounds: Readonly<Record<Mode, readonly string[]>>; slots?: readonly Slot[] }): FillDoc[] {
  const source = sourceJson as Source;
  if (sourceSha256(input.colors) !== source.pin!.sha256 || sourceSha256(input.palette) !== provenance.palette.sha256) throw new Error('importer: source bytes differ from pinned carbon-colors');
  const colors = Object.fromEntries([...input.colors.matchAll(/export const (\w+) = '(#[\da-f]{6})'/g)].map(match => [match[1]!, match[2]!]));
  const palettes = ['$white-theme-colors:', '$dark-theme-colors:'].map(section => {
    const body = input.palette.split(section)[1]?.split("'14': (")[1]?.split('\n\t\t)')[0];
    if (!body) throw new Error('importer: missing Carbon categorical14 palette');
    return [...body.matchAll(/'(\d+)': (?:getColorValue\((\w+), (\d+)\)|(#[\da-f]{6}))/g)].map(match => {
      const value = match[4] ?? colors[match[2]! + match[3]!]; if (!value) throw new Error('importer: missing Carbon colour'); return value;
    });
  });
  if (palettes.some(palette => palette.length !== 14)) throw new Error('importer: expected fourteen paired Carbon entries');
  const eligible = palettes[0]!.map((_, index) => index).filter(index => (['light', 'dark'] as const).every((mode, m) => input.grounds[mode].length > 0 && input.grounds[mode].every(ground => contrastRatio(palettes[m]![index]!, ground) >= 3)));
  if (eligible.length < 8) throw new Error(`importer: Carbon has only ${eligible.length} paired entries at 3:1 on supplied grounds; needs eight`);
  const selected = eligible.slice(0, 8);
  const fills = cells({ values: selected.map((index, slot) => ({ leaf: 'categorical-color', member: String(slot + 1), text: palettes[0]![index]!, dark: palettes[1]![index]! })), slots: input.slots ?? tokenSlots as unknown as readonly Slot[], source, sourceAddress: provenance.palette.url });
  const meta = fills[0]!.$extensions['com.clossys.fill'];
  meta.mode = 'derived'; meta.relation = 'derived'; meta.derivation = { from: 'dtcg#alias', rule: `Carbon categorical14 paired light/dark indices ${selected.map(index => index + 1).join(',')}; first eight pairs clearing 3:1 on all supplied grounds; unchanged upstream values, not the original first-eight sequence` };
  return fills;
}
