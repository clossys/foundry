import tokenSlots from '../catalog/slots/tokens.json' with { type: 'json' };
import sourceJson from '../catalog/sources/radix-colors.json' with { type: 'json' };
import type { FillDoc, Slot, Source } from '../catalog-core/types.js';
import { cells, sourceSha256, type ImportedValue } from './shared.js';

/** Role adapter only: Radix's 1–12 scales never enter the frozen 50–950 ramp. */
export function importRadixColors(input: { light: string; dark: string; slots?: readonly Slot[] }): FillDoc[] {
  const source = sourceJson as Source;
  if (sourceSha256(input.light + '\0' + input.dark) !== source.pin!.sha256) throw new Error('importer: source bytes differ from pinned radix-colors');
  const scales = [input.light, input.dark].map(text => Object.fromEntries([...text.matchAll(/\b([a-z]+\d+): "(#[a-f0-9]{6})"/g)].map(match => [match[1]!, match[2]!])));
  const read = (name: string, step: number, mode: number): string => { const value = scales[mode]![name + step]; if (!value) throw new Error(`importer: missing Radix ${name}${step}`); return value; };
  const values: ImportedValue[] = [];
  for (const [tone, scale] of [['success', 'green'], ['warning', 'amber'], ['danger', 'red'], ['info', 'blue']] as const) {
    for (const [suffix, step] of [['', 11], ['-text', 12], ['-tint', 3]] as const) values.push({ leaf: 'status-color', member: tone + suffix, text: read(scale, step, 0), dark: read(scale, step, 1) });
  }
  for (const [member, light, dark] of [['default', 9, 11], ['hover', 10, 12], ['text', 11, 11], ['tint', 3, 3], ['on-inverse', 8, 9]] as const) values.push({ leaf: 'accent-color', member, text: read('indigo', light, 0), dark: read('indigo', dark, 1) });
  const fills = cells({ values, slots: input.slots ?? tokenSlots as unknown as readonly Slot[], source, sourceAddress: `${source.pin!.url}/src/{light,dark}.ts` });
  for (const fill of fills) { const meta = fill.$extensions['com.clossys.fill']; meta.mode = 'derived'; meta.relation = 'derived'; meta.derivation = { from: 'dtcg#alias', rule: meta.slot === 'tokens.status-color' ? 'green/amber/red/blue: marker11, text12, tint3 in each actual mode; WCAG ratios measured on consumer grounds' : 'indigo: light default9 hover10 text11 tint3 on-inverse8; dark default11 hover12 text11 tint3 on-inverse9' }; }
  return fills;
}
