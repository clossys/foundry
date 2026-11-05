import type { FillDoc, Source } from '../catalog-core/types.js';
import roster from './open-props-image-ratio-roster.json' with { type: 'json' };
import source from '../catalog/sources/open-props.json' with { type: 'json' };

export const OPEN_PROPS_SOURCE: Source = source as Source;
/** Six pinned native scalars as optional rule data; no CSS evaluation or defaults. */
export function importOpenPropsImageRatio(): FillDoc[] {
  return [{
    $extensions: { 'com.clossys.fill': {
      id: 'open-props/assets.image-ratio', slot: 'assets.image-ratio', source: 'open-props',
      mode: 'implementation', sourceAddress: source.pin.url, relation: 'subset',
      builtOn: [], conforms: [], evidence: [], author: 'third-party', trust: 'pinned-upstream',
      license: 'MIT', pin: structuredClone(source.pin), status: 'draft', reads: { themes: [], assets: [] },
    } },
    assets: { 'image-ratio': Object.fromEntries(roster.map(row => [row.member, {
      $type: 'rules', $value: { width: row.width, height: row.height },
    }])) },
  }];
}
